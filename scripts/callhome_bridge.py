#!/usr/bin/env python3
"""
callhome_bridge.py — Ti60F225 SoC call-home bridge
====================================================

Reads the Ti60 Sapphire SoC UART and forwards every CALLHOME, TRACE,
FAULT_EVENT, and HUNG packet to the Church Machine IDE server so the device
appears in the Devices view and fault data is persisted server-side.

Features
--------
* --auto   Scans /dev/ttyUSB0–7 (Linux/ChromeOS), sends a probe byte, and
           selects the first port that replies with the SoC greeting string
           ("CHURCH Ti60") within 1 second.  Prints the chosen port so the
           operator can confirm the selection.
* --port   Override auto-detection with a specific device path.
* --ide    IDE server base URL for forwarding packets.
* --baud   Baud rate (default 57600 — matches UART_CLOCKDIV=53 at 25 MHz).
* --run    Bridge mode: keep reading and forwarding until Ctrl-C.

Port auto-detection is Linux / ChromeOS only.  Pass --port=/dev/ttyUSBN on
Windows.

Parser functions (parse_callhome, parse_trace, parse_fault_event, parse_hung,
parse_nia, is_greeting) are importable without a serial device for use in
CI test suites.

Usage
-----
    # Show which port the Ti60 is on (no forwarding)
    python3 scripts/callhome_bridge.py --auto

    # Probe and print the selected port, then exit
    python3 scripts/callhome_bridge.py --auto --probe-only

    # Forward to IDE server indefinitely
    python3 scripts/callhome_bridge.py --auto --ide=http://localhost:5000 --run

    # Use a specific port
    python3 scripts/callhome_bridge.py --port=/dev/ttyUSB2 --ide=http://localhost:5000 --run

Exit codes
----------
  0 — bridge started successfully (or probe found port)
  1 — auto-detect failed / port busy / other error
"""

import sys
import json
import time

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
_AUTO       = False
_PORT       = None
_BAUD       = 57600
_IDE_URL    = None
_RUN        = False
_PROBE_ONLY = False
_VERBOSE    = False

for _a in sys.argv[1:]:
    if _a == '--auto':
        _AUTO = True
    elif _a.startswith('--port='):
        _PORT = _a[7:]
    elif _a.startswith('--baud='):
        _BAUD = int(_a[7:])
    elif _a.startswith('--ide='):
        _IDE_URL = _a[6:].rstrip('/')
    elif _a == '--run':
        _RUN = True
    elif _a == '--probe-only':
        _PROBE_ONLY = True
    elif _a == '--verbose':
        _VERBOSE = True
    elif _a in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    elif _a.startswith('--'):
        print(f"WARNING: unknown flag {_a!r} ignored", file=sys.stderr)

# ---------------------------------------------------------------------------
# Parser — GREETING line
# ---------------------------------------------------------------------------

def is_greeting(line):
    """
    Return True if *line* contains the SoC boot greeting.

    The firmware emits: "CHURCH Ti60 SoC+CM v2.0"
    We match on the prefix so future firmware version bumps still pass.
    """
    return "CHURCH Ti60" in line


# ---------------------------------------------------------------------------
# Parser — NIA line
# ---------------------------------------------------------------------------

def parse_nia(line):
    """
    Parse a "NIA=0x..." line.

    Returns the NIA hex string (e.g. "0x00000042") on success, None otherwise.
    """
    if not line.startswith("NIA=") or "0x" not in line:
        return None
    return line[4:].strip()


# ---------------------------------------------------------------------------
# Parser — CALLHOME JSON line
# ---------------------------------------------------------------------------

def parse_callhome(line):
    """
    Parse a CALLHOME:{...} line.

    Returns a dict on success, None on parse failure or missing required fields.

    Required fields: board, uid, nia, boot_ok, fault, fault_code.
    """
    if not line.startswith("CALLHOME:"):
        return None
    json_str = line[len("CALLHOME:"):]
    try:
        pkt = json.loads(json_str)
    except (json.JSONDecodeError, ValueError):
        return None
    required = ("board", "uid", "nia", "boot_ok", "fault", "fault_code")
    if not all(k in pkt for k in required):
        return None
    return pkt


