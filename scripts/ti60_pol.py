#!/usr/bin/env python3
"""
Ti60 Proof-of-Life — terminal script
Run this from the Linux terminal when WebSerial is unavailable (e.g. ChromeOS/Crostini).

Usage:
    python3 ti60_pol.py [PORT] [IDE_URL]

Defaults:
    PORT    = /dev/ttyUSB2
    IDE_URL = http://localhost:5000

Example (Crostini, IDE on Replit):
    python3 ti60_pol.py /dev/ttyUSB2 https://<your-replit-dev-url>
"""

import sys
import json
import time
import urllib.request
import urllib.error

PORT    = sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyUSB2'
IDE_URL = sys.argv[2].rstrip('/') if len(sys.argv) > 2 else 'http://localhost:5000'
BAUD    = 115200
TIMEOUT = 30  # seconds to wait for CALLHOME packet

def _step(n, label, ok, detail=''):
    sym = '✓' if ok else '✗'
    print(f'  [{sym}] Step {n}: {label}' + (f'  — {detail}' if detail else ''))

def _post(url, data):
    body = json.dumps(data).encode()
    req  = urllib.request.Request(url, data=body,
                                   headers={'Content-Type': 'application/json'},
                                   method='POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def _put(url, data):
    body = json.dumps(data).encode()
    req  = urllib.request.Request(url, data=body,
                                   headers={'Content-Type': 'application/json'},
                                   method='PUT')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def _get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())

def run():
    print()
    print('═' * 55)
    print('  Ti60 Proof-of-Life')
    print(f'  Port : {PORT}')
    print(f'  IDE  : {IDE_URL}')
    print('═' * 55)

    # ── Step 1: open port ────────────────────────────────────
    try:
        import serial
    except ImportError:
        print('\n  ERROR: pyserial not installed.')
        print('  Run:  pip install pyserial')
        sys.exit(1)

    try:
        ser = serial.Serial(PORT, BAUD, timeout=2)
        print(f'\n  Port {PORT} opened at {BAUD} baud.')
    except Exception as e:
        _step(1, 'Connect', False, str(e))
        print(f'\n  Tip: try   sudo chmod a+rw {PORT}   then re-run.')
        sys.exit(1)

    # ── Step 2: wait for greeting + CALLHOME ─────────────────
    greeting_seen = False
    pkt           = None
    deadline      = time.time() + TIMEOUT
    buf           = b''

    print(f'  Waiting up to {TIMEOUT}s for firmware output …\n')

    while time.time() < deadline:
        chunk = ser.read(256)
        if chunk:
            buf += chunk
        lines, buf = buf.rsplit(b'\n', 1) if b'\n' in buf else (b'', buf)
        for raw in lines.split(b'\n'):
            line = raw.decode('utf-8', errors='replace').strip()
            if not line:
                continue
            print(f'  RAW: {line}')
            if 'CHURCH Ti60 SoC+CM' in line and not greeting_seen:
                greeting_seen = True
                _step(1, 'Connect', True, 'Greeting received')
            if line.startswith('CALLHOME:'):
                try:
                    obj = json.loads(line[len('CALLHOME:'):])
                    required = ['board', 'uid', 'nia', 'boot_ok', 'fault', 'fault_code']
                    if all(k in obj for k in required):
                        pkt = obj
                        break
                except Exception:
                    pass
        if pkt:
            break

    ser.close()

    if not greeting_seen and pkt is None:
        _step(1, 'Connect', False, 'No firmware output received — wrong port or board not booted')
        sys.exit(1)

    if not greeting_seen:
        _step(1, 'Connect', True, f'Board detected via CALLHOME (board={pkt["board"]})')

    if pkt is None:
        _step(2, 'Call Home', False, 'CALLHOME packet not received within timeout')
        sys.exit(1)

    if pkt['boot_ok'] != 1:
        _step(2, 'Call Home', False,
              f'boot_ok={pkt["boot_ok"]}  fault_code={pkt["fault_code"]} — firmware booted with fault')
        sys.exit(1)

    _step(2, 'Call Home', True,
          f'board={pkt["board"]}  uid={pkt["uid"]}  nia={pkt["nia"]}')

    # ── Step 3: register with IDE ─────────────────────────────
    try:
        d = _post(IDE_URL + '/api/device/call-home', {
            'device_uid':  pkt['uid'],
            'board_type':  pkt['board'],
            'fw_major':    pkt.get('fw_major', 1),
            'fw_minor':    pkt.get('fw_minor', 0),
            'boot_reason': 0,
            'last_fault':  pkt.get('fault', 0),
            'fault_nia':   0,
        })
        if d.get('ok'):
            _step(3, 'Register', True, f'uid={pkt["uid"]} stored in IDE')
        else:
            _step(3, 'Register', False, f'IDE returned ok=false: {d}')
            sys.exit(1)
    except Exception as e:
        _step(3, 'Register', False, str(e))
        sys.exit(1)

    # ── Step 4: mark TEST-09 passing ─────────────────────────
    try:
        _put(IDE_URL + '/api/launch-tests/TEST-09', {
            'status': 'passing',
            'device_uid': pkt['uid'],
            'notes': 'Ti60 CALLHOME confirmed via terminal script',
        })
        tests = _get(IDE_URL + '/api/launch-tests')
        t09   = next((t for t in tests.get('tests', []) if t['test_id'] == 'TEST-09'), None)
        if t09 and t09['status'] == 'passing':
            _step(4, 'Release', True, 'TEST-09 confirmed passing in IDE database ✅')
        else:
            _step(4, 'Release', False, 'TEST-09 not confirmed')
    except Exception as e:
        _step(4, 'Release', False, str(e))
        sys.exit(1)

    print()
    print('  ALL STEPS PASSED — board is production-released 🎉')
    print()

if __name__ == '__main__':
    run()
