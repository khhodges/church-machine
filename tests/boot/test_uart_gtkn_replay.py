"""UART GTKN packet replay test — loopback serial bridge harness.

Verifies that the serial bridge (server/local_bridge.py) correctly handles
a raw GTKN packet on the wire, catching framing, byte-ordering, and timing
bugs that are invisible in the in-process HTTP tests (test_hello_mum_e2e.py).

A GTKN packet is 3 × 32-bit big-endian words sent over UART:

    word 0  tag     = 0x47544B4E  ('GTKN' FourCC)
    word 1  count   = 0x00000001  (one payload word follows)
    word 2  payload = MumGT word  (arbitrary non-zero capability token)

The far end (real Ti60 hardware or, here, a pty-backed emulator) receives the
packet, verifies the tag, and writes back the GREET_RESPONSE (0x48454C4C,
'HELL') as a 4-byte big-endian word on the RX path.

Test approach
-------------
1. Create a Unix pty pair with pty.openpty():
     master_fd  — used by the FPGA emulator thread as the "hardware side"
     slave path — opened by local_bridge as the serial port
2. Configure the bridge module's global serial object to use the slave pty.
3. Start the bridge's background reader thread (drains serial → _rx_buf).
4. Start the bridge HTTP server on a free port.
5. POST /transact { tx: GTKN_PACKET, rx_count: 4, timeout_ms: 2000 }.
6. The FPGA emulator thread (on master_fd) reads the 12 TX bytes, verifies
   the tag word, then writes GREET_BYTES back.
7. The bridge reader accumulates the 4 RX bytes; /transact returns them.
8. Assertions confirm correct byte ordering, framing length, and the exact
   GREET_RESPONSE value.

Relevant files
--------------
  server/local_bridge.py          — serial ↔ HTTP bridge under test
  tests/boot/test_hello_mum_e2e.py — sibling e2e test (HTTP / simulator path)
"""

import importlib.util
import json
import os
import pty
import socket
import struct
import sys
import threading
import time
import urllib.request
from http.server import HTTPServer

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

# ---------------------------------------------------------------------------
# Wire constants (must match the UART abstraction in the Church Machine ISA)
# ---------------------------------------------------------------------------

GTKN_TAG       = 0x47544B4E   # FourCC 'GTKN' — big-endian on the wire
GREET_RESPONSE = 0x48454C4C   # 'HELL' — canonical Mum.Greet() return value
PAYLOAD_WORD   = 0x10CEEFFE   # arbitrary GT word (protocol-tag-1, slot 0)

# GTKN packet = 3 × 32-bit big-endian words: tag · count(=1) · payload
GTKN_PACKET = struct.pack(">III", GTKN_TAG, 1, PAYLOAD_WORD)
# Expected RX bytes from the far end
GREET_BYTES  = struct.pack(">I", GREET_RESPONSE)

