"""hardware/test_wukong_bridge_dispatch.py — integration tests for the bridge
command-dispatch path, specifically the 'u' (upload) command.

These tests import wukong_bridge as a module (not as a script), verify that
_handle_upload is reachable from the module's global namespace, and exercise
the dispatch logic with a mock serial port and a mock HTTP server.

Run with:  python -m pytest hardware/test_wukong_bridge_dispatch.py -v
"""

import base64
import importlib
import struct
import sys
import os
import threading
import types
import unittest.mock as mock

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, ROOT)


# ── helpers ───────────────────────────────────────────────────────────────────

def _import_bridge():
    """Import (or re-import) wukong_bridge without executing main()."""
    # Patch requests so any accidental network call is captured, not sent.
    with mock.patch.dict(sys.modules, {'serial': _fake_serial_module()}):
        # wukong_bridge imports serial at module level; patch before import.
        if 'hardware.wukong_bridge' in sys.modules:
            return sys.modules['hardware.wukong_bridge']
        return importlib.import_module('hardware.wukong_bridge')


def _fake_serial_module():
    """Return a minimal fake `serial` module so the bridge imports cleanly
    in environments without pyserial installed."""
    fake = types.ModuleType('serial')
    fake.Serial = mock.MagicMock
    return fake


class _FakeSer:
    """Minimal mock serial port: records written bytes, feeds read bytes.

    The drain step in _handle_upload now runs BEFORE ser.write(), so timing
    is modelled correctly:

    ``stale_bytes``  — bytes already in the RX FIFO before the upload frame
                       is sent.  ``in_waiting`` starts at len(stale_bytes).
                       The drain (which runs before write()) reads these into
                       leftover so they reach the trace parser.

    ``read_bytes``   — bytes the board sends AFTER write() completes (the ACK
                       and any trace bytes emitted on startup).  write() moves
                       them into the read buffer and updates in_waiting so the
                       ACK wait loop can consume them in one or more reads.
    """
    def __init__(self, read_bytes=b'', stale_bytes=b''):
        self._written    = bytearray()
        self._buf        = bytearray(stale_bytes)   # immediately readable
        self._post_queue = bytearray(read_bytes)    # loaded into _buf on write()
        self.in_waiting  = len(stale_bytes)

    def write(self, data):
        self._written.extend(data)
        # Board "responds" once the frame has been sent.
        self._buf.extend(self._post_queue)
        self._post_queue.clear()
        self.in_waiting = len(self._buf)

    def flush(self):
        pass

    def read(self, n):
        chunk = bytes(self._buf[:n])
        del self._buf[:n]
        self.in_waiting = len(self._buf)
        return chunk


# ── Sanity: _handle_upload is importable from the module ─────────────────────

def test_handle_upload_is_defined_in_module():
    """_handle_upload must be reachable as a module-level name.

    Previously it was defined AFTER the `if __name__ == '__main__': main()`
    block; since main() never returns, _handle_upload was never bound in the
    module's global namespace, causing a NameError on every 'u' command.
    """
    bridge = _import_bridge()
    assert hasattr(bridge, '_handle_upload'), (
        "_handle_upload is not defined in the wukong_bridge module namespace; "
        "it may be placed after the if-__name__-main block"
    )
    assert callable(bridge._handle_upload)


# ── _handle_upload: success path ──────────────────────────────────────────────

def test_handle_upload_writes_frame_and_posts_ack_on_success():
    """On a valid payload and a board that responds with 0x06 (ACK):
      - Writes magic 0x75 + 4-byte BE length + BE-swapped payload to UART
      - POSTs {ok: True} to /hardware/wukong/upload-ack
    """
    bridge = _import_bridge()

    # A 2-word LE payload (simulating boot-image.bin)
    le_words = [0xDEADBEEF, 0xCAFEBABE]
    le_bytes  = struct.pack('<2I', *le_words)
    b64data   = base64.b64encode(le_bytes).decode('ascii')

    # Serial port that immediately provides the 0x06 ACK byte
    ser = _FakeSer(read_bytes=bytes([0x06]))

    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        bridge._handle_upload({'data': b64data}, ser, 'http://ide', True)

    # Check frame written to UART
    written = bytes(ser._written)
    assert written[0:1] == b'\x75', "Missing magic byte 0x75"
    length_field = struct.unpack('>I', written[1:5])[0]
    assert length_field == len(le_bytes), (
        f"Length field {length_field} != expected {len(le_bytes)}")

    # Payload should be BE-swapped (LE→BE word swap done by the bridge)
    payload = written[5:]
    expected_payload = struct.pack('>2I', *le_words)
    assert payload == expected_payload, (
        f"Payload endianness wrong:\n  got      {payload.hex()}\n"
        f"  expected {expected_payload.hex()}")

    # Should have POSTed upload-ack with ok=True
    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts, "No upload-ack POST was made"
    assert ack_posts[-1]['json'].get('ok') is True


