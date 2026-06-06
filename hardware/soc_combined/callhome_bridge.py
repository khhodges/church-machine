#!/usr/bin/env python3
"""
Church Machine Ti60 Call-Home Bridge
======================================
Reads the Sapphire SoC UART on ttyUSB2 (FT4232H interface 2), extracts
CALLHOME JSON lines emitted by the firmware, and forwards them to the
Church Machine IDE server via /api/device/call-home.

The Ti60 FT4232H USB-UART mapping:
  ttyUSB0  — JTAG (interface 0)
  ttyUSB1  — SPI/debug (interface 1)
  ttyUSB2  — Sapphire SoC UART0   ← this bridge
  ttyUSB3  — Church Machine debug UART

Usage:
    python3 hardware/soc_combined/callhome_bridge.py [--port=/dev/ttyUSB2] [--ide=URL]

Flags:
    --port=PATH    Serial port to open (default: /dev/ttyUSB2)
    --baud=N       Baud rate (default: 57600 — 25 MHz crystal, CLOCKDIV=53)
    --ide=URL      IDE server base URL, e.g. http://localhost:5000
                   Enables call-home POSTs to /api/device/call-home.
    --reconnect    Automatically reconnect on serial errors (default: on)
    --no-reconnect Disable automatic reconnect.
    --report-launch  After the first CALLHOME with boot_ok=1, PUT
                   TEST-09 as passing to /api/launch-tests/TEST-09.
                   Requires --ide=URL.
"""

import sys
import json
import time
import threading

try:
    import serial
except ImportError:
    print("ERROR: pyserial not installed.  Run:  pip3 install pyserial")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
_SERIAL_PORT = '/dev/ttyUSB2'
_BAUD = 57600
_IDE_SERVER_URL = None
_AUTO_RECONNECT = True
_REPORT_LAUNCH = False

for _a in sys.argv[1:]:
    if _a.startswith('--port='):
        _SERIAL_PORT = _a[7:]
    elif _a.startswith('--baud='):
        _BAUD = int(_a[7:])
    elif _a.startswith('--ide='):
        _IDE_SERVER_URL = _a[6:].rstrip('/')
    elif _a == '--no-reconnect':
        _AUTO_RECONNECT = False
    elif _a == '--reconnect':
        _AUTO_RECONNECT = True
    elif _a == '--report-launch':
        _REPORT_LAUNCH = True
    elif _a.startswith('--'):
        print(f"WARNING: unknown flag {_a!r} ignored", file=sys.stderr)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_ser_lock = threading.Lock()
_ser = None
_stop_event = threading.Event()
_last_uid = None

_uart_buffer = []
_uart_buffer_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_port(port, baud):
    s = serial.Serial(port, baud, timeout=0)
    s.setRTS(False)
    s.setDTR(False)
    return s


_launch_test_reported = set()


def _report_launch_test(test_id, status="passing", notes=""):
    """PUT a launch-test result to /api/launch-tests/<test_id> on the IDE server."""
    global _launch_test_reported
    if not _IDE_SERVER_URL:
        return
    if test_id in _launch_test_reported and status == "passing":
        return
    import urllib.request
    try:
        body = json.dumps({
            "status": status,
            "device_uid": _last_uid or "",
            "notes": notes,
        }).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/launch-tests/{test_id}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        if result.get("ok"):
            print(f"  [LAUNCH] {test_id} reported as {status}")
            if status == "passing":
                _launch_test_reported.add(test_id)
        else:
            print(f"  [LAUNCH] {test_id} report failed: {result}", file=sys.stderr)
    except Exception as e:
        print(f"  [LAUNCH] {test_id} report error: {e}", file=sys.stderr)