def validate_callhome(pkt):
    """
    Return a list of validation error strings (empty list = valid).
    """
    errors = []
    if not isinstance(pkt.get("board"), str) or not pkt["board"]:
        errors.append("board field missing or empty")
    if not isinstance(pkt.get("uid"), str) or len(pkt["uid"]) not in (8, 16):
        errors.append(f"uid field invalid: {pkt.get('uid')!r}")
    if not isinstance(pkt.get("nia"), str) or not pkt["nia"].startswith("0x"):
        errors.append(f"nia field invalid: {pkt.get('nia')!r}")
    if pkt.get("boot_ok") not in (0, 1):
        errors.append(f"boot_ok must be 0 or 1, got {pkt.get('boot_ok')!r}")
    if pkt.get("fault") not in (0, 1):
        errors.append(f"fault must be 0 or 1, got {pkt.get('fault')!r}")
    if not isinstance(pkt.get("fault_code"), int) or not (0 <= pkt["fault_code"] <= 31):
        errors.append(f"fault_code must be 0-31, got {pkt.get('fault_code')!r}")
    if "fw_major" in pkt and (not isinstance(pkt["fw_major"], int) or pkt["fw_major"] < 0):
        errors.append(f"fw_major must be non-negative int, got {pkt.get('fw_major')!r}")
    if "fw_minor" in pkt and (not isinstance(pkt["fw_minor"], int) or pkt["fw_minor"] < 0):
        errors.append(f"fw_minor must be non-negative int, got {pkt.get('fw_minor')!r}")
    return errors


# ---------------------------------------------------------------------------
# Parser — TRACE line
# ---------------------------------------------------------------------------

def parse_trace(line):
    """
    Parse a TRACE:[...] line (firmware v2.0+ 10-Hz NIA sampler).

    Returns a non-empty list of NIA strings on success, None otherwise.
    Each entry in the list should be a "0x..." hex string.
    """
    if not line.startswith("TRACE:"):
        return None
    array_str = line[len("TRACE:"):]
    try:
        entries = json.loads(array_str)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(entries, list) or not entries:
        return None
    return entries


# ---------------------------------------------------------------------------
# Parser — FAULT_EVENT line
# ---------------------------------------------------------------------------

def parse_fault_event(line):
    """
    Parse a FAULT_EVENT:{...} line (firmware v2.0+).

    Returns a dict on success, None on parse failure or missing required fields.

    Required fields: uid, nia, fault_code, fault_name.
    Optional fields: fault_gt, fault_instr, fault_cr14, fault_stage.
    Extended fields (v1.2 §3 — additive, backward-compatible):
      gt_snapshot  — dict of non-null CR values at fault, e.g. {"CR0":"0x4A000006","CR6":"0x4A000002"}
      pet_names    — dict of active register labels, e.g. {"CR3":"LED","DR0":"counter"}
    """
    if not line.startswith("FAULT_EVENT:"):
        return None
    json_str = line[len("FAULT_EVENT:"):]
    try:
        pkt = json.loads(json_str)
    except (json.JSONDecodeError, ValueError):
        return None
    required = ("uid", "nia", "fault_code", "fault_name")
    if not all(k in pkt for k in required):
        return None
    return pkt


# ---------------------------------------------------------------------------
# Parser — HUNG line
# ---------------------------------------------------------------------------

def parse_hung(line):
    """
    Parse a HUNG:{...} line (firmware v2.0+ hung-CM watchdog).

    Returns a dict on success, None on parse failure or missing required fields.

    Required fields: uid, nia, loops.
    """
    if not line.startswith("HUNG:"):
        return None
    json_str = line[len("HUNG:"):]
    try:
        pkt = json.loads(json_str)
    except (json.JSONDecodeError, ValueError):
        return None
    required = ("uid", "nia", "loops")
    if not all(k in pkt for k in required):
        return None
    return pkt


