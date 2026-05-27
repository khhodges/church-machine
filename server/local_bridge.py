#!/usr/bin/env python3
"""
Church Machine FPGA Serial Bridge
===================================
Run this in your Linux terminal when WebSerial is blocked (e.g. ChromeOS).
The browser IDE talks to this script over HTTP; this script talks to the FPGA
over UART.

Usage:
    python3 server/local_bridge.py [port] [baud] [http_port] [--ide=URL] [--report-launch]

Defaults:
    port      = /dev/ttyUSB1
    baud      = 115200
    http_port = 8766

Flags:
    --ide=URL          Report device call-home packets to the IDE server at URL.
    --report-launch    Automatically POST TEST-09 passing status to the IDE
                       server when a 0x55 UART round-trip is observed.
                       Requires --ide=URL to be set.

Then in the Church Machine IDE click  "Bridge"  instead of the normal connect
button, and enter the bridge URL when prompted (default already filled in).
"""
import sys, json, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import serial
except ImportError:
    print("ERROR: pyserial not installed.  Run:  pip3 install pyserial")
    sys.exit(1)

_first_arg = sys.argv[1] if len(sys.argv) > 1 else ''
_positional = [a for a in sys.argv[1:] if not a.startswith('--')]
SERIAL_PORT = _positional[0] if len(_positional) > 0 else '/dev/ttyUSB1'
BAUD        = int(_positional[1]) if len(_positional) > 1 else 115200
HTTP_PORT   = int(_positional[2]) if len(_positional) > 2 else 8766

_ser       = None
_ser_lock  = threading.Lock()
_rx_buf    = bytearray()
_rx_lock   = threading.Lock()
_reader_running = False
_active_baud = BAUD  # updated on every successful /connect; returned by /status

CALLHOME_MAGIC = bytes([0xCE, 0x11])
CALLHOME_PKT_LEN = 23
CALLHOME_ACK = bytes([0xCE, 0x22])

_IDE_SERVER_URL = None
_BRIDGE_SCHEME = 'http'
_device_uid = None
_heartbeat_running = False
_REPORT_LAUNCH = False
_launch_test_reported = set()

BOARD_TYPES = {
    0x01: ("TN20K-IoT", "IoT"),
    0x03: ("Ti60-Full", "Full"),
    0x06: ("Wukong XC7A100T (Artix-7)", "Full"),
}

def _handle_callhome(pkt):
    global _device_uid, _heartbeat_running
    if len(pkt) < CALLHOME_PKT_LEN:
        return
    board_type = pkt[2]
    fw_major = pkt[3]
    fw_minor = pkt[4]
    build_sig = list(pkt[5:9])
    uid_bytes = pkt[9:17]
    uid_hex = uid_bytes.hex()
    boot_reason = pkt[17] if len(pkt) > 17 else 0
    last_fault = pkt[18] if len(pkt) > 18 else 0
    fault_nia = int.from_bytes(pkt[19:23], 'big') if len(pkt) >= 23 else 0
    _device_uid = uid_hex
    board_name, profile = BOARD_TYPES.get(board_type, (f"Unknown-0x{board_type:02X}", "Full"))
    sig_hex = bytes(build_sig).hex()
    reason_names = {0x00: "cold", 0x01: "warm", 0x02: "fault"}
    reason_str = reason_names.get(boot_reason, f"0x{boot_reason:02X}")
    fault_str = f"  LastFault: 0x{last_fault:02X}" if last_fault else ""
    nia_str = f"  FaultNIA: 0x{fault_nia:08X}" if fault_nia else ""
    print(f'  [CALL HOME] Board: {board_name}  FW: {fw_major}.{fw_minor}  Sig: {sig_hex}  UID: {uid_hex}  Reason: {reason_str}{fault_str}{nia_str}')

    with _ser_lock:
        s = _ser
    if s and s.is_open:
        try:
            s.write(CALLHOME_ACK)
            print(f'  [CALL HOME] ACK sent to FPGA')
        except Exception as e:
            print(f'  [CALL HOME] ACK send failed: {e}')

    if _IDE_SERVER_URL:
        _register_with_ide(uid_hex, board_type, board_name, profile, fw_major, fw_minor, build_sig, boot_reason, last_fault, fault_nia)
        if not _heartbeat_running:
            _heartbeat_running = True
            hb = threading.Thread(target=_heartbeat_thread, daemon=True)
            hb.start()


