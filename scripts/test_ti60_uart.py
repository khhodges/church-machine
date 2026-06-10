#!/usr/bin/env python3
"""
test_ti60_uart.py — Ti60F225 SoC UART smoke-test
==================================================

Verifies the Ti60 Sapphire SoC firmware is running correctly by checking
for expected output on the SoC UART (ttyUSB2 / FT4232H interface 2).

Checks performed:
  1. GREETING      — "CHURCH Ti60 SoC+CM" present in first output
  2. BOOT_COMPLETE — "CM boot_complete: 1" line seen (or inferred from CALLHOME)
  3. NIA_LINES     — At least one "NIA=0x..." line seen
  4. CALLHOME_JSON — At least one valid CALLHOME:{...} JSON line seen
  5. FW_V2         — Firmware reports fw_major >= 2 (mandatory, v2.0+)
  6. NS_MANIFEST   — ns_manifest field present in CALLHOME (mandatory, v2.0+)
  7. TRACE         — At least one valid TRACE:[...] line seen (optional)
  8. FAULT_EVENT   — At least one valid FAULT_EVENT:{...} line seen (optional)
  9. HUNG          — At least one valid HUNG:{...} line seen (optional)
 10. ACK           — IDE call-home ACK received (optional, requires --ide=URL)

Exit codes:
  0 — all mandatory checks pass
  1 — one or more mandatory checks failed

Usage:
    python3 scripts/test_ti60_uart.py --dry-run
    python3 scripts/test_ti60_uart.py [--port=/dev/ttyUSB2] [--timeout=10] [--ide=URL]

Flags:
    --dry-run              Run parser logic against canned transcript; no serial
                           port required.  Suitable for CI.
    --port=PATH            Serial port to open (default: /dev/ttyUSB2)
    --baud=N               Baud rate (default: 115200)
    --timeout=N            Seconds to wait for output in live mode (default: 10)
    --ide=URL              Check for a call-home ACK from the IDE server at URL
                           (optional; skipped if not provided)
    --report-launch=TEST-NN  On completion, POST the overall PASS/FAIL result to
                           the IDE launch-test tracker at /api/launch-tests/TEST-NN.
                           Requires --ide=URL.  Recommended ID: TEST-09 (UART).
    --verbose              Print each received line with its timestamp
"""

import sys
import json
import time

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
_DRY_RUN = False
_SERIAL_PORT = '/dev/ttyUSB2'
_BAUD = 115200
_TIMEOUT = 10.0
_IDE_SERVER_URL = None
_REPORT_LAUNCH_ID = None
_VERBOSE = False

for _a in sys.argv[1:]:
    if _a == '--dry-run':
        _DRY_RUN = True
    elif _a.startswith('--port='):
        _SERIAL_PORT = _a[7:]
    elif _a.startswith('--baud='):
        _BAUD = int(_a[7:])
    elif _a.startswith('--timeout='):
        _TIMEOUT = float(_a[10:])
    elif _a.startswith('--ide='):
        _IDE_SERVER_URL = _a[6:].rstrip('/')
    elif _a.startswith('--report-launch='):
        _REPORT_LAUNCH_ID = _a[len('--report-launch='):]
    elif _a == '--verbose':
        _VERBOSE = True
    elif _a in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    elif _a.startswith('--'):
        print(f"WARNING: unknown flag {_a!r} ignored", file=sys.stderr)

# ---------------------------------------------------------------------------
# Canned transcript used by --dry-run
# ---------------------------------------------------------------------------
DRY_RUN_TRANSCRIPT = [
    # Boot banner and UID (firmware v2.0)
    "CHURCH Ti60 SoC+CM v2.0",
    "UID=c0ffee0100000001",
    "Waiting for CM boot_complete...",
    # First CALLHOME — live NIA + ns_manifest (token_32 = sha32(ogt), real values)
    'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001","nia":"0x00000042",'
    '"boot_ok":1,"boot_reason":0,"fault":0,"fault_code":0,"fault_name":"UNKNOWN",'
    '"fw_major":2,"fw_minor":0,"ns_manifest":['
    '{"ogt":"global.Core.BoardIdentity.boot","token_32":"0x68706247","label":"Board.Identity","resident":true},'
    '{"ogt":"global.Core.Heartbeat.boot","token_32":"0x416d6848","label":"Heartbeat","resident":true}'
    ']}',
    # Live NIA line from APB3 register
    "NIA=0x00000042",
    # 10-Hz NIA trace buffer (10 samples, 1-second window)
    'TRACE:["0x00000042","0x00000043","0x00000044","0x00000045","0x00000046",'
    '"0x00000047","0x00000048","0x00000049","0x0000004a","0x0000004b"]',
    # Second heartbeat CALLHOME (no ns_manifest — bridge re-sync only on first boot)
    'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001","nia":"0x0000004c",'
    '"boot_ok":1,"boot_reason":0,"fault":0,"fault_code":0,"fault_name":"UNKNOWN",'
    '"fw_major":2,"fw_minor":0}',
    "NIA=0x0000004c",
    # Fault event — CM raised PERM_X; firmware reads APB3 GT/INSTR/CR14/STAGE
    'FAULT_EVENT:{"uid":"c0ffee0100000001","nia":"0x0000004c","fault_code":3,'
    '"fault_name":"PERM_X","fault_gt":"0x01800003","fault_instr":"0x12345678",'
    '"fault_cr14":"0x00000010","fault_stage":2}',
    # Hung watchdog — NIA unchanged for 3 consecutive 1-second samples → CM reset
    'HUNG:{"uid":"c0ffee0100000001","nia":"0x0000abcd","loops":3}',
]

