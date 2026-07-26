#!/usr/bin/env python3
"""scripts/wukong_boot_smoke.py — Automated boot smoke test for the Wukong XC7A100T board.

Runs three acceptance checks without needing the full IDE bridge:

  (a) Waits up to SENTINEL_TIMEOUT seconds for the 0xBB boot sentinel byte.
  (c) Sends 'r' (run-free), then reads TRACE_TIMEOUT seconds of UART output
      and confirms at least one non-fault 0xAA trace packet arrived.

Exits 0 on pass, 1 on any failure.

Usage
-----
    python3 scripts/wukong_boot_smoke.py
    python3 scripts/wukong_boot_smoke.py --port /dev/ttyUSB1
    python3 scripts/wukong_boot_smoke.py --port /dev/ttyUSB0 --sentinel-timeout 5

Note: criterion (b) — LED[1] goes OFF — cannot be verified over UART; check it
visually at the bench.  This script covers the two automatable criteria.
"""

import argparse
import struct
import sys
import time

try:
    import serial
except ImportError:
    print("ERROR: pyserial not installed.  Run: pip install pyserial", file=sys.stderr)
    sys.exit(1)

TRACE_MAGIC      = 0xAA
TRACE_LEN        = 11
SENTINEL         = 0xBB
DEFAULT_PORT     = "/dev/ttyUSB0"
DEFAULT_BAUD     = 57600


def _fault_name(code: int) -> str:
    names = {
        0: "NONE", 1: "PERM_R", 2: "PERM_W", 3: "PERM_E", 4: "PERM_L",
        5: "NULL_CAP", 6: "BOUNDS", 7: "SEAL", 8: "INVALID_OP",
        9: "STACK_UNDERFLOW", 10: "STACK_OVERFLOW",
    }
    return names.get(code, f"FAULT_{code}")


def _parse_trace_packet(pkt: bytes) -> dict:
    """Decode an 11-byte 0xAA trace packet.  Returns a dict with fields:
       nia, instr, fault_valid, bp_hit, fault_code.
    """
    nia        = struct.unpack(">I", pkt[1:5])[0]
    instr      = struct.unpack(">I", pkt[5:9])[0]
    raw10      = pkt[10]
    fault_valid = bool(raw10 & 0x40)
    bp_hit      = bool(raw10 & 0x80)
    fault_code  = raw10 & 0x1F
    return dict(nia=nia, instr=instr, fault_valid=fault_valid,
                bp_hit=bp_hit, fault_code=fault_code)


def check_sentinel(ser: "serial.Serial", timeout: float) -> bool:
    """(a) Wait up to *timeout* seconds for the 0xBB sentinel byte.

    Returns True on success, prints a diagnostic and returns False on failure.
    """
    print(f"[a] Waiting up to {timeout} s for 0xBB sentinel …", flush=True)
    deadline = time.monotonic() + timeout
    buf = bytearray()

    while time.monotonic() < deadline:
        chunk = ser.read(128)
        if chunk:
            buf.extend(chunk)
            if SENTINEL in buf:
                idx = buf.index(SENTINEL)
                elapsed = timeout - (deadline - time.monotonic())
                print(f"[a] PASS — 0xBB received after {elapsed:.2f} s "
                      f"(buffer offset {idx})")
                return True

    print(f"[a] FAIL — 0xBB NOT received within {timeout} s.", file=sys.stderr)
    print("     Check: UART wiring (TX→F3, RX→E3, GND), baud=57600, "
          "DMEM hw_init logic in wukong_top.py.", file=sys.stderr)
    return False


def check_trace(ser: "serial.Serial", timeout: float) -> bool:
    """(c) Send 'r', then confirm at least one non-fault trace packet arrives
    within *timeout* seconds.

    Returns True on success, prints diagnostics and returns False on failure.
    """
    print(f"[c] Sending 'r' (run-free) …", flush=True)
    ser.write(b"r")

    print(f"[c] Waiting up to {timeout} s for a non-fault trace packet …",
          flush=True)
    deadline = time.monotonic() + timeout
    buf = bytearray()
    good_packets   = 0
    fault_packets  = 0

    while time.monotonic() < deadline:
        chunk = ser.read(128)
        if chunk:
            buf.extend(chunk)

        i = 0
        while i < len(buf):
            b = buf[i]
            if b == TRACE_MAGIC:
                if len(buf) - i < TRACE_LEN:
                    break
                pkt  = bytes(buf[i:i + TRACE_LEN])
                info = _parse_trace_packet(pkt)
                if info["fault_valid"]:
                    fault_packets += 1
                    fc = _fault_name(info["fault_code"])
                    print(f"  [c] fault packet: NIA=0x{info['nia']:08X}  {fc}")
                else:
                    good_packets += 1
                    if good_packets == 1:
                        elapsed = timeout - (deadline - time.monotonic())
                        print(f"[c] PASS — first non-fault trace packet received "
                              f"after {elapsed:.2f} s  "
                              f"NIA=0x{info['nia']:08X}  "
                              f"instr=0x{info['instr']:08X}")
                i += TRACE_LEN
            else:
                i += 1
        del buf[:i]

        if good_packets > 0:
            if fault_packets:
                print(f"     (also saw {fault_packets} fault packet(s) — "
                      f"may be transient boot faults; check if expected)")
            return True

    print(f"[c] FAIL — no non-fault trace packet within {timeout} s.", file=sys.stderr)
    if fault_packets:
        print(f"     Saw {fault_packets} fault packet(s) only — "
              "CM faulted before reaching the NUC loop.", file=sys.stderr)
        print("     Check: BOOT_PROGRAM encoding in wukong_top.py, "
              "and CR14/NS/c-list initialisation.", file=sys.stderr)
    else:
        print("     No trace packets at all — CM may still be in step_mode=1 "
              "(halted) or the 'r' byte was not received.", file=sys.stderr)
        print("     Check: UART TX line, and that boot_triggered asserted.", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wukong board boot smoke test (criteria a + c)")
    parser.add_argument("--port", default=DEFAULT_PORT,
                        help=f"Serial port (default: {DEFAULT_PORT})")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD,
                        help=f"Baud rate (default: {DEFAULT_BAUD})")
    parser.add_argument("--sentinel-timeout", type=float, default=3.0,
                        metavar="S",
                        help="Seconds to wait for 0xBB sentinel (default: 3)")
    parser.add_argument("--trace-timeout", type=float, default=3.0,
                        metavar="S",
                        help="Seconds to collect trace packets after 'r' (default: 3)")
    args = parser.parse_args()

    print(f"Wukong boot smoke test  —  {args.port} @ {args.baud} baud")
    print("-" * 60)

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.05)
    except serial.SerialException as exc:
        print(f"ERROR: cannot open {args.port}: {exc}", file=sys.stderr)
        return 1

    results = {}
    try:
        results["a"] = check_sentinel(ser, args.sentinel_timeout)
        if not results["a"]:
            print("\nStopping — sentinel not received; criterion (c) skipped.",
                  file=sys.stderr)
            return 1
        results["c"] = check_trace(ser, args.trace_timeout)
    finally:
        ser.close()

    print("-" * 60)
    passed = all(results.values())
    if passed:
        print("RESULT: PASS — board booted and is executing correctly.")
        print("NOTE:   Criterion (b) — D2 goes OFF — must be verified visually.")
    else:
        failed = [k for k, v in results.items() if not v]
        print(f"RESULT: FAIL — criterion(s) failed: {', '.join(f'({f})' for f in failed)}",
              file=sys.stderr)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
