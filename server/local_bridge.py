#!/usr/bin/env python3
"""
Church Machine FPGA Serial Bridge
===================================
Run this in your Linux terminal when WebSerial is blocked (e.g. ChromeOS).
The browser IDE talks to this script over HTTP; this script talks to the FPGA
over UART.

Usage:
    python3 server/local_bridge.py [port] [baud] [http_port]

Defaults:
    port      = /dev/ttyUSB3
    baud      = 115200
    http_port = 8766

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

SERIAL_PORT = sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyUSB3'
BAUD        = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
HTTP_PORT   = int(sys.argv[3]) if len(sys.argv) > 3 else 8766

_ser       = None
_ser_lock  = threading.Lock()
_rx_buf    = bytearray()
_rx_lock   = threading.Lock()
_reader_running = False

# ── background reader ────────────────────────────────────────────────────────

def _reader():
    global _ser, _rx_buf
    while _reader_running:
        try:
            with _ser_lock:
                s = _ser
            if s and s.is_open:
                waiting = s.in_waiting
                if waiting:
                    chunk = s.read(waiting)
                    with _rx_lock:
                        _rx_buf.extend(chunk)
                else:
                    time.sleep(0.005)
            else:
                time.sleep(0.02)
        except Exception:
            time.sleep(0.05)

# ── HTTP handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # silence default access log

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
            self._json_resp({'ok': True, 'open': open_, 'port': SERIAL_PORT, 'baud': BAUD})

        elif self.path == '/drain':
            with _rx_lock:
                data = bytes(_rx_buf)
                _rx_buf.clear()
            self._json_resp({'ok': True, 'bytes': list(data)})

        else:
            self._json_resp({'ok': False, 'error': 'not found'}, 404)

    def do_POST(self):
        global _ser, _rx_buf, _reader_running

        if self.path == '/connect':
            body = self._read_body()
            port = body.get('port', SERIAL_PORT)
            baud = int(body.get('baud', BAUD))
            try:
                with _ser_lock:
                    if _ser and _ser.is_open:
                        _ser.close()
                    _ser = serial.Serial(port, baud, timeout=0)
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
            with _ser_lock:
                if _ser and _ser.is_open:
                    _ser.close()
            print('  Port closed.')
            self._json_resp({'ok': True})

        elif self.path == '/transact':
            body = self._read_body()
            tx_bytes  = bytes(body.get('tx', []))
            rx_count  = int(body.get('rx_count', 0))
            timeout_s = body.get('timeout_ms', 3000) / 1000.0
            try:
                with _rx_lock:
                    _rx_buf.clear()
                with _ser_lock:
                    if not (_ser and _ser.is_open):
                        raise IOError('Serial port not open')
                    _ser.write(tx_bytes)
                rx = bytearray()
                deadline = time.time() + timeout_s
                while len(rx) < rx_count and time.time() < deadline:
                    with _rx_lock:
                        chunk = bytes(_rx_buf)
                        _rx_buf.clear()
                    rx.extend(chunk)
                    if len(rx) < rx_count:
                        time.sleep(0.005)
                self._json_resp({'ok': True, 'rx': list(rx)})
            except Exception as e:
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


if __name__ == '__main__':
    cert_path, key_path = _generate_self_signed_cert()
    use_https = cert_path is not None

    if use_https:
        scheme = 'https'
    else:
        scheme = 'http'

    print(f'Church Machine FPGA Bridge ({scheme.upper()})')
    print(f'  Serial : {SERIAL_PORT} @ {BAUD} baud')
    print(f'  {scheme.upper():7s}: {scheme}://0.0.0.0:{HTTP_PORT}')
    print(f'  ChromeOS bridge URL: {scheme}://penguin.linux.test:{HTTP_PORT}')
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

    server = HTTPServer(('0.0.0.0', HTTP_PORT), Handler)
    if use_https:
        import ssl as _ssl
        ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert_path, key_path)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    server.serve_forever()
