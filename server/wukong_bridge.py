#!/usr/bin/env python3
"""
Church Machine — Wukong XC7A100T Serial Bridge
================================================
Reads the Wukong UART output (ASCII banner + 11-byte trace packets) and
forwards parsed trace packets to the IDE server.

Usage:
    python3 wukong_bridge.py [port] [--ide=URL] [--insecure] [--scan]

Defaults:
    port = /dev/ttyUSB0   baud is always 57600 (CLOCKDIV=53, 25 MHz)

Flags:
    --ide=URL     POST trace packets to the IDE at URL
    --insecure    Skip SSL verification (needed on ChromeOS Crostini)
    --scan        List all serial ports and their first few bytes, then exit

Trace packet format (12 bytes, magic 0xAA):
    [0]     0xAA      magic
    [1..4]  NIA       big-endian uint32
    [5]     ev_type   TRACE_EV_* constant (0x00-0x0B)
    [6..9]  payload   GT word0 (uint32 big-endian); 0 for push/pop events
    [10]    flags     bits[3:0]=NZCV
    [11]    fault     bits[4:0]=fault_code  bit[6]=fault_valid  bit[7]=bp_hit

Relevant ev_type values for CR display:
    0x06 = TRACE_EV_CALL_CR6  → CR6  ← payload_gt
    0x07 = TRACE_EV_CALL_CR14 → CR14 ← payload_gt
    0x08 = TRACE_EV_CALL_PUSH → caller frame push (payload_gt=0)
"""
import sys, json, time, struct, threading, signal

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("ERROR: pyserial not installed.  Run:  pip3 install pyserial")
    sys.exit(1)

BAUD        = 57600
PKT_MAGIC   = 0xAA
PKT_LEN     = 12   # 12-byte per-event packet (magic+NIA+ev_type+payload+flags+fault)

_positional = [a for a in sys.argv[1:] if not a.startswith('--')]
SERIAL_PORT = _positional[0] if _positional else '/dev/ttyUSB0'

_IDE_URL    = None
_INSECURE   = False
_SCAN       = False

for a in sys.argv[1:]:
    if a.startswith('--ide='):
        _IDE_URL = a[6:].rstrip('/')
    elif a == '--insecure':
        _INSECURE = True
    elif a == '--scan':
        _SCAN = True


def _urlopen(url, data=None, timeout=5):
    import urllib.request as _ur
    import ssl as _ssl
    req = _ur.Request(url, data=data,
                      headers={'Content-Type': 'application/json'} if data else {},
                      method='POST' if data else 'GET')
    if _INSECURE:
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        return _ur.urlopen(req, timeout=timeout, context=ctx)
    return _ur.urlopen(req, timeout=timeout)


_EV_NAMES = {
    0x00: 'RESULT',      0x01: 'LOAD.shadow', 0x02: 'LOAD.new',
    0x03: 'CHANGE.push', 0x04: 'CHANGE.CR12', 0x05: 'CHANGE.CR5',
    0x06: 'CALL.CR6',    0x07: 'CALL.CR14',   0x08: 'CALL.push',
    0x09: 'RETURN.pop',  0x0A: 'RETURN.CR6',  0x0B: 'RETURN.CR14',
}


