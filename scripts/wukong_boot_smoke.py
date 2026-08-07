#!/usr/bin/env python3
"""scripts/wukong_boot_smoke.py — Automated boot smoke test for the Wukong XC7A100T board.

Runs three acceptance checks without needing the full IDE bridge:

  (a) Waits up to SENTINEL_TIMEOUT seconds for the boot sentinel byte (0xBB or
      0xBC).  0xBC is the current format; 0xBB indicates a stale bitstream whose
      TraceUnit FSM emits a single RESULT packet for ELOADCALL/XLOADLAMBDA
      instead of the correct 3-packet CALL sequence (CALL_CR6+CALL_CR14+CALL_PUSH).
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
# 12-byte per-event packet: magic(1)+NIA(4)+ev_type(1)+payload(4)+flags(1)+fault(1)
# Must match TRACE_LEN in wukong_bridge.py and the TraceUnit in wukong_top.py.
TRACE_LEN        = 12
SENTINEL_V1      = 0xBB   # old/stale 2-byte sentinel (stale TraceUnit FSM)
SENTINEL_V2      = 0xBC   # current 3-byte sentinel
DEFAULT_PORT     = "/dev/ttyUSB0"
DEFAULT_BAUD     = 57600

# Minimum TU_VERSION required for correct ELOADCALL/XLOADLAMBDA tracing.
# Must match TU_VERSION_CALL_3PKT in hardware/wukong_bridge.py.
TU_VERSION_CALL_3PKT = 0x02


def _fault_name(code: int) -> str:
    names = {
        0: "NONE", 1: "PERM_R", 2: "PERM_W", 3: "PERM_E", 4: "PERM_L",
        5: "NULL_CAP", 6: "BOUNDS", 7: "SEAL", 8: "INVALID_OP",
        9: "STACK_UNDERFLOW", 10: "STACK_OVERFLOW",
    }
    return names.get(code, f"FAULT_{code}")


def _parse_trace_packet(pkt: bytes) -> dict:
    """Decode a 12-byte 0xAA trace packet.

    Packet layout (big-endian):
      [0]     magic     0xAA
      [1..4]  nia       retiring instruction NIA (uint32)
      [5]     ev_type   TRACE_EV_* constant
      [6..9]  payload   GT word0 (uint32); 0 for push/pop events
      [10]    flags     bits[3:0]=NZCV; bits[7:4]=0
      [11]    fault     bits[4:0]=fault_code; bit[6]=fault_valid; bit[7]=bp_hit

    Returns a dict with keys: nia, ev_type, payload_gt, flags,
    fault_valid, bp_hit, fault_code.
    """
    nia         = struct.unpack(">I", pkt[1:5])[0]
    ev_type     = pkt[5]
    payload_gt  = struct.unpack(">I", pkt[6:10])[0]
    flags       = pkt[10]
    raw11       = pkt[11]
    fault_valid = bool(raw11 & 0x40)
    bp_hit      = bool(raw11 & 0x80)
    fault_code  = raw11 & 0x1F
    return dict(nia=nia, ev_type=ev_type, payload_gt=payload_gt, flags=flags,
                fault_valid=fault_valid, bp_hit=bp_hit, fault_code=fault_code)


def check_sentinel(ser: "serial.Serial", timeout: float) -> bool:
    """(a) Wait up to *timeout* seconds for a boot sentinel byte (0xBB or 0xBC).

    0xBC is the current format; 0xBB means the bitstream is stale — the
    TraceUnit FSM emits RESULT instead of the 3-packet CALL sequence for
    ELOADCALL/XLOADLAMBDA, so CR6/CR14 state in the IDE will be wrong.

    Returns True on success (either format), prints a diagnostic and returns
    False if no sentinel is received within the timeout.
    """
    print(f"[a] Waiting up to {timeout} s for boot sentinel (0xBC current / "
          f"0xBB stale) …", flush=True)
    deadline = time.monotonic() + timeout
    buf = bytearray()

    while time.monotonic() < deadline:
        chunk = ser.read(128)
        if chunk:
            buf.extend(chunk)

        # Check for 0xBC (current 3-byte sentinel) first so it is not
        # shadowed by a search for 0xBB (which has a different prefix bit).
        if SENTINEL_V2 in buf:
            idx = buf.index(SENTINEL_V2)
            # Need all 3 bytes: magic + N_INIT + TU_VERSION.
            if len(buf) - idx < 3:
                # Not enough bytes yet; keep reading.
                continue
            tu_version = buf[idx + 2]
            elapsed = timeout - (deadline - time.monotonic())
            print(f"[a] PASS — 0x{SENTINEL_V2:02X} (current) sentinel received "
                  f"after {elapsed:.2f} s (buffer offset {idx})  "
                  f"TU_VERSION=0x{tu_version:02X}")
            if tu_version < TU_VERSION_CALL_3PKT:
                print(f"[a] BITSTREAM WARNING: TU_VERSION=0x{tu_version:02X} is below "
                      f"required 0x{TU_VERSION_CALL_3PKT:02X} — stale TraceUnit FSM.",
                      file=sys.stderr)
                print("     ELOADCALL/XLOADLAMBDA may not emit the 3-packet CALL sequence.",
                      file=sys.stderr)
                print("     CR6/CR14 state in the IDE may be wrong after any such instruction.",
                      file=sys.stderr)
                print("     Rebuild and reflash the bitstream to resolve this.",
                      file=sys.stderr)
            return True

        if SENTINEL_V1 in buf:
            idx = buf.index(SENTINEL_V1)
            elapsed = timeout - (deadline - time.monotonic())
            print(f"[a] PASS — 0x{SENTINEL_V1:02X} (stale) sentinel received "
                  f"after {elapsed:.2f} s (buffer offset {idx})")
            print("[a] BITSTREAM WARNING: old sentinel (0xBB) — stale "
                  "TraceUnit FSM.", file=sys.stderr)
            print("     ELOADCALL/XLOADLAMBDA emit RESULT not the 3-packet "
                  "CALL sequence.", file=sys.stderr)
            print("     CR6/CR14 state in the IDE will be wrong after any "
                  "such instruction.", file=sys.stderr)
            print("     Rebuild and reflash the bitstream to resolve this.",
                  file=sys.stderr)
            return True

    print(f"[a] FAIL — no boot sentinel received within {timeout} s.", file=sys.stderr)
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
                              f"ev_type=0x{info['ev_type']:02X}  "
                              f"payload_gt=0x{info['payload_gt']:08X}")
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
                        help="Seconds to wait for boot sentinel (default: 3)")
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