# ---------------------------------------------------------------------------
# Port auto-detection
# ---------------------------------------------------------------------------

_GREETING_PROBE_TIMEOUT = 1.0   # seconds to wait per port for the greeting
_GREETING_MARKER        = b"CHURCH Ti60"


def auto_detect_port(serial_mod, baud, verbose=False):
    """
    Scan /dev/ttyUSB0–7 at *baud*, send a probe newline, and return the first
    port that emits the SoC greeting string within _GREETING_PROBE_TIMEOUT
    seconds.  Returns None if no port responds with the greeting.

    The probe newline is harmless — the SoC firmware ignores unexpected input
    and continues emitting its telemetry stream regardless.

    Only the port whose received bytes contain "CHURCH Ti60" is returned; a
    port that is busy or emits unrecognised data (e.g. another USB-serial
    device) is skipped.
    """
    import glob as _glob
    candidates = sorted(
        _glob.glob('/dev/ttyUSB[0-9]') +
        _glob.glob('/dev/ttyUSB[0-9][0-9]')
    )
    if not candidates:
        print("  [auto] No /dev/ttyUSB* devices found.", file=sys.stderr)
        return None

    print(f"  [auto] Scanning {len(candidates)} ttyUSB port(s) at {baud} baud …",
          file=sys.stderr)

    for port in candidates:
        try:
            s = serial_mod.Serial(port, baud, timeout=0)
            s.setRTS(False)
            s.setDTR(False)
        except Exception as exc:
            if verbose:
                print(f"  [auto]   {port}: open failed ({exc})", file=sys.stderr)
            else:
                print(f"  [auto]   {port}: busy/unavailable", file=sys.stderr)
            continue

        # Send a harmless probe byte to encourage the SoC to emit its banner
        try:
            s.write(b"\n")
            s.flush()
        except Exception:
            pass

        deadline = time.monotonic() + _GREETING_PROBE_TIMEOUT
        buf = b""
        found = False
        while time.monotonic() < deadline:
            try:
                waiting = s.in_waiting
            except Exception:
                waiting = 0
            if waiting:
                buf += s.read(waiting)
                if _GREETING_MARKER in buf:
                    found = True
                    break
            time.sleep(0.02)

        try:
            s.close()
        except Exception:
            pass

        if found:
            greeting_line = ""
            for raw_line in buf.split(b"\n"):
                decoded = raw_line.rstrip(b"\r").decode("utf-8", errors="replace")
                if "CHURCH Ti60" in decoded:
                    greeting_line = decoded
                    break
            print(f"  [auto]   {port}: greeting received — selected", file=sys.stderr)
            if verbose and greeting_line:
                print(f"  [auto]   greeting: {greeting_line!r}", file=sys.stderr)
            return port
        else:
            if buf:
                print(f"  [auto]   {port}: {len(buf)} byte(s) received but no greeting",
                      file=sys.stderr)
            else:
                print(f"  [auto]   {port}: silent", file=sys.stderr)

    return None


# ---------------------------------------------------------------------------
# IDE forwarding
# ---------------------------------------------------------------------------

def _post_to_ide(ide_url, endpoint, payload, verbose=False):
    """POST *payload* dict as JSON to ide_url/endpoint.  Errors are logged."""
    try:
        import urllib.request
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{ide_url}{endpoint}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        if verbose:
            result = json.loads(resp.read())
            print(f"  [ide] POST {endpoint} → {result}", file=sys.stderr)
    except Exception as exc:
        print(f"  [ide] POST {endpoint} failed: {exc}", file=sys.stderr)


