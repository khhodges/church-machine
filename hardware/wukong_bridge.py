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
  • 0xAA-prefixed 11-byte trace packets are parsed and POSTed to
    /hardware/wukong/trace as JSON.

Polls GET /hardware/wukong/command every 50 ms and writes any pending command
byte to the serial port.  Commands from the IDE:

  {cmd: "s"}           → write b's'  (step: execute one instruction)
  {cmd: "r"}           → write b'r'  (run free)
  {cmd: "h"}           → write b'h'  (halt immediately)
  {cmd: "b", nia: N}   → write b'b' + big-endian 4-byte NIA  (set/clear breakpoint)

Trace packet format (11 bytes, big-endian):
  [0]    0xAA magic
  [1..4] NIA (uint32 big-endian)
  [5..8] instruction word (uint32 big-endian)
  [9]    flags byte  bits[3:0] = NZCV; bit[6]=fault_valid; bit[7]=bp_hit
  [10]   fault_code  bits[4:0] = FaultType; bit[6]=fault_valid dup; bit[7]=bp_hit dup
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
TRACE_LEN      = 11

BOOT_SENTINEL  = 0xBB   # first byte of the 2-byte boot sentinel sequence
SENTINEL_LEN   = 2      # 0xBB  N_INIT&0xFF


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
    # startup.  Used to validate the N_INIT byte that the board sends after 0xBB.
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
                    nia        = struct.unpack('>I', pkt[1:5])[0]
                    instr      = struct.unpack('>I', pkt[5:9])[0]
                    flags_byte = pkt[9]
                    raw10      = pkt[10]
                    fault_valid = bool(raw10 & 0x40)
                    bp_hit      = bool(raw10 & 0x80)
                    fault_code  = raw10 & 0x1F

                    payload = {
                        'nia':         nia,
                        'instr':       instr,
                        'flags':       flags_byte,
                        'fault_code':  fault_code,
                        'fault_valid': fault_valid,
                        'bp_hit':      bp_hit,
                        'ts':          time.time(),
                    }
                    try:
                        requests.post(
                            f'{ide_base}/hardware/wukong/trace',
                            json=payload, timeout=1, verify=verify_tls)
                    except Exception as exc:
                        print(f'  [trace POST error] {exc}')

                    flag_str  = _flags_str(flags_byte)
                    state_str = 'FAULT  stage=' + _fault_name(fault_code) if fault_valid else 'ok'
                    bp_str    = '  [BP HIT]' if bp_hit else ''
                    print(f'HW: NIA=0x{nia:08X}  instr=0x{instr:08X}  flags={flag_str}  {state_str}{bp_str}')
                    i += TRACE_LEN

                elif b == BOOT_SENTINEL:
                    # Two-byte boot sentinel: 0xBB  N_INIT&0xFF
                    # Wait until both bytes are buffered.
                    if len(buf) - i < SENTINEL_LEN:
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
                    i += SENTINEL_LEN

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