# ---------------------------------------------------------------------------
# Parser — validates CALLHOME JSON lines
# ---------------------------------------------------------------------------

def parse_callhome(line):
    """
    Parse a CALLHOME:{...} line.
    Returns a dict on success, None on parse failure.
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
        errors.append(f"fw_major must be a non-negative integer, got {pkt.get('fw_major')!r}")
    if "fw_minor" in pkt and (not isinstance(pkt["fw_minor"], int) or pkt["fw_minor"] < 0):
        errors.append(f"fw_minor must be a non-negative integer, got {pkt.get('fw_minor')!r}")
    return errors


def parse_fault_event(line):
    """
    Parse a FAULT_EVENT:{...} line (firmware v2.0+).
    Returns a dict on success, None on parse failure or missing required fields.
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


def parse_hung(line):
    """
    Parse a HUNG:{...} line (firmware v2.0+ hung-CM watchdog).
    Returns a dict on success, None on parse failure or missing required fields.
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


def parse_trace(line):
    """
    Parse a TRACE:[...] line (firmware v2.0+ 10-Hz NIA sampler).
    Returns a non-empty list of NIA strings on success, None otherwise.
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
# Check results tracker
# ---------------------------------------------------------------------------

class CheckResult:
    def __init__(self, name, description, mandatory=True):
        self.name = name
        self.description = description
        self.mandatory = mandatory
        self.passed = False
        self.detail = ""

    def mark_pass(self, detail=""):
        self.passed = True
        self.detail = detail

    def mark_fail(self, detail=""):
        self.passed = False
        self.detail = detail

    def status_str(self):
        icon = "PASS" if self.passed else ("FAIL" if self.mandatory else "SKIP")
        detail = f"  ({self.detail})" if self.detail else ""
        return f"  [{icon}]  {self.name}: {self.description}{detail}"


def _make_checks():
    return [
        CheckResult("GREETING",      "SoC boot greeting present"),
        CheckResult("BOOT_COMPLETE", "CM boot_complete line seen (or inferred)"),
        CheckResult("NIA_LINES",     "At least one NIA=0x... line seen"),
        CheckResult("CALLHOME_JSON", "At least one valid CALLHOME JSON line seen"),
        CheckResult("FW_V2",         "Firmware reports fw_major >= 2"),
        CheckResult("NS_MANIFEST",   "ns_manifest field present in CALLHOME"),
        CheckResult("TRACE",         "At least one valid TRACE line seen",       mandatory=False),
        CheckResult("FAULT_EVENT",   "At least one valid FAULT_EVENT line seen", mandatory=False),
        CheckResult("HUNG",          "At least one valid HUNG line seen",         mandatory=False),
        CheckResult("ACK",           "IDE call-home ACK received",               mandatory=False),
    ]

# ---------------------------------------------------------------------------
# Line processing
# ---------------------------------------------------------------------------

