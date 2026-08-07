#!/usr/bin/env python3
"""hardware/wukong_bridge.py — UART bridge: Wukong board ↔ Church Machine IDE.

Usage
-----
    python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=https://<your-replit-url>
    python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=http://localhost:5000 --insecure

What it does
------------
Reads bytes from the UART (57600 8N1):
  • ASCII bytes (bit-7 clear) are printed to stdout as CM program output.
  • 0xAA-prefixed 12-byte trace packets are parsed and POSTed to
    /hardware/wukong/trace as JSON.

Polls GET /hardware/wukong/command every 50 ms and writes any pending command
byte to the serial port.  Commands from the IDE:

  {cmd: "s"}           → write b's'  (step: execute one instruction)
  {cmd: "r"}           → write b'r'  (run free)
  {cmd: "h"}           → write b'h'  (halt immediately)
  {cmd: "b", nia: N}   → write b'b' + big-endian 4-byte NIA  (set/clear breakpoint)

Trace packet format (12 bytes, big-endian) — one packet per state-change event:
  [0]     0xAA      magic
  [1..4]  NIA       retiring instruction NIA (uint32 big-endian)
  [5]     ev_type   TRACE_EV_* constant (which CR changed, or stack push/pop)
  [6..9]  payload   GT word0 (uint32 big-endian); 0 for push/pop events
  [10]    flags     bits[3:0] = NZCV; bits[7:4] = 0
  [11]    fault     bits[4:0]=fault_code; bit[6]=fault_valid; bit[7]=bp_hit

Multi-event instructions emit multiple consecutive packets with the same NIA:
  LOAD    → 2 packets (LOAD.shadow, LOAD.new)
  CHANGE  → 3 packets (CHANGE.push, CHANGE.CR12, CHANGE.CR5)
  CALL    → 3 packets (CALL.CR6, CALL.CR14, CALL.push)
  RETURN  → 3 packets (RETURN.pop, RETURN.CR6, RETURN.CR14)
  others  → 1 packet  (RESULT)
"""

import argparse
import os
import struct
import sys
import time

try:
    import serial