def _post_trace(pkt_bytes):
    """Parse a 12-byte trace packet and POST to IDE.

    Packet layout (12 bytes, big-endian):
        [0]     0xAA      magic
        [1..4]  NIA       uint32
        [5]     ev_type   TRACE_EV_* constant
        [6..9]  payload   GT word0 (uint32); 0 for push/pop events
        [10]    flags     bits[3:0]=NZCV
        [11]    fault     bits[4:0]=fault_code  bit[6]=fault_valid  bit[7]=bp_hit
    """
    if len(pkt_bytes) != PKT_LEN or pkt_bytes[0] != PKT_MAGIC:
        return
    nia        = struct.unpack('>I', pkt_bytes[1:5])[0]
    ev_type    = pkt_bytes[5]
    payload_gt = struct.unpack('>I', pkt_bytes[6:10])[0]
    flags      = pkt_bytes[10] & 0x0F
    fault_byte = pkt_bytes[11]
    fault_code  = fault_byte & 0x1F
    fault_valid = bool(fault_byte & 0x40)
    bp_hit      = bool(fault_byte & 0x80)

    ev_name = _EV_NAMES.get(ev_type, f'EV_0x{ev_type:02X}')
    gt_str  = f'  GT=0x{payload_gt:08X}' if payload_gt else ''
    print(f'  [TRACE] NIA=0x{nia:08X}  {ev_name}{gt_str}  '
          f'NZCV={flags:04b}  '
          f'{"FAULT(" + str(fault_code) + ")" if fault_valid else "ok"}'
          f'{" BP" if bp_hit else ""}')

    if not _IDE_URL:
        return
    payload = json.dumps({
        'nia':         nia,
        'ev_type':     ev_type,
        'payload_gt':  payload_gt,
        'flags':       flags,
        'fault_code':  fault_code,
        'fault_valid': fault_valid,
        'bp_hit':      bp_hit,
        'ts':          time.time(),
    }).encode()
    try:
        _urlopen(f'{_IDE_URL}/hardware/wukong/trace', data=payload)
    except Exception as e:
        print(f'  [TRACE] POST failed: {e}')


def _scan_ports():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print('No serial ports found.')
        return
    print(f'Found {len(ports)} port(s):')
    for p in ports:
        print(f'  {p.device:20s}  {p.description}')
        try:
            s = serial.Serial(p.device, BAUD, timeout=0.4)
            time.sleep(0.4)
            chunk = s.read(64)
            s.close()
            if chunk:
                ascii_preview = chunk.decode('ascii', errors='replace').replace('\r','').replace('\n',' ')[:40]
                print(f'    → {len(chunk)} bytes: hex={chunk[:8].hex()}  ascii="{ascii_preview}"')
            else:
                print(f'    → (silence at {BAUD} baud)')
        except Exception as e:
            print(f'    → ERROR: {e}')
    print()
    print('Tip: the Wukong UART TX is on FPGA pin E3 at 57600 baud.')
    print('     If you see "CM:WUKONG" that is the right port.')


def run_bridge():
    print(f'Wukong Bridge')
    print(f'  Port   : {SERIAL_PORT} @ {BAUD} baud')
    if _IDE_URL:
        ssl_note = ' (SSL verify off)' if _INSECURE else ''
        print(f'  IDE    : {_IDE_URL}{ssl_note}')
    else:
        print(f'  IDE    : (not set — trace printed locally only, use --ide=URL)')
    print()
    print('Waiting for board output.  Power-cycle the board if nothing appears.')
    print('Press Ctrl+C to stop.')
    print()

    buf = bytearray()
    ascii_line = bytearray()

    while True:
        try:
            ser = serial.Serial(SERIAL_PORT, BAUD, timeout=0.1)
            print(f'  [bridge] {SERIAL_PORT} opened.')
        except Exception as e:
            print(f'  [bridge] Cannot open {SERIAL_PORT}: {e}')
            print(f'           Retrying in 2 s...  (is the USB-UART adapter connected?)')
            time.sleep(2)
            continue

        try:
            while True:
                chunk = ser.read(64)
                if not chunk:
                    continue
                for byte in chunk:
                    if buf:
                        buf.append(byte)
                        if len(buf) == PKT_LEN:
                            _post_trace(bytes(buf))
                            buf.clear()
                    elif byte == PKT_MAGIC:
                        buf.append(byte)
                    else:
                        ascii_line.append(byte)
                        if byte in (ord('\n'), ord('\r')):
                            line = ascii_line.decode('ascii', errors='replace').strip()
                            if line:
                                print(f'  [UART] {line}')
                            ascii_line.clear()
        except serial.SerialException as e:
            print(f'  [bridge] Serial error: {e} — reconnecting...')
            try:
                ser.close()
            except Exception:
                pass
            time.sleep(1)
        except KeyboardInterrupt:
            print('\nStopped.')
            try:
                ser.close()
            except Exception:
                pass
            break


if __name__ == '__main__':
    if _SCAN:
        _scan_ports()
    else:
        run_bridge()