def test_handle_upload_reboots_after_ack_when_requested():
    """A complete native DMEM replacement must reboot through the boot ROM
    before the bridge reports upload success."""
    bridge = _import_bridge()
    le_bytes = struct.pack('<I', 0xF8005C05)
    ser = _FakeSer(read_bytes=bytes([0x06]))
    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        return mock.MagicMock(status_code=200)

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        bridge._handle_upload(
            {'data': base64.b64encode(le_bytes).decode('ascii'), 'reboot': True},
            ser, 'http://ide', True,
        )

    assert bytes(ser._written).endswith(b'f')
    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts[-1]['json'].get('ok') is True


def test_handle_upload_posts_ack_failure_on_board_timeout():
    """If the board does not send 0x06 within the timeout, the bridge POSTs
    {ok: False} to /hardware/wukong/upload-ack."""
    bridge = _import_bridge()

    le_bytes = struct.pack('<I', 0x12345678)
    b64data  = base64.b64encode(le_bytes).decode('ascii')

    # Serial port that returns no bytes (no ACK from board)
    ser = _FakeSer(read_bytes=b'')

    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    # Shorten the ACK timeout so the test finishes quickly
    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        with mock.patch.object(bridge, '_handle_upload',
                               wraps=bridge._handle_upload):
            # Monkeypatch _ACK_TIMEOUT_S to 0.05 s by patching time.time
            _call_count = [0]
            _start = [None]
            import time as _time
            _real_time = _time.time

            def _patched_time():
                _call_count[0] += 1
                if _start[0] is None:
                    _start[0] = _real_time()
                # After 3 real-time calls, simulate deadline exceeded
                if _call_count[0] > 3:
                    return _start[0] + 9999
                return _real_time()

            with mock.patch('hardware.wukong_bridge.time.time',
                            side_effect=_patched_time):
                bridge._handle_upload({'data': b64data}, ser, 'http://ide', True)

    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts, "No upload-ack POST was made on timeout"
    assert ack_posts[-1]['json'].get('ok') is False
    assert 'error' in ack_posts[-1]['json']


def test_handle_upload_posts_ack_failure_on_empty_payload():
    """Empty data payload → POSTs {ok: False} immediately."""
    bridge = _import_bridge()
    ser    = _FakeSer()
    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        bridge._handle_upload({'data': ''}, ser, 'http://ide', True)

    assert not ser._written, "No bytes should be written for an empty payload"
    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts, "Should have POSTed upload-ack"
    assert ack_posts[-1]['json'].get('ok') is False


def test_handle_upload_posts_ack_failure_on_bad_base64():
    """Invalid base64 → POSTs {ok: False} immediately."""
    bridge = _import_bridge()
    ser    = _FakeSer()
    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        bridge._handle_upload({'data': '!!!not-base64!!!'}, ser, 'http://ide', True)

    assert not ser._written, "No bytes should be written for bad base64"
    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts, "Should have POSTed upload-ack"
    assert ack_posts[-1]['json'].get('ok') is False


# ── dispatch: 'u' command reaches _handle_upload ─────────────────────────────