def _register_with_ide(uid, board_type, board_name, profile, fw_major, fw_minor, build_sig=None, boot_reason=0, last_fault=0, fault_nia=0):
    import socket
    try:
        import urllib.request
        payload = json.dumps({
            "device_uid": uid,
            "board_type": board_type,
            "profile": profile,
            "fw_major": fw_major,
            "fw_minor": fw_minor,
            "build_sig": bytes(build_sig or [0,0,0,0]).hex(),
            "boot_reason": boot_reason,
            "last_fault": last_fault,
            "fault_nia": fault_nia,
            "bridge_host": socket.gethostname(),
            "bridge_port": HTTP_PORT,
            "bridge_scheme": _BRIDGE_SCHEME,
            "serial_port": SERIAL_PORT,
        }).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/register",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        if result.get("ok"):
            tunnel = result.get("tunnel_status", "pending")
            tunnel_str = " — Tunnel online ✓" if tunnel == "online" else f" — Tunnel: {tunnel}"
            print(f'  [CALL HOME] Registered with IDE — boot #{result.get("boot_count", "?")}{tunnel_str}')
        else:
            print(f'  [CALL HOME] IDE registration response: {result}')
    except Exception as e:
        print(f'  [CALL HOME] IDE registration failed: {e}')


def _heartbeat_thread():
    global _heartbeat_running
    while _heartbeat_running and _device_uid and _IDE_SERVER_URL:
        try:
            import urllib.request
            payload = json.dumps({"device_uid": _device_uid}).encode()
            req = urllib.request.Request(
                f"{_IDE_SERVER_URL}/api/device/heartbeat",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass
        if _REPORT_LAUNCH:
            _fetch_launch_summary()
        time.sleep(60)


def _fetch_launch_summary():
    """Fetch /api/launch-tests and print each test name with its status."""
    if not _IDE_SERVER_URL:
        return
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/launch-tests",
            headers={"Content-Type": "application/json"},
            method="GET",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        tests = data if isinstance(data, list) else data.get("tests", [])
        total = len(tests)
        passing = sum(1 for t in tests if t.get("status") == "passing")
        print(f'  [LAUNCH] {passing}/{total} tests passing')
        _STATUS_LABEL = {
            "passing": "passing",
            "failing": "failing",
            "not-run": "unknown",
        }
        for t in tests:
            status = t.get("status", "")
            label = _STATUS_LABEL.get(status, "unknown")
            name = t.get("name") or t.get("test_id", "(unnamed)")
            print(f'  [LAUNCH]   [{label}] {name}')
    except Exception as e:
        print(f'  [LAUNCH] Could not fetch summary: {e}')


def _report_launch_test(test_id, status="passing", notes=""):
    """POST a launch-test status update to the IDE server."""
    global _launch_test_reported
    if not _IDE_SERVER_URL:
        print(f'  [LAUNCH] Cannot report {test_id}: no --ide=URL configured')
        return
    if test_id in _launch_test_reported and status == "passing":
        return
    try:
        import urllib.request
        payload = json.dumps({
            "status": status,
            "device_uid": _device_uid or "",
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
            if status == "passing":
                _launch_test_reported.add(test_id)
            _fetch_launch_summary()
        else:
            print(f'  [LAUNCH] {test_id} report failed: {result}')
    except Exception as e:
        print(f'  [LAUNCH] {test_id} report error: {e}')


# ── background reader ────────────────────────────────────────────────────────

def _reader():
    global _ser, _rx_buf, _active_baud
    callhome_scan = bytearray()
    last_rx_time = time.monotonic()
    _RECONNECT_DELAY = 2.0
    while _reader_running:
        try:
            with _ser_lock:
                s = _ser
            if s and s.is_open:
                try:
                    waiting = s.in_waiting
                    if waiting:
                        chunk = s.read(waiting)
                        if not chunk:
                            raise serial.SerialException(
                                "device reports readiness to read but returned no data "
                                "(device disconnected or multiple access on port?)")
                        callhome_scan.extend(chunk)
                        last_rx_time = time.monotonic()
                        while len(callhome_scan) >= 2:
                            idx = callhome_scan.find(CALLHOME_MAGIC)
                            if idx < 0:
                                safe = max(0, len(callhome_scan) - 1)
                                if safe > 0:
                                    with _rx_lock:
                                        _rx_buf.extend(callhome_scan[:safe])
                                    callhome_scan = callhome_scan[safe:]
                                break
                            if idx > 0:
                                with _rx_lock:
                                    _rx_buf.extend(callhome_scan[:idx])
                                callhome_scan = callhome_scan[idx:]
                            if len(callhome_scan) < CALLHOME_PKT_LEN:
                                break
                            _handle_callhome(bytes(callhome_scan[:CALLHOME_PKT_LEN]))
                            callhome_scan = callhome_scan[CALLHOME_PKT_LEN:]
                    else:
                        if callhome_scan and (time.monotonic() - last_rx_time) > 0.005:
                            with _rx_lock:
                                _rx_buf.extend(callhome_scan)
                            callhome_scan = bytearray()
                        time.sleep(0.005)
                except serial.SerialException as exc:
                    print(f'  [bridge] Serial error: {exc}')
                    # Flush stale scan and rx buffers before reconnect to prevent
                    # garbled CALLHOME JSON from mixing pre- and post-disconnect bytes
                    callhome_scan = bytearray()
                    with _rx_lock:
                        _rx_buf.clear()
                    with _ser_lock:
                        try:
                            if _ser:
                                _ser.close()
                        except Exception:
                            pass
                        _ser = None
                    print(f'  [bridge] Reconnecting in {_RECONNECT_DELAY:.0f} s\u2026')
                    time.sleep(_RECONNECT_DELAY)
                    try:
                        baud = _active_baud or BAUD
                        new_ser = serial.Serial(SERIAL_PORT, baud, timeout=0)
                        with _ser_lock:
                            _ser = new_ser
                        print(f'  [bridge] Reconnected to {SERIAL_PORT}')
                    except Exception as re_exc:
                        print(f'  [bridge] Reconnect failed: {re_exc}')
            else:
                time.sleep(0.02)
        except Exception:
            time.sleep(0.05)

# ── HTTP handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f'  [{self.path}] {fmt % args}')

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json_resp(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def do_GET(self):
        global _ser, _rx_buf
        if self.path == '/status':
            with _ser_lock:
                open_ = bool(_ser and _ser.is_open)
                active_port = _ser.port if open_ else SERIAL_PORT
            self._json_resp({'ok': True, 'open': open_, 'port': SERIAL_PORT, 'active_port': active_port, 'baud': _active_baud})

        elif self.path == '/drain':
            with _rx_lock:
                data = bytes(_rx_buf)
                _rx_buf.clear()
            self._json_resp({'ok': True, 'bytes': list(data)})

        elif self.path == '/ports':
            import glob as _glob
            found = (
                sorted(_glob.glob('/dev/ttyUSB*')) +
                sorted(_glob.glob('/dev/ttyACM*')) +
                sorted(_glob.glob('/dev/cu.usbserial*')) +
                sorted(_glob.glob('/dev/cu.usbmodem*'))
            )
            self._json_resp({'ok': True, 'ports': found})

        else:
            self._json_resp({'ok': False, 'error': 'not found'}, 404)

    def do_POST(self):
        global _ser, _rx_buf, _reader_running, _active_baud

        if self.path == '/connect':
            body = self._read_body()
            port = body.get('port', SERIAL_PORT)
            baud = int(body.get('baud', BAUD))
            try:
                with _ser_lock:
                    if _ser and _ser.is_open:
                        _ser.close()
                    _ser = serial.Serial(port, baud, timeout=0)
                _active_baud = baud
                with _rx_lock:
                    _rx_buf.clear()
                if not _reader_running:
                    _reader_running = True
                    t = threading.Thread(target=_reader, daemon=True)
                    t.start()
                print(f'  Opened {port} @ {baud}')
                self._json_resp({'ok': True})
            except Exception as e:
                self._json_resp({'ok': False, 'error': str(e)})

        elif self.path == '/disconnect':
            closed_baud = _active_baud
            with _ser_lock:
                if _ser and _ser.is_open:
                    _ser.close()
            print(f'  Port closed (was {closed_baud} baud).')
            self._json_resp({'ok': True, 'baud': closed_baud})

        elif self.path == '/transact':
            body = self._read_body()
            tx_bytes  = bytes(body.get('tx', []))
            rx_count  = int(body.get('rx_count', 0))
            timeout_s = body.get('timeout_ms', 3000) / 1000.0
            try:
                with _rx_lock:
                    stale = bytes(_rx_buf)
                    _rx_buf.clear()
                if stale:
                    print(f'  [transact] drained {len(stale)} stale bytes: {stale.hex()}')
                with _ser_lock:
                    if not (_ser and _ser.is_open):
                        raise IOError('Serial port not open')
                    _ser.write(tx_bytes)
                print(f'  [transact] TX {len(tx_bytes)} bytes: {tx_bytes[:16].hex()}{"..." if len(tx_bytes)>16 else ""}')
                rx = bytearray()
                deadline = time.time() + timeout_s
                while len(rx) < rx_count and time.time() < deadline:
                    with _rx_lock:
                        chunk = bytes(_rx_buf)
                        _rx_buf.clear()
                    rx.extend(chunk)
                    if len(rx) < rx_count:
                        time.sleep(0.005)
                print(f'  [transact] RX {len(rx)} bytes: {rx.hex() if rx else "(empty)"}')
                self._json_resp({'ok': True, 'rx': list(rx)})
                if (_REPORT_LAUNCH and _IDE_SERVER_URL
                        and tx_bytes == bytes([0x55]) and rx_count > 0 and len(rx) >= rx_count):
                    threading.Thread(
                        target=_report_launch_test,
                        args=("TEST-09",),
                        kwargs={"status": "passing", "notes": "0x55 UART round-trip succeeded via local_bridge.py"},
                        daemon=True,
                    ).start()
            except Exception as e:
                print(f'  [transact] ERROR: {e}')
                self._json_resp({'ok': False, 'error': str(e)})

        else:
            self._json_resp({'ok': False, 'error': 'not found'}, 404)


def _generate_self_signed_cert():
    """Generate a self-signed certificate with SAN for HTTPS bridge."""
    import tempfile, subprocess, os
    cert_dir = tempfile.mkdtemp(prefix='church_bridge_')
    key_path  = os.path.join(cert_dir, 'key.pem')
    cert_path = os.path.join(cert_dir, 'cert.pem')
    conf_path = os.path.join(cert_dir, 'openssl.cnf')
    with open(conf_path, 'w') as f:
        f.write(
            "[req]\n"
            "default_bits = 2048\n"
            "prompt = no\n"
            "distinguished_name = dn\n"
            "x509_extensions = v3_ext\n"
            "[dn]\n"
            "CN = penguin.linux.test\n"
            "[v3_ext]\n"
            "subjectAltName = DNS:penguin.linux.test, DNS:localhost, IP:127.0.0.1\n"
            "basicConstraints = CA:FALSE\n"
            "keyUsage = digitalSignature, keyEncipherment\n"
            "extendedKeyUsage = serverAuth\n"
        )
    result = subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', key_path, '-out', cert_path,
        '-days', '365', '-nodes',
        '-config', conf_path,
    ], capture_output=True)
    if result.returncode != 0:
        print(f"WARNING: openssl failed: {result.stderr.decode()}")
        print("Falling back to plain HTTP (HTTPS not available)")
        return None, None
    return cert_path, key_path


def _scan_ports():
    """List all serial ports and probe each for incoming data."""
    import glob
    ports = sorted(glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyS*'))
    ports = [p for p in ports if not p.startswith('/dev/ttyS') or int(p.replace('/dev/ttyS','')) < 4]
    print(f'Found {len(ports)} serial port(s): {", ".join(ports) if ports else "(none)"}')
    print()
    for port in ports:
        try:
            s = serial.Serial(port, 115200, timeout=0.5)
            time.sleep(0.1)
            w = s.in_waiting
            chunk = s.read(max(w, 64)) if True else b''
            s.close()
            if chunk:
                print(f'  {port}: OPEN OK — got {len(chunk)} bytes: {chunk[:32].hex()} ascii={chunk[:32]}')
            else:
                print(f'  {port}: OPEN OK — 0 bytes waiting')
        except Exception as e:
            print(f'  {port}: FAILED — {e}')
    print()


def _monitor_mode(port, baud):
    """Open port and print everything received for 10 seconds."""
    print(f'MONITOR MODE: listening on {port} @ {baud} for 10 seconds...')
    print(f'  (Flash the FPGA, then run this within 3 seconds to catch the boot banner)')
    print()
    try:
        s = serial.Serial(port, baud, timeout=0.1)
    except Exception as e:
        print(f'  FAILED to open {port}: {e}')
        return
    total = 0
    start = time.time()
    while time.time() - start < 10:
        w = s.in_waiting
        if w:
            chunk = s.read(w)
            total += len(chunk)
            elapsed = time.time() - start
            hex_str = chunk.hex()
            try:
                ascii_str = chunk.decode('ascii', errors='replace')
            except:
                ascii_str = ''
            print(f'  [{elapsed:5.2f}s] +{len(chunk)} bytes (total {total}): hex={hex_str}')
            if ascii_str.strip():
                print(f'         ascii: {repr(ascii_str)}')
        else:
            time.sleep(0.01)
    s.close()
    print()
    if total == 0:
        print(f'  RESULT: 0 bytes received in 10 seconds.')
        print(f'  This means either:')
        print(f'    1. {port} is not bridged to the FPGA UART pins')
        print(f'    2. The BL616 firmware is not in UART bridge mode')
        print(f'    3. The baud rate is wrong (try --monitor {port} 9600)')
    else:
        print(f'  RESULT: {total} bytes received — UART link is working!')
    print()


def _probe_bauds(port):
    """Try common baud rates and listen briefly on each."""
    bauds = [115200, 9600, 19200, 38400, 57600, 230400, 460800, 921600, 1000000, 2000000]
    print(f'BAUD PROBE: trying {len(bauds)} rates on {port}...')
    print()
    for baud in bauds:
        try:
            s = serial.Serial(port, baud, timeout=0.3)
            time.sleep(0.3)
            w = s.in_waiting
            chunk = s.read(max(w, 32))
            s.close()
            if chunk:
                print(f'  {baud:>7d}: GOT {len(chunk)} bytes — {chunk[:16].hex()} ascii={repr(chunk[:16].decode("ascii", errors="replace"))}')
            else:
                print(f'  {baud:>7d}: (silence)')
        except Exception as e:
            print(f'  {baud:>7d}: FAILED — {e}')
    print()


if __name__ == '__main__':
    if _first_arg == '--scan':
        _scan_ports()
        sys.exit(0)

    if _first_arg == '--monitor':
        port = sys.argv[2] if len(sys.argv) > 2 else '/dev/ttyUSB1'
        baud = int(sys.argv[3]) if len(sys.argv) > 3 else 115200
        _monitor_mode(port, baud)
        sys.exit(0)

    if _first_arg == '--probe-bauds':
        port = sys.argv[2] if len(sys.argv) > 2 else '/dev/ttyUSB1'
        _probe_bauds(port)
        sys.exit(0)

    for a in sys.argv[1:]:
        if a.startswith('--ide='):
            _IDE_SERVER_URL = a[6:].rstrip('/')
        elif a == '--report-launch':
            _REPORT_LAUNCH = True

    cert_path, key_path = _generate_self_signed_cert()
    use_https = cert_path is not None

    if use_https:
        scheme = 'https'
    else:
        scheme = 'http'

    _BRIDGE_SCHEME = scheme

    print(f'Church Machine FPGA Bridge ({scheme.upper()})')
    print(f'  Serial : {SERIAL_PORT} @ {BAUD} baud')
    print(f'  {scheme.upper():7s}: {scheme}://0.0.0.0:{HTTP_PORT}')
    print(f'  ChromeOS bridge URL: {scheme}://penguin.linux.test:{HTTP_PORT}')
    if _IDE_SERVER_URL:
        print(f'  IDE Server: {_IDE_SERVER_URL}')
    else:
        print(f'  IDE Server: (not configured — use --ide=URL to enable call-home)')
    if _REPORT_LAUNCH:
        if _IDE_SERVER_URL:
            print(f'  Launch reporting: ENABLED (TEST-09 will be reported on 0x55 UART round-trip)')
        else:
            print(f'  Launch reporting: --report-launch set but --ide=URL missing; reporting disabled')
    print()
    if use_https:
        print('IMPORTANT — first time setup:')
        print(f'  1. Open https://penguin.linux.test:{HTTP_PORT}/status in Chrome')
        print(f'  2. Click "Advanced" → "Proceed to penguin.linux.test (unsafe)"')
        print(f'  3. You should see {{"ok": true, ...}}')
        print(f'  4. Now go to the IDE and click "Bridge"')
    else:
        print('NOTE: Running in HTTP mode (openssl not available).')
        print('      Mixed-content blocking may prevent connection from HTTPS IDE pages.')
        print(f'      Bridge URL: http://penguin.linux.test:{HTTP_PORT}')
    print()
    print('Press Ctrl+C to stop.')
    print()

    if _REPORT_LAUNCH and _IDE_SERVER_URL:
        _fetch_launch_summary()

    server = HTTPServer(('0.0.0.0', HTTP_PORT), Handler)
    if use_https:
        import ssl as _ssl
        ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert_path, key_path)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    server.serve_forever()