except ImportError:
    print("ERROR: pyserial not installed.  Run: pip install pyserial", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed.  Run: pip install requests", file=sys.stderr)
    sys.exit(1)


TRACE_MAGIC    = 0xAA
TRACE_LEN      = 12   # 12-byte per-event packet: magic(1)+NIA(4)+ev_type(1)+payload(4)+flags(1)+fault(1)

# ── Event type constants ──────────────────────────────────────────────────────
# Must match _TRACE_EV_* in wukong_top.py and docs/debug-packet-protocol.md.
TRACE_EV_RESULT      = 0x00  # Single-packet result (DR→DR, SAVE, Function, etc.)
TRACE_EV_LOAD_SHADOW = 0x01  # LOAD: old CR_dst GT displaced
TRACE_EV_LOAD_NEW    = 0x02  # LOAD: new GT installed in CR_dst
TRACE_EV_CHANGE_PUSH = 0x03  # CHANGE: context stack push
TRACE_EV_CHANGE_CR12 = 0x04  # CHANGE: CR12 ← new thread GT
TRACE_EV_CHANGE_CR5  = 0x05  # CHANGE: CR5  ← heap GT
TRACE_EV_CALL_CR6    = 0x06  # CALL:   CR6  ← abstraction GT
TRACE_EV_CALL_CR14   = 0x07  # CALL:   CR14 ← code / return GT
TRACE_EV_CALL_PUSH   = 0x08  # CALL:   caller frame stack push
TRACE_EV_RETURN_POP  = 0x09  # RETURN: caller frame stack pop
TRACE_EV_RETURN_CR6  = 0x0A  # RETURN: CR6  ← restored from frame
TRACE_EV_RETURN_CR14 = 0x0B  # RETURN: CR14 ← restored from frame

_EV_NAMES = {
    TRACE_EV_RESULT:      'RESULT',
    TRACE_EV_LOAD_SHADOW: 'LOAD.shadow',
    TRACE_EV_LOAD_NEW:    'LOAD.new',
    TRACE_EV_CHANGE_PUSH: 'CHANGE.push',
    TRACE_EV_CHANGE_CR12: 'CHANGE.CR12',
    TRACE_EV_CHANGE_CR5:  'CHANGE.CR5',
    TRACE_EV_CALL_CR6:    'CALL.CR6',
    TRACE_EV_CALL_CR14:   'CALL.CR14',
    TRACE_EV_CALL_PUSH:   'CALL.push',
    TRACE_EV_RETURN_POP:  'RETURN.pop',
    TRACE_EV_RETURN_CR6:  'RETURN.CR6',
    TRACE_EV_RETURN_CR14: 'RETURN.CR14',
}

# ── Boot sentinel constants ───────────────────────────────────────────────────
# Old (stale) bitstreams emit a 2-byte sentinel:  0xBB  N_INIT&0xFF
# New bitstreams emit a 3-byte sentinel:           0xBC  N_INIT&0xFF  TU_VERSION
#
# TU_VERSION encodes TraceUnit FSM capability:
#   0x02 = ELOADCALL and XLOADLAMBDA emit 3-packet CALL sequence
#          (CALL_CR6 + CALL_CR14 + CALL_PUSH) — current standard.
#
# If the bridge sees 0xBB it knows the TraceUnit is old: ELOADCALL and
# XLOADLAMBDA will emit a single RESULT packet instead of the 3-packet CALL
# sequence, so CR6/CR14 state shown in the IDE will be silently wrong.
BOOT_SENTINEL_V1  = 0xBB   # old/stale 2-byte sentinel magic
BOOT_SENTINEL_V2  = 0xBC   # current 3-byte sentinel magic
SENTINEL_V1_LEN   = 2      # 0xBB  N_INIT&0xFF
SENTINEL_V2_LEN   = 3      # 0xBC  N_INIT&0xFF  TU_VERSION

# Minimum TU_VERSION required to guarantee correct ELOADCALL/XLOADLAMBDA trace.
TU_VERSION_CALL_3PKT = 0x02  # must match _TU_VERSION_CALL_3PKT in wukong_top.py


def _compute_expected_n_init():
    """Return the N_INIT value expected from the current boot_rom.py tables.

    Mirrors wukong_top.py:
        hw_init_pairs = [(addr, val) for addr, val in enumerate(dmem_init) if val != 0]
        N_INIT = len(hw_init_pairs)

    Returns None if boot_rom cannot be imported (bridge running stand-alone
    without the hardware package on the path).
    """
    try:
        _here = os.path.dirname(os.path.abspath(__file__))
        _root = os.path.dirname(_here)   # project root
        if _root not in sys.path:
            sys.path.insert(0, _root)
        from hardware.boot_rom import WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST
    except ImportError:
        return None

    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)
    return sum(1 for v in dmem_init if v != 0)


def _flags_str(flags_byte):
    """Return a human-readable flag string like 'NZ' from the flags byte."""
    names = ['V', 'C', 'Z', 'N']  # bits 0..3
    return ''.join(n for i, n in enumerate(names) if flags_byte & (1 << i)) or '-'


def _fault_name(code):
    _names = {
        0: 'NONE', 1: 'PERM_R', 2: 'PERM_W', 3: 'PERM_E', 4: 'PERM_L',
        5: 'NULL_CAP', 6: 'BOUNDS', 7: 'SEAL', 8: 'INVALID_OP',
        9: 'STACK_UNDERFLOW', 10: 'STACK_OVERFLOW',
    }
    return _names.get(code, f'FAULT_{code}')