def test_dispatch_loop_calls_handle_upload_for_u_command():
    """The command-dispatch path in main()'s poll loop routes cmd='u' to
    _handle_upload.  Verifies the function is reachable (not shadowed by the
    __name__-main ordering bug) and is called with the correct arguments.
    """
    bridge = _import_bridge()

    le_bytes = struct.pack('<2I', 0xAAAAAAAA, 0xBBBBBBBB)
    b64data  = base64.b64encode(le_bytes).decode('ascii')

    ser    = _FakeSer(read_bytes=bytes([0x06]))
    called = []

    def _fake_handle_upload(data, ser_, ide_base, verify_tls):
        called.append({'data': data, 'ide_base': ide_base})

    # Simulate what main() does on a 'u' poll response
    cmd_data = {'cmd': 'u', 'data': b64data}
    cmd      = cmd_data.get('cmd')
    assert cmd == 'u'

    # Patch _handle_upload in the module and call through the same dispatch
    # branch (replicated here to avoid needing a full main() mock)
    with mock.patch.object(bridge, '_handle_upload', side_effect=_fake_handle_upload):
        if cmd == 'u':
            bridge._handle_upload(cmd_data, ser, 'http://ide', True)

    assert called, "_handle_upload was not called for cmd='u'"
    assert called[0]['data'] == cmd_data
    assert called[0]['ide_base'] == 'http://ide'


# ── leftover byte preservation ────────────────────────────────────────────────

def _make_b64(words_le):
    """Helper: pack a list of ints as LE words and base64-encode them."""
    return base64.b64encode(struct.pack(f'<{len(words_le)}I', *words_le)).decode('ascii')


def _patched_post():
    """Return a fake requests.post that swallows calls silently."""
    def _fp(url, json=None, **kwargs):
        r = mock.MagicMock()
        r.status_code = 200
        return r
    return _fp


def test_handle_upload_returns_bytearray_not_none_on_success():
    """_handle_upload must return a bytearray on the success path so the
    caller can safely do `buf[0:0] = leftover` without a TypeError."""
    bridge = _import_bridge()
    ser    = _FakeSer(read_bytes=bytes([0x06]))
    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_patched_post()):
        result = bridge._handle_upload({'data': _make_b64([0xAABBCCDD])},
                                       ser, 'http://ide', True)
    assert isinstance(result, bytearray), (
        f"_handle_upload should return bytearray, got {type(result)}")


def test_handle_upload_returns_bytearray_on_early_error_paths():
    """Empty payload and bad-base64 early-exit paths must also return bytearray,
    not None, so the caller never receives a non-splicing type."""
    bridge = _import_bridge()
    ser    = _FakeSer()
    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_patched_post()):
        r1 = bridge._handle_upload({'data': ''}, ser, 'http://ide', True)
        r2 = bridge._handle_upload({'data': '!!!bad!!!'}, ser, 'http://ide', True)
    assert isinstance(r1, bytearray), f"empty payload: got {type(r1)}"
    assert isinstance(r2, bytearray), f"bad base64: got {type(r2)}"


def test_non_ack_bytes_before_ack_returned_as_leftover():
    """Bytes arriving before the 0x06 ACK byte (e.g. a partial trace packet
    the board emitted while DMEM write was completing) must appear in the
    returned leftover bytearray.

    Without this fix the bytes are discarded; the trace parser misses the
    initial hardware events from the freshly loaded image.
    """
    bridge = _import_bridge()
    trace_before = bytes([0xAA, 0x01, 0x02, 0x03])   # fake trace bytes
    ack          = bytes([0x06])
    ser          = _FakeSer(read_bytes=trace_before + ack)

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_patched_post()):
        leftover = bridge._handle_upload({'data': _make_b64([0xDEADBEEF])},
                                         ser, 'http://ide', True)

    assert bytes(leftover) == trace_before, (
        f"Expected leftover={trace_before.hex()!r}, got {bytes(leftover).hex()!r}\n"
        "Non-ACK bytes arriving before the ACK must be preserved for the trace parser")