def _post_callhome(payload):
    """POST a call-home payload dict to /api/device/call-home on the IDE server."""
    if not _IDE_SERVER_URL:
        return
    import urllib.request
    try:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/call-home",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        if result.get("ok"):
            ack_str = "[CALL HOME] ACK received from IDE"
            if result.get("boot_count"):
                ack_str += f" — boot #{result['boot_count']}"
            print(f"  {ack_str}")
            with _uart_buffer_lock:
                _uart_buffer.append({
                    "ts":   time.time(),
                    "line": ack_str,
                    "uid":  _last_uid or "unknown",
                })
        else:
            print(f"  [CALL HOME] IDE responded: {result}")
    except Exception as e:
        print(f"  [CALL HOME] POST failed: {e}")


def _handle_callhome_json(line):
    """
    Parse a CALLHOME:{...} line, print a human summary, and POST to the IDE.

    Expected JSON fields (from firmware/main.c uart_emit_callhome):
        board       str   e.g. "Ti60F225"
        uid         str   16-hex-char device UID
        nia         str   e.g. "0x00001234"
        boot_ok     int   1 if boot complete
        fault       int   1 if fault_latched
        fault_code  int   fault code (0-31)
        fw_major    int   firmware major version (default 1)
        fw_minor    int   firmware minor version (default 0)
    """
    global _last_uid
    json_str = line[len("CALLHOME:"):].strip()
    try:
        pkt = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  [CALL HOME] JSON parse error: {e}  raw={json_str!r}")
        return

    board      = pkt.get("board", "?")
    uid        = pkt.get("uid", "0" * 16)
    nia        = pkt.get("nia", "0x0")
    boot_ok    = int(pkt.get("boot_ok", 0))
    fault      = int(pkt.get("fault", 0))
    fault_code = int(pkt.get("fault_code", 0))
    fw_major   = int(pkt.get("fw_major", 1))
    fw_minor   = int(pkt.get("fw_minor", 0))
    cr14       = pkt.get("cr14", None)   # GT of active LUMP — None if firmware omits it
    cr12       = pkt.get("cr12", None)   # namespace chain root — None if firmware omits it
    cr15       = pkt.get("cr15", None)   # namespace root — None if firmware omits it

    _last_uid = uid

    fault_str = f"  FAULT={fault_code}" if fault else ""
    cr_str = f"  CR14={cr14}" if cr14 is not None else ""
    print(f"  [CALL HOME] {board}  UID={uid}  NIA={nia}  boot_ok={boot_ok}  FW={fw_major}.{fw_minor}{fault_str}{cr_str}")

    if _REPORT_LAUNCH and boot_ok and _IDE_SERVER_URL:
        threading.Thread(
            target=_report_launch_test,
            args=("TEST-09",),
            kwargs={"status": "passing", "notes": f"CALLHOME boot_ok=1 from {board} UID={uid} FW={fw_major}.{fw_minor}"},
            daemon=True,
        ).start()

    if _IDE_SERVER_URL:
        payload = {
            "board_type":    board,
            "device_uid":    uid,
            "nia":           nia,
            "boot_complete": boot_ok,
            "fault_latched": fault,
            "fault_code":    fault_code,
            "fw_major":      fw_major,
            "fw_minor":      fw_minor,
        }
        if cr14 is not None:
            payload["cr14"] = cr14
        if cr12 is not None:
            payload["cr12"] = cr12
        if cr15 is not None:
            payload["cr15"] = cr15
        threading.Thread(
            target=_post_callhome,
            args=(payload,),
            daemon=True,
        ).start()