def decode_trace_packet(pkt):
    """Decode a single 12-byte trace packet into a dict.

    Parameters
    ----------
    pkt : bytes | bytearray
        Exactly 12 bytes starting with TRACE_MAGIC (0xAA).

    Returns
    -------
    dict with keys:
        nia         — retiring instruction NIA (int)
        ev_type     — TRACE_EV_* constant (int)
        payload_gt  — GT word0 from packet bytes 6-9 (int); 0 for push/pop events
        flags       — raw flags byte (int); bits[3:0] = NZCV
        fault_code  — 5-bit fault code (int)
        fault_valid — bool
        bp_hit      — bool

    The decode is purely mechanical: it unpacks bytes 1-11 of the packet.
    All TRACE_EV_* values are forwarded as-is, including CALL sequences:
        TRACE_EV_CALL_CR6  (0x06) — CR6  ← abstraction GT  (payload_gt = new GT word0)
        TRACE_EV_CALL_CR14 (0x07) — CR14 ← code/return GT  (payload_gt = new GT word0)
        TRACE_EV_CALL_PUSH (0x08) — caller frame push        (payload_gt = 0)
    Three consecutive packets with the same NIA covering CALL_CR6, CALL_CR14,
    and CALL_PUSH correspond to one ELOADCALL or XLOADLAMBDA retire.
    """
    if len(pkt) != TRACE_LEN or pkt[0] != TRACE_MAGIC:
        raise ValueError(f'decode_trace_packet: expected {TRACE_LEN}-byte packet '
                         f'starting with 0x{TRACE_MAGIC:02X}, got {bytes(pkt).hex()}')
    nia        = struct.unpack('>I', pkt[1:5])[0]
    ev_type    = pkt[5]
    payload_gt = struct.unpack('>I', pkt[6:10])[0]
    raw11      = pkt[11]
    return {
        'nia':         nia,
        'ev_type':     ev_type,
        'payload_gt':  payload_gt,
        'flags':       pkt[10],
        'fault_code':  raw11 & 0x1F,
        'fault_valid': bool(raw11 & 0x40),
        'bp_hit':      bool(raw11 & 0x80),
    }