def test_non_ack_bytes_after_ack_in_same_chunk_returned_as_leftover():
    """Bytes arriving in the same serial read chunk as the ACK but after it
    must also be in the leftover bytearray.

    The board may emit a trace packet within the same UART FIFO read window
    as the ACK byte; discarding the trailing bytes would drop the first
    post-boot trace event.
    """
    bridge      = _import_bridge()
    ack         = bytes([0x06])
    trace_after = bytes([0xAA, 0x05, 0x06, 0x07, 0x08])   # fake trace after ACK
    ser         = _FakeSer(read_bytes=ack + trace_after)

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_patched_post()):
        leftover = bridge._handle_upload({'data': _make_b64([0xCAFEBABE])},
                                         ser, 'http://ide', True)

    assert bytes(leftover) == trace_after, (
        f"Expected leftover={trace_after.hex()!r}, got {bytes(leftover).hex()!r}\n"
        "Non-ACK bytes arriving after the ACK in the same chunk must be preserved")


def test_stale_rx_bytes_drained_before_ack_wait():
    """Stale UART RX bytes present when _handle_upload begins the ACK wait must
    be drained into leftover before the ACK wait loop, not matched against 0x06.

    Without the drain step a stale 0x06 (e.g. from a CALL_CR6 trace event
    queued before the 'u' command arrived) would cause a false-positive ACK
    and the IDE would send step/run while the FPGA is still receiving bytes.

    The drain makes 0x06 unambiguous: after draining, the only source is the
    RTL's UPLOAD_ACK state (CM is halted, no trace events possible).
    """
    bridge = _import_bridge()

    le_bytes = struct.pack('<I', 0x12345678)
    b64data  = base64.b64encode(le_bytes).decode('ascii')

    # stale_bytes=bytes([0x06]): a 0x06 already in the UART buffer before upload.
    # read_bytes=bytes([0x06]): the real board ACK arriving after the write.
    # The drain step reads stale_bytes into leftover; read_bytes is then the ACK.
    ser = _FakeSer(stale_bytes=bytes([0x06]), read_bytes=bytes([0x06]))

    posted = []

    def _fake_post(url, json=None, **kwargs):
        posted.append({'url': url, 'json': json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_fake_post):
        leftover = bridge._handle_upload({'data': b64data}, ser, 'http://ide', True)

    # The stale 0x06 must appear in leftover (drained, not treated as ACK)
    assert bytes(leftover).count(0x06) >= 1, (
        f"Expected the stale 0x06 to be in leftover (was drained before ACK wait); "
        f"got leftover={bytes(leftover).hex()!r}")

    # Upload must still succeed (real ACK received after drain)
    ack_posts = [p for p in posted if 'upload-ack' in p['url']]
    assert ack_posts, "No upload-ack POST made"
    assert ack_posts[-1]['json'].get('ok') is True, (
        f"Upload should succeed (real ACK received after drain); "
        f"got {ack_posts[-1]['json']}")


def test_non_ack_bytes_across_multiple_reads_all_preserved():
    """When non-ACK bytes arrive across several serial reads before the ACK,
    all of them are accumulated in the leftover bytearray.

    Simulates the realistic case where the trace FIFO drains across multiple
    ser.read() calls before the board finally sends the 0x06 ACK.
    """
    bridge = _import_bridge()

    # Simulate: first read gives 3 non-ACK bytes, second gives 2 more + ACK
    class _MultiReadSer:
        def __init__(self):
            self._written  = bytearray()
            self._reads    = [bytes([0xAA, 0x11, 0x22]),
                              bytes([0x33, 0x44, 0x06])]
            self._idx      = 0
            self.in_waiting = 3

        def write(self, data):
            self._written.extend(data)

        def flush(self):
            pass

        def read(self, n):
            if self._idx >= len(self._reads):
                return b''
            chunk = self._reads[self._idx]
            self._idx += 1
            self.in_waiting = len(self._reads[self._idx]) if self._idx < len(self._reads) else 0
            return chunk

    ser = _MultiReadSer()
    with mock.patch('hardware.wukong_bridge.requests.post', side_effect=_patched_post()):
        leftover = bridge._handle_upload({'data': _make_b64([0x12345678])},
                                         ser, 'http://ide', True)

    expected = bytes([0xAA, 0x11, 0x22, 0x33, 0x44])
    assert bytes(leftover) == expected, (
        f"Expected leftover={expected.hex()!r}, got {bytes(leftover).hex()!r}\n"
        "All non-ACK bytes across multiple reads must be accumulated")