# The bridge reader (local_bridge._reader) scans for the CALLHOME_MAGIC
# preamble (0xCE 0x11).  To avoid breaking a split callhome packet the reader
# keeps the *last* received byte in its look-ahead buffer and only transfers
# N-1 bytes to _rx_buf on each read.  That final byte is released only when
# more bytes arrive from the far end.
#
# On real Ti60 hardware more bytes always follow the greeting, so this is
# invisible in production.  In the loopback test harness the emulator must
# send one extra "flush byte" after GREET_BYTES so the scanner releases all
# four greeting bytes into _rx_buf before /transact times out.
#
# This is intentional test design — the flush byte also verifies that the
# scanner does NOT mistake the greeting for a callhome packet.
_FLUSH_BYTE = b"\x00"   # harmless sentinel; scanner keeps it in look-ahead


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _wait_for_port(port, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def _http_post(url, body_dict):
    """Synchronous HTTP POST; returns (status_code, parsed_json_dict)."""
    payload = json.dumps(body_dict).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, {}


# ---------------------------------------------------------------------------
# FPGA emulator — runs on the master side of the pty pair
# ---------------------------------------------------------------------------

class _FpgaEmulator:
    """Acts as the Ti60 hardware on the master end of the loopback pty.

    Reads exactly 12 bytes (the GTKN packet sent by the bridge), verifies the
    tag word, then writes the 4-byte GREET_RESPONSE back.  Runs in a daemon
    thread so the test can join it after the /transact call returns.
    """

    def __init__(self, master_fd):
        self.master_fd   = master_fd
        self.received    = bytearray()
        self.tag_ok      = False
        self.count_ok    = False
        self.framing_ok  = False
        self.responded   = False
        self.error       = None
        self._done_event = threading.Event()
        self._thread     = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def join(self, timeout=3.0):
        self._done_event.wait(timeout=timeout)
        return self._done_event.is_set()

    def _run(self):
        try:
            deadline = time.monotonic() + 3.0
            while len(self.received) < 12 and time.monotonic() < deadline:
                try:
                    chunk = os.read(self.master_fd, 64)
                    self.received.extend(chunk)
                except OSError:
                    break
                if len(self.received) < 12:
                    time.sleep(0.005)

            self.framing_ok = len(self.received) >= 12
            if not self.framing_ok:
                self.error = (
                    f"Received only {len(self.received)} bytes; "
                    "expected 12 (3 × 32-bit words)"
                )
                return

            tag, count, _ = struct.unpack(">III", bytes(self.received[:12]))
            self.tag_ok   = (tag   == GTKN_TAG)
            self.count_ok = (count == 1)

            if not self.tag_ok:
                self.error = (
                    f"Tag mismatch: got 0x{tag:08X}, "
                    f"expected 0x{GTKN_TAG:08X} ('GTKN')"
                )
                return

            # Send greeting then flush byte (see _FLUSH_BYTE comment above).
            os.write(self.master_fd, GREET_BYTES + _FLUSH_BYTE)
            self.responded = True
        except Exception as exc:
            self.error = str(exc)
        finally:
            self._done_event.set()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _load_local_bridge():
    """Load server/local_bridge.py as a module without executing __main__.

    local_bridge.py parses sys.argv at module level to determine the serial
    port, baud rate, and HTTP port.  When loaded under pytest, sys.argv
    contains flags like '-v' that break int() conversion.  We isolate the
    module from the test runner's argv by temporarily replacing sys.argv.
    """
    bridge_path = os.path.join(ROOT, "server", "local_bridge.py")
    spec = importlib.util.spec_from_file_location("local_bridge_under_test", bridge_path)
    lb   = importlib.util.module_from_spec(spec)
    saved_argv  = sys.argv[:]
    sys.argv    = [bridge_path]   # no positional args → defaults take effect
    try:
        spec.loader.exec_module(lb)
    finally:
        sys.argv = saved_argv
    return lb


@pytest.fixture(scope="module")
def bridge_context():
    """Start the local bridge HTTP server backed by a pty loopback port.

    Yields a dict with:
      - port       : HTTP port the bridge is listening on
      - master_fd  : file descriptor for the "FPGA side" of the pty
      - lb         : the loaded local_bridge module (for state inspection)

    The fixture is module-scoped; cleanup shuts the server and closes fds.
    """
    try:
        import serial as _serial  # noqa: F401 — confirm pyserial is present
    except ImportError:
        pytest.skip("pyserial not installed — UART replay test skipped")

    import serial

    lb = _load_local_bridge()

    master_fd, slave_fd = pty.openpty()
    slave_path = os.ttyname(slave_fd)

    with lb._ser_lock:
        lb._ser = serial.Serial(slave_path, 115200, timeout=0)
    with lb._rx_lock:
        lb._rx_buf.clear()

    lb._reader_running = True
    reader_t = threading.Thread(target=lb._reader, daemon=True)
    reader_t.start()

    port = _free_port()
    srv  = HTTPServer(('127.0.0.1', port), lb.Handler)
    srv_t = threading.Thread(target=srv.serve_forever, daemon=True)
    srv_t.start()

    assert _wait_for_port(port, timeout=5), (
        f"local_bridge HTTP server did not start on port {port} within 5 s"
    )

    yield {"port": port, "master_fd": master_fd, "lb": lb}

    srv.shutdown()
    lb._reader_running = False
    with lb._ser_lock:
        try:
            if lb._ser and lb._ser.is_open:
                lb._ser.close()
        except Exception:
            pass
    try:
        os.close(master_fd)
    except OSError:
        pass
    try:
        os.close(slave_fd)
    except OSError:
        pass


@pytest.fixture(scope="module")
def transact_result(bridge_context):
    """POST /transact with the GTKN packet and collect the bridge response.

    Spawns the FPGA emulator before sending, so the emulator is ready to
    receive the bytes the moment the bridge writes them to the pty.
    Returns (http_status, response_dict, fpga_emulator).
    """
    port      = bridge_context["port"]
    master_fd = bridge_context["master_fd"]

    emulator = _FpgaEmulator(master_fd)
    emulator.start()

    status, data = _http_post(
        f"http://127.0.0.1:{port}/transact",
        {
            "tx":         list(GTKN_PACKET),   # 12 bytes big-endian
            "rx_count":   4,                   # expect 4-byte GREET_RESPONSE
            "timeout_ms": 2000,
        },
    )

    emulator.join(timeout=3.0)
    return status, data, emulator


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_transact_returns_http_200(transact_result):
    """/transact must return HTTP 200 indicating the bridge accepted the call."""
    status, data, _ = transact_result
    assert status == 200, (
        f"/transact returned HTTP {status}, expected 200.\n"
        f"response={data!r}"
    )


def test_transact_response_ok(transact_result):
    """/transact JSON body must carry ok=True."""
    _, data, _ = transact_result
    assert data.get("ok") is True, (
        f"/transact ok={data.get('ok')!r}, expected True.\n"
        f"response={data!r}"
    )


def test_fpga_emulator_received_12_bytes(transact_result):
    """The bridge must have written exactly 12 bytes (3 × 32-bit words)
    to the serial port for the GTKN packet.

    Receiving fewer bytes indicates a framing bug (e.g. the bridge truncated
    the payload or sent only the tag without count/payload words).
    """
    _, _, emulator = transact_result
    assert emulator.framing_ok, (
        "FPGA emulator received fewer than 12 bytes from the bridge.\n"
        f"received={emulator.received.hex()!r}, "
        f"error={emulator.error!r}"
    )


def test_gtkn_tag_byte_order_is_big_endian(transact_result):
    """The first 4 bytes on the wire must be 47 54 4B 4E ('GTKN').

    A byte-ordering bug would produce 4E 4B 54 47 (little-endian) or a
    different permutation.  This assertion catches any such reversal.
    """
    _, _, emulator = transact_result
    assert emulator.framing_ok, "Cannot check tag — fewer than 12 bytes received"

    actual_tag_bytes = bytes(emulator.received[:4])
    expected_bytes   = struct.pack(">I", GTKN_TAG)   # 47 54 4B 4E
    assert actual_tag_bytes == expected_bytes, (
        f"GTKN tag byte order wrong on the wire.\n"
        f"Got     : {actual_tag_bytes.hex()}  ({actual_tag_bytes!r})\n"
        f"Expected: {expected_bytes.hex()}  "
        f"(big-endian 0x{GTKN_TAG:08X} = 'GTKN')\n"
        "This is a byte-ordering bug: the bridge is sending the tag in a "
        "different byte order than the Ti60 hardware expects."
    )


def test_gtkn_tag_value_recognised_by_fpga_emulator(transact_result):
    """The FPGA emulator must have positively matched the GTKN tag word."""
    _, _, emulator = transact_result
    assert emulator.tag_ok, (
        "FPGA emulator did not recognise the GTKN tag in the received packet.\n"
        f"received={emulator.received.hex()!r}, "
        f"error={emulator.error!r}"
    )


def test_gtkn_count_word_is_one(transact_result):
    """The count word (bytes 4-7) must be 0x00000001 (one payload word)."""
    _, _, emulator = transact_result
    assert emulator.framing_ok, "Cannot check count — fewer than 12 bytes received"

    count = struct.unpack(">I", bytes(emulator.received[4:8]))[0]
    assert count == 1, (
        f"GTKN count word = {count}, expected 1.\n"
        f"Packet hex: {emulator.received[:12].hex()}"
    )


def test_fpga_emulator_sent_greet_response(transact_result):
    """The FPGA emulator must have written the GREET_RESPONSE back on the
    RX path in response to the valid GTKN packet.

    If this fails while test_gtkn_tag_value_recognised_by_fpga_emulator
    passes, the emulator itself has a logic bug and the test harness needs
    to be inspected.
    """
    _, _, emulator = transact_result
    assert emulator.responded, (
        "FPGA emulator did not write GREET_RESPONSE back to the bridge.\n"
        f"tag_ok={emulator.tag_ok}, framing_ok={emulator.framing_ok}, "
        f"error={emulator.error!r}"
    )


def test_rx_bytes_match_greet_response(transact_result):
    """The bridge must return at least 4 RX bytes, and the first 4 must equal
    the big-endian encoding of GREET_RESPONSE.

    The emulator sends a _FLUSH_BYTE sentinel after GREET_BYTES to release the
    bridge reader's CALLHOME_MAGIC look-ahead buffer.  Depending on timing,
    that extra byte may or may not appear in the /transact rx list (the request
    specifies rx_count=4, so the bridge stops collecting once it has 4 bytes;
    the flush byte is buffered at most).  We therefore validate only the first
    4 bytes so the test is not sensitive to whether _reader ever improves to
    release bytes without a sentinel.

    This is the primary timing / framing assertion: it fails if the bridge
    either never receives the bytes (timing bug), returns them in the wrong
    order (byte-order bug), or truncates them (framing bug).
    """
    _, data, _ = transact_result
    rx = data.get("rx", [])
    assert len(rx) >= 4, (
        f"Bridge returned only {len(rx)} RX byte(s); need at least 4.\n"
        f"rx={rx!r}\n"
        "This may be a timing bug: the bridge timed out before the FPGA "
        "emulator wrote the GREET_RESPONSE, or a framing bug where the "
        "expected rx_count does not match the packet size."
    )
    rx_bytes = bytes(rx[:4])
    expected = GREET_BYTES   # struct.pack(">I", 0x48454C4C) = b'\x48\x45\x4C\x4C'
    assert rx_bytes == expected, (
        f"First 4 RX bytes mismatch.\n"
        f"Got     : {rx_bytes.hex()}  ({list(rx_bytes)})\n"
        f"Expected: {expected.hex()}  ({list(expected)})  "
        f"(big-endian 0x{GREET_RESPONSE:08X} = 'HELL')\n"
        "This is a byte-ordering bug: the bridge received bytes in the wrong "
        "order, or the FPGA emulator sent them incorrectly."
    )


def test_rx_word_equals_greet_response_integer(transact_result):
    """The first 4 RX bytes, interpreted as a big-endian 32-bit word, must
    equal GREET_RESPONSE (0x48454C4C).

    This is the end-to-end assertion tying the raw wire bytes back to the
    canonical protocol constant.  Only the first 4 bytes are checked; a
    possible flush byte at rx[4] is irrelevant to the protocol result.
    """
    _, data, _ = transact_result
    rx = data.get("rx", [])
    if len(rx) < 4:
        pytest.fail(
            f"Cannot decode GREET_RESPONSE — only {len(rx)} RX byte(s) returned"
        )
    word = struct.unpack(">I", bytes(rx[:4]))[0]
    assert word == GREET_RESPONSE, (
        f"Decoded RX word = 0x{word:08X}, expected 0x{GREET_RESPONSE:08X} "
        f"('HELL').\n"
        f"rx={rx!r}"
    )