def _flush_uart_buffer():
    """Background thread: POST buffered plain-text UART lines to the IDE every 500 ms."""
    import urllib.request
    while not _stop_event.is_set():
        time.sleep(0.5)
        if not _IDE_SERVER_URL:
            continue
        with _uart_buffer_lock:
            if not _uart_buffer:
                continue
            batch = list(_uart_buffer)
            _uart_buffer.clear()
        try:
            body = json.dumps({"lines": batch}).encode()
            req = urllib.request.Request(
                f"{_IDE_SERVER_URL}/api/device/uart-log",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            print(f"  [bridge] uart-log POST failed: {e}")


def _process_line(line):
    """Route a decoded text line to the appropriate handler."""
    if line.startswith("CALLHOME:"):
        _handle_callhome_json(line)
    else:
        print(f"  {line}")
        if _IDE_SERVER_URL:
            with _uart_buffer_lock:
                _uart_buffer.append({
                    "ts":   time.time(),
                    "line": line,
                    "uid":  _last_uid or "unknown",
                })


# ---------------------------------------------------------------------------
# Reader thread
# ---------------------------------------------------------------------------

def _reader_thread(port, baud):
    global _ser
    buf = b""
    while not _stop_event.is_set():
        with _ser_lock:
            s = _ser
        if s is None or not s.is_open:
            time.sleep(0.1)
            continue
        try:
            waiting = s.in_waiting
            if waiting:
                chunk = s.read(waiting)
                buf += chunk
                while b'\n' in buf:
                    idx = buf.index(b'\n')
                    raw = buf[:idx]
                    buf = buf[idx + 1:]
                    line = raw.rstrip(b'\r').decode('utf-8', errors='replace')
                    if line:
                        _process_line(line)
            else:
                time.sleep(0.005)
        except serial.SerialException as e:
            print(f"  [bridge] Serial error: {e}")
            with _ser_lock:
                try:
                    _ser.close()
                except Exception:
                    pass
                _ser = None
            if _AUTO_RECONNECT:
                print(f"  [bridge] Reconnecting in 2 s…")
                time.sleep(2)
                _reconnect(port, baud)
            else:
                _stop_event.set()
        except Exception as e:
            print(f"  [bridge] Unexpected error in reader: {e}")
            time.sleep(0.05)


def _reconnect(port, baud):
    global _ser
    for attempt in range(1, 11):
        try:
            s = _open_port(port, baud)
            with _ser_lock:
                _ser = s
            print(f"  [bridge] Reconnected to {port}")
            return
        except Exception as e:
            print(f"  [bridge] Reconnect attempt {attempt}/10 failed: {e}")
            time.sleep(2)
    print("  [bridge] Could not reconnect after 10 attempts — giving up.")
    _stop_event.set()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global _ser
    print("Church Machine Ti60 Call-Home Bridge")
    print(f"  Port   : {_SERIAL_PORT} @ {_BAUD} baud")
    if _IDE_SERVER_URL:
        print(f"  IDE    : {_IDE_SERVER_URL}")
    else:
        print("  IDE    : (not configured — use --ide=URL to enable call-home)")
    if _REPORT_LAUNCH:
        if _IDE_SERVER_URL:
            print("  Launch : TEST-09 will be reported passing on first boot_ok=1 CALLHOME")
        else:
            print("  Launch : --report-launch set but --ide=URL missing; reporting disabled")
    print()
    print("Press Ctrl+C to stop.")
    print()

    try:
        s = _open_port(_SERIAL_PORT, _BAUD)
        with _ser_lock:
            _ser = s
        print(f"  [bridge] Opened {_SERIAL_PORT}")
    except Exception as e:
        print(f"ERROR: could not open {_SERIAL_PORT}: {e}")
        print()
        print("Hint: The Ti60 FT4232H exposes four USB-UART interfaces:")
        print("  ttyUSB0 — JTAG")
        print("  ttyUSB1 — SPI/debug")
        print("  ttyUSB2 — Sapphire SoC UART0  (this bridge)")
        print("  ttyUSB3 — Church Machine debug UART")
        print()
        print("If ttyUSB2 is not present, try --port=/dev/ttyUSB3 or --port=/dev/ttyACM0")
        sys.exit(1)

    t = threading.Thread(target=_reader_thread, args=(_SERIAL_PORT, _BAUD), daemon=True)
    t.start()

    f = threading.Thread(target=_flush_uart_buffer, daemon=True)
    f.start()

    try:
        while not _stop_event.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print()
        print("  [bridge] Stopping.")
    finally:
        _stop_event.set()
        with _ser_lock:
            if _ser and _ser.is_open:
                _ser.close()


if __name__ == '__main__':
    main()