def process_lines(lines, checks, verbose=False):
    """
    Feed lines through the checks.  Modifies check objects in place.
    Returns True if all mandatory checks pass.
    """
    checks_by_name = {c.name: c for c in checks}
    callhome_seen = 0
    callhome_errors = []

    for line in lines:
        if verbose:
            print(f"    > {line}")

        if "CHURCH Ti60 SoC+CM" in line:
            checks_by_name["GREETING"].mark_pass(f"saw: {line!r}")

        if line.startswith("CALLHOME:"):
            _g = parse_callhome(line)
            if _g and "Ti60" in _g.get("board", ""):
                if not checks_by_name["GREETING"].passed:
                    checks_by_name["GREETING"].mark_pass(
                        f"inferred from CALLHOME board={_g['board']!r}"
                    )

        if "CM boot_complete: 1" in line:
            checks_by_name["BOOT_COMPLETE"].mark_pass()

        if line.startswith("CALLHOME:"):
            _pkt = parse_callhome(line)
            if _pkt and _pkt.get("boot_ok") == 1:
                if not checks_by_name["BOOT_COMPLETE"].passed:
                    checks_by_name["BOOT_COMPLETE"].mark_pass(
                        "inferred from CALLHOME boot_ok:1"
                    )

        if line.startswith("NIA=") and "0x" in line:
            checks_by_name["NIA_LINES"].mark_pass(f"first: {line!r}")

        if line.startswith("CALLHOME:"):
            pkt = parse_callhome(line)
            if pkt is None:
                callhome_errors.append(f"JSON parse failed: {line!r}")
            else:
                errs = validate_callhome(pkt)
                if errs:
                    callhome_errors.append(f"validation errors {errs} in {line!r}")
                else:
                    callhome_seen += 1
                    fw_str = ""
                    if "fw_major" in pkt and "fw_minor" in pkt:
                        fw_str = f" fw={pkt['fw_major']}.{pkt['fw_minor']}"
                    checks_by_name["CALLHOME_JSON"].mark_pass(
                        f"{callhome_seen} valid packet(s); last board={pkt['board']}{fw_str} nia={pkt['nia']}"
                    )
                    # FW_V2: firmware reports fw_major >= 2 (v2.0+)
                    if pkt.get("fw_major", 0) >= 2:
                        checks_by_name["FW_V2"].mark_pass(
                            f"fw_major={pkt['fw_major']}"
                        )
                    # NS_MANIFEST: non-empty ns_manifest array present
                    manifest = pkt.get("ns_manifest")
                    if isinstance(manifest, list) and manifest:
                        checks_by_name["NS_MANIFEST"].mark_pass(
                            f"{len(manifest)} abstraction(s)"
                        )

        # TRACE:[...] — firmware v2.0 10-Hz NIA sampler
        if line.startswith("TRACE:"):
            t = parse_trace(line)
            if t is not None:
                checks_by_name["TRACE"].mark_pass(f"{len(t)} NIA sample(s)")

        # FAULT_EVENT:{...} — firmware v2.0 structured fault record
        if line.startswith("FAULT_EVENT:"):
            fe = parse_fault_event(line)
            if fe is not None:
                checks_by_name["FAULT_EVENT"].mark_pass(
                    f"fault_name={fe.get('fault_name')!r} nia={fe.get('nia')}"
                )

        # HUNG:{...} — firmware v2.0 hung-CM watchdog
        if line.startswith("HUNG:"):
            h = parse_hung(line)
            if h is not None:
                checks_by_name["HUNG"].mark_pass(
                    f"nia={h.get('nia')} loops={h.get('loops')}"
                )

    # Report any CALLHOME parse/validation failures
    if callhome_errors and not checks_by_name["CALLHOME_JSON"].passed:
        checks_by_name["CALLHOME_JSON"].mark_fail(
            f"{len(callhome_errors)} error(s): {callhome_errors[0]}"
        )

    return all(c.passed for c in checks if c.mandatory)


# ---------------------------------------------------------------------------
# IDE ACK check
# ---------------------------------------------------------------------------

def check_ide_ack(ide_url, uid):
    """
    Poll the IDE server to see if the Ti60 device has registered.
    Returns (passed, detail).
    """
    if not ide_url:
        return False, "no --ide=URL configured (optional check skipped)"
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{ide_url}/api/device/list",
            method="GET",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read())
        devices = data if isinstance(data, list) else data.get("devices", [])
        for dev in devices:
            board = dev.get("board_type", "")
            if "Ti60" in board or board == "Ti60F225":
                return True, f"board {board!r} found in IDE device list"
        return False, f"Ti60F225 not found in IDE device list ({len(devices)} device(s) present)"
    except Exception as e:
        return False, f"IDE query failed: {e}"


# ---------------------------------------------------------------------------
# Dry-run mode
# ---------------------------------------------------------------------------

def run_dry_run():
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Ti60 UART Smoke-test  —  DRY-RUN MODE")
    print("  (parsing canned transcript; no serial port needed)")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    checks = _make_checks()
    ok = process_lines(DRY_RUN_TRANSCRIPT, checks, verbose=_VERBOSE)

    # ACK check — skip in dry-run (no IDE server)
    ack_check = next(c for c in checks if c.name == "ACK")
    ack_check.mark_fail("dry-run mode — IDE ACK check skipped")

    _print_results(checks, mode="dry-run")
    return ok


# ---------------------------------------------------------------------------
# Live mode
# ---------------------------------------------------------------------------