def forward_line(line, ide_url, verbose=False):
    """
    Parse *line* and forward any recognised packet type to the IDE server.
    Returns True if the line was recognised (regardless of forwarding success).
    """
    if is_greeting(line):
        if verbose:
            print(f"  [bridge] GREETING: {line!r}", file=sys.stderr)
        return True

    if parse_nia(line) is not None:
        if verbose:
            print(f"  [bridge] NIA: {line!r}", file=sys.stderr)
        return True

    pkt = parse_callhome(line)
    if pkt is not None:
        if verbose:
            print(f"  [bridge] CALLHOME board={pkt.get('board')} nia={pkt.get('nia')}",
                  file=sys.stderr)
        if ide_url:
            _post_to_ide(ide_url, "/api/device/callhome", pkt, verbose=verbose)
        return True

    trace = parse_trace(line)
    if trace is not None:
        if verbose:
            print(f"  [bridge] TRACE {len(trace)} sample(s)", file=sys.stderr)
        if ide_url:
            _post_to_ide(ide_url, "/api/device/trace",
                         {"samples": trace}, verbose=verbose)
        return True

    fe = parse_fault_event(line)
    if fe is not None:
        if verbose:
            print(f"  [bridge] FAULT_EVENT fault_name={fe.get('fault_name')!r}",
                  file=sys.stderr)
        if ide_url:
            _post_to_ide(ide_url, "/api/device/fault", fe, verbose=verbose)
        return True

    h = parse_hung(line)
    if h is not None:
        if verbose:
            print(f"  [bridge] HUNG nia={h.get('nia')} loops={h.get('loops')}",
                  file=sys.stderr)
        if ide_url:
            _post_to_ide(ide_url, "/api/device/hung", h, verbose=verbose)
        return True

    if verbose:
        print(f"  [bridge] (unrecognised) {line!r}", file=sys.stderr)
    return False


# ---------------------------------------------------------------------------
# Bridge run loop
# ---------------------------------------------------------------------------

def run_bridge(port, baud, ide_url, verbose=False):
    """Open *port* and forward lines to *ide_url* until interrupted."""
    try:
        import serial as _serial
    except ImportError:
        print("ERROR: pyserial not installed.  Run: pip3 install pyserial",
              file=sys.stderr)
        sys.exit(1)

    print(f"  [bridge] Opening {port} at {baud} baud …", file=sys.stderr)
    try:
        s = _serial.Serial(port, baud, timeout=0)
        s.setRTS(False)
        s.setDTR(False)
    except Exception as exc:
        print(f"ERROR: could not open {port}: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"  [bridge] Running.  Forwarding to: {ide_url or '(no IDE URL set)'}",
          file=sys.stderr)
    print(f"  [bridge] Press Ctrl-C to stop.", file=sys.stderr)

    buf = b""
    try:
        while True:
            try:
                waiting = s.in_waiting
            except Exception:
                waiting = 0
            if waiting:
                buf += s.read(waiting)
                while b"\n" in buf:
                    idx = buf.index(b"\n")
                    raw = buf[:idx]
                    buf = buf[idx + 1:]
                    line = raw.rstrip(b"\r").decode("utf-8", errors="replace")
                    if line:
                        forward_line(line, ide_url, verbose=verbose)
            else:
                time.sleep(0.02)
    except KeyboardInterrupt:
        print("\n  [bridge] Interrupted.", file=sys.stderr)
    finally:
        try:
            s.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Determine port
    port = _PORT

    if _AUTO and port is None:
        try:
            import serial as _serial_mod
        except ImportError:
            print("ERROR: pyserial not installed.  Run: pip3 install pyserial",
                  file=sys.stderr)
            sys.exit(1)
        port = auto_detect_port(_serial_mod, _BAUD, verbose=_VERBOSE)
        if port is None:
            print(
                "\nERROR: auto-detect found no Ti60 on any ttyUSB port.\n"
                "  • Check: ls /dev/ttyUSB*\n"
                "  • Check: lsmod | grep ftdi\n"
                "  • Most common cause: BRAM zero-initialised — "
                "re-run patch_sapphire_init.py then re-synthesise.",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"Selected port: {port}")
        if _PROBE_ONLY:
            sys.exit(0)
    elif port is None:
        print("ERROR: specify --auto or --port=PATH", file=sys.stderr)
        sys.exit(1)

    if _RUN:
        run_bridge(port, _BAUD, _IDE_URL, verbose=_VERBOSE)
    else:
        print(f"Selected port: {port}")
        print("(pass --run to start forwarding, or --probe-only to exit after selection)")