def main():
    parser = argparse.ArgumentParser(description='Wukong UART ↔ IDE bridge')
    parser.add_argument('--port', default='/dev/ttyUSB0', help='Serial port')
    parser.add_argument('--baud', type=int, default=57600, help='Baud rate')
    parser.add_argument('--ide', default='http://localhost:5000', help='IDE base URL')
    parser.add_argument('--insecure', action='store_true',
                        help='Skip TLS certificate verification')
    args = parser.parse_args()

    verify_tls = not args.insecure
    ide_base   = args.ide.rstrip('/')

    print(f'Wukong bridge: {args.port} @ {args.baud} baud → {ide_base}')

    # Compute the expected N_INIT from the current boot_rom.py tables once at
    # startup.  Used to validate the N_INIT byte that the board sends after the
    # sentinel magic byte (0xBB for old/stale bitstreams, 0xBC for current ones).
    expected_n_init = _compute_expected_n_init()
    if expected_n_init is None:
        print('WARNING: boot_rom not importable — N_INIT sentinel byte will not be validated',
              file=sys.stderr)
    else:
        print(f'Boot sentinel: expecting N_INIT={expected_n_init} '
              f'(0x{expected_n_init & 0xFF:02X}) from board')

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.05)
    except serial.SerialException as e:
        print(f'ERROR opening {args.port}: {e}', file=sys.stderr)
        sys.exit(1)

    buf       = bytearray()
    last_poll = 0.0

    try:
        while True:
            chunk = ser.read(128)
            if chunk:
                buf.extend(chunk)

            i = 0
            while i < len(buf):
                b = buf[i]

                if b == TRACE_MAGIC:
                    if len(buf) - i < TRACE_LEN:
                        break
                    pkt = buf[i:i + TRACE_LEN]
                    decoded = decode_trace_packet(pkt)
                    decoded['ts'] = time.time()

                    try:
                        requests.post(
                            f'{ide_base}/hardware/wukong/trace',
                            json=decoded, timeout=1, verify=verify_tls)
                    except Exception as exc:
                        print(f'  [trace POST error] {exc}')

                    ev_type    = decoded['ev_type']
                    payload_gt = decoded['payload_gt']
                    nia        = decoded['nia']
                    flags_byte = decoded['flags']
                    flag_str   = _flags_str(flags_byte)
                    ts_str     = time.strftime('%H:%M:%S', time.localtime())
                    ev_name    = _EV_NAMES.get(ev_type, f'EV_0x{ev_type:02X}')
                    gt_str     = f'  GT=0x{payload_gt:08X}' if payload_gt else ''
                    if decoded['fault_valid']:
                        fault_str = f'  FAULT={_fault_name(decoded["fault_code"])}'
                    else:
                        fault_str = ''
                    bp_str = '  [BP HIT]' if decoded['bp_hit'] else ''
                    print(f'[{ts_str}] HW: NIA=0x{nia:08X}  {ev_name}{gt_str}'
                          f'  flags={flag_str}{fault_str}{bp_str}')
                    i += TRACE_LEN

                elif b == BOOT_SENTINEL_V1:
                    # Old/stale 2-byte boot sentinel: 0xBB  N_INIT&0xFF
                    # Wait until both bytes are buffered.
                    if len(buf) - i < SENTINEL_V1_LEN:
                        break
                    board_n_init_byte = buf[i + 1]
                    if expected_n_init is not None:
                        expected_byte = expected_n_init & 0xFF
                        if board_n_init_byte == expected_byte:
                            print(f'BOOT: board ready — N_INIT={expected_n_init} '
                                  f'(0x{expected_byte:02X}) matches source  ✓')
                        else:
                            print(f'BOOT WARNING: N_INIT mismatch — '
                                  f'board sent 0x{board_n_init_byte:02X} '
                                  f'but source expects 0x{expected_byte:02X} '
                                  f'(N_INIT={expected_n_init})',
                                  file=sys.stderr)
                            print('  The bitstream was built with a different '
                                  'WUKONG_DEMO_NAMESPACE / WUKONG_DEMO_CLIST.',
                                  file=sys.stderr)
                            print('  Run: python3 hardware/check_dmem_count.py --check',
                                  file=sys.stderr)
                    else:
                        print(f'BOOT: board ready — N_INIT byte=0x{board_n_init_byte:02X} '
                              f'(validation skipped: boot_rom not importable)')
                    # Stale bitstream warning: old sentinel (0xBB) means the
                    # TraceUnit FSM predates the 3-packet CALL sequence for
                    # ELOADCALL/XLOADLAMBDA.  Those instructions emit a single
                    # TRACE_EV_RESULT instead of CALL_CR6+CALL_CR14+CALL_PUSH,
                    # so the IDE will show wrong CR6/CR14 state silently.
                    print('BITSTREAM WARNING: old sentinel (0xBB) — stale TraceUnit FSM detected.',
                          file=sys.stderr)
                    print('  ELOADCALL and XLOADLAMBDA emit a single RESULT packet instead of',
                          file=sys.stderr)
                    print('  the 3-packet CALL sequence (CALL_CR6 + CALL_CR14 + CALL_PUSH).',
                          file=sys.stderr)
                    print('  CR6 and CR14 state shown in the IDE will be wrong after any',
                          file=sys.stderr)
                    print('  ELOADCALL or XLOADLAMBDA instruction executes.',
                          file=sys.stderr)
                    print('  Rebuild and reflash the bitstream to get the current TraceUnit.',
                          file=sys.stderr)
                    # Notify the IDE so it can show a visible warning banner.
                    try:
                        requests.post(
                            f'{ide_base}/hardware/wukong/boot-info',
                            json={'stale_tu': True, 'tu_version': 0x01},
                            timeout=1, verify=verify_tls)
                    except Exception as exc:
                        print(f'  [boot-info POST error] {exc}')
                    i += SENTINEL_V1_LEN

                elif b == BOOT_SENTINEL_V2:
                    # Current 3-byte boot sentinel: 0xBC  N_INIT&0xFF  TU_VERSION
                    # Wait until all three bytes are buffered.
                    if len(buf) - i < SENTINEL_V2_LEN:
                        break
                    board_n_init_byte = buf[i + 1]
                    tu_version        = buf[i + 2]
                    if expected_n_init is not None:
                        expected_byte = expected_n_init & 0xFF
                        if board_n_init_byte == expected_byte:
                            print(f'BOOT: board ready — N_INIT={expected_n_init} '
                                  f'(0x{expected_byte:02X}) matches source  ✓  '
                                  f'TU_VERSION=0x{tu_version:02X}')
                        else:
                            print(f'BOOT WARNING: N_INIT mismatch — '
                                  f'board sent 0x{board_n_init_byte:02X} '
                                  f'but source expects 0x{expected_byte:02X} '
                                  f'(N_INIT={expected_n_init})  '
                                  f'TU_VERSION=0x{tu_version:02X}',
                                  file=sys.stderr)
                            print('  The bitstream was built with a different '
                                  'WUKONG_DEMO_NAMESPACE / WUKONG_DEMO_CLIST.',
                                  file=sys.stderr)
                            print('  Run: python3 hardware/check_dmem_count.py --check',
                                  file=sys.stderr)
                    else:
                        print(f'BOOT: board ready — N_INIT byte=0x{board_n_init_byte:02X} '
                              f'(validation skipped: boot_rom not importable)  '
                              f'TU_VERSION=0x{tu_version:02X}')
                    # Warn if the TraceUnit capability version is below the
                    # minimum required for correct ELOADCALL/XLOADLAMBDA tracing.
                    if tu_version < TU_VERSION_CALL_3PKT:
                        print(f'BITSTREAM WARNING: TU_VERSION=0x{tu_version:02X} is below '
                              f'required 0x{TU_VERSION_CALL_3PKT:02X}.',
                              file=sys.stderr)
                        print('  ELOADCALL and XLOADLAMBDA may not emit the 3-packet CALL',
                              file=sys.stderr)
                        print('  sequence. CR6/CR14 state in the IDE may be wrong.',
                              file=sys.stderr)
                        print('  Rebuild and reflash the bitstream to get the current TraceUnit.',
                              file=sys.stderr)
                        # Notify the IDE so it can show a visible warning banner.
                        try:
                            requests.post(
                                f'{ide_base}/hardware/wukong/boot-info',
                                json={'stale_tu': True, 'tu_version': tu_version},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')
                    else:
                        # Current bitstream — clear any previous stale warning in the IDE.
                        try:
                            requests.post(
                                f'{ide_base}/hardware/wukong/boot-info',
                                json={'stale_tu': False, 'tu_version': tu_version},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')
                    i += SENTINEL_V2_LEN

                else:
                    ch = buf[i]
                    print(chr(ch) if 32 <= ch < 128 else '.', end='', flush=True)
                    i += 1

            del buf[:i]

            now = time.time()
            if now - last_poll >= 0.05:
                last_poll = now
                try:
                    r = requests.get(
                        f'{ide_base}/hardware/wukong/command',
                        timeout=0.1, verify=verify_tls)
                    if r.status_code == 200:
                        data = r.json() or {}
                        cmd = data.get('cmd')
                        if cmd == 'b':
                            nia_val = int(data.get('nia', 0xFFFFFFFF))
                            ser.write(b'b' + struct.pack('>I', nia_val))
                        elif cmd in ('s', 'r', 'h'):
                            ser.write(cmd.encode('ascii'))
                except Exception:
                    pass

    except KeyboardInterrupt:
        print('\nBridge stopped.')
    finally:
        ser.close()


if __name__ == '__main__':
    main()