def run_live():
    try:
        import serial as _serial
    except ImportError:
        print("ERROR: pyserial not installed.  Run:  pip3 install pyserial")
        sys.exit(1)

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Ti60 UART Smoke-test  —  LIVE MODE")
    print(f"  Port: {_SERIAL_PORT}  Baud: {_BAUD}  Timeout: {_TIMEOUT}s")
    if _IDE_SERVER_URL:
        print(f"  IDE:  {_IDE_SERVER_URL}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    try:
        s = _serial.Serial(_SERIAL_PORT, _BAUD, timeout=0)
        s.setRTS(False)
        s.setDTR(False)
    except Exception as e:
        print(f"ERROR: could not open {_SERIAL_PORT}: {e}")
        print()
        print("Diagnostics:")
        print("  • The Ti60 FT4232H maps four interfaces to ttyUSB0–ttyUSB3.")
        print("  • The Sapphire SoC UART is on ttyUSB2 (interface 2).")
        print("  • Run: ls /dev/ttyUSB* to list available ports.")
        print("  • Run: lsmod | grep ftdi to verify the FT4232H driver is loaded.")
        sys.exit(1)

    print(f"  Opened {_SERIAL_PORT}.  Waiting up to {_TIMEOUT:.0f}s for firmware output…")
    print()

    lines_received = []
    buf = b""
    deadline = time.monotonic() + _TIMEOUT

    while time.monotonic() < deadline:
        try:
            waiting = s.in_waiting
        except Exception:
            waiting = 0
        if waiting:
            chunk = s.read(waiting)
            buf += chunk
            while b'\n' in buf:
                idx = buf.index(b'\n')
                raw = buf[:idx]
                buf = buf[idx + 1:]
                line = raw.rstrip(b'\r').decode('utf-8', errors='replace')
                if line:
                    lines_received.append(line)
                    if _VERBOSE:
                        print(f"  [{time.monotonic():.2f}s] {line}")
        else:
            time.sleep(0.02)

    try:
        s.close()
    except Exception:
        pass

    print(f"  Received {len(lines_received)} line(s).")
    print()

    checks = _make_checks()
    ok = process_lines(lines_received, checks, verbose=False)

    # ACK check
    ack_check = next(c for c in checks if c.name == "ACK")
    if _IDE_SERVER_URL:
        uid = None
        for line in lines_received:
            pkt = parse_callhome(line)
            if pkt:
                uid = pkt.get("uid")
                break
        ack_passed, ack_detail = check_ide_ack(_IDE_SERVER_URL, uid)
        if ack_passed:
            ack_check.mark_pass(ack_detail)
        else:
            ack_check.mark_fail(ack_detail)
    else:
        ack_check.mark_fail("no --ide=URL provided (optional check skipped)")

    _print_results(checks, mode="live")
    return ok


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _print_results(checks, mode):
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"  RESULTS ({mode}):")
    print()
    for c in checks:
        print(c.status_str())
    print()
    mandatory_pass = all(c.passed for c in checks if c.mandatory)
    if mandatory_pass:
        print("  OVERALL: PASS")
    else:
        failed = [c.name for c in checks if c.mandatory and not c.passed]
        print(f"  OVERALL: FAIL  (failed: {', '.join(failed)})")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")


# ---------------------------------------------------------------------------
# Launch-test reporting
# ---------------------------------------------------------------------------

def _report_launch_test(test_id, status, notes=""):
    """
    POST a launch-test status update to the IDE server.

    Mirrors the pattern used in server/local_bridge.py:_report_launch_test.
    status must be "passing" or "failing".
    Requires _IDE_SERVER_URL to be set.
    """
    if not _IDE_SERVER_URL:
        print(f'  [LAUNCH] Cannot report {test_id}: no --ide=URL configured',
              file=sys.stderr)
        return
    try:
        import urllib.request
        payload = json.dumps({
            "status": status,
            "device_uid": "",
            "notes": notes,
        }).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/launch-tests/{test_id}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        if result.get("ok"):
            print(f'  [LAUNCH] {test_id} reported as {status}')
        else:
            print(f'  [LAUNCH] {test_id} report failed: {result}', file=sys.stderr)
    except Exception as e:
        print(f'  [LAUNCH] {test_id} report error: {e}', file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if _DRY_RUN:
        success = run_dry_run()
    else:
        success = run_live()

    if _REPORT_LAUNCH_ID:
        if _IDE_SERVER_URL:
            status = "passing" if success else "failing"
            notes = (
                "Ti60 UART smoke-test PASS (dry-run)" if (_DRY_RUN and success)
                else "Ti60 UART smoke-test PASS" if success
                else "Ti60 UART smoke-test FAIL"
            )
            _report_launch_test(_REPORT_LAUNCH_ID, status, notes)
        else:
            print(
                f"  [LAUNCH] --report-launch={_REPORT_LAUNCH_ID} set but "
                "--ide=URL is missing; skipping launch-test report.",
                file=sys.stderr,
            )

    sys.exit(0 if success else 1)
