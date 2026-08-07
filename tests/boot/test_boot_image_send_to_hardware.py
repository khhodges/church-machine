"""Integration tests for the ⚡ Load to Hardware upload pipeline.

Covers:
  POST /api/boot-image/send-to-hardware
    - Returns 404 when boot-image.bin is absent
    - Returns 200 + {queued:True} when boot-image.bin exists and clears the
      stale upload-ack BEFORE making the command observable (ACK-race fix)
    - The enqueued command has cmd='u' and a non-empty base64 data field

  POST /hardware/wukong/command  (cmd='u')
    - Accepted alongside existing s/r/h/b commands
    - Requires the 'data' field; returns 400 when absent

  GET + POST /hardware/wukong/upload-ack
    - Returns {} before any bridge post
    - Returns {ok:True} after a successful bridge post; consumed on GET
    - Returns {ok:False, error:'...'} after a failure post

  ACK ordering
    - upload-ack is reset to {} before the 'u' command is made observable,
      so a fast bridge that posts the ACK before send-to-hardware returns
      still causes a fresh poll cycle rather than a stale-ACK false-positive
"""
import base64
import json
import os
import struct
import sys
import threading
import time

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_wukong_globals():
    """Reset the command-queue, upload-ack, and in-flight globals between tests."""
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    yield
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False


@pytest.fixture
def boot_bin_path(tmp_path, monkeypatch):
    """Temporarily replace server/lumps/boot-image.bin with a tiny test image."""
    lumps_dir = os.path.join(ROOT, 'server', 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)
    bin_path = os.path.join(lumps_dir, 'boot-image.bin')

    # A minimal well-formed boot image: 16 words (64 bytes), all zeros except
    # the first word which carries a non-zero format tag.  Exact contents don't
    # matter here — we just need a readable file with len > 0 and len % 4 == 0.
    payload = struct.pack('>16I', 0xDEADBEEF, *([0] * 15))

    existed_before = os.path.exists(bin_path)
    old_data = open(bin_path, 'rb').read() if existed_before else None

    with open(bin_path, 'wb') as fh:
        fh.write(payload)

    yield bin_path, payload

    # Restore original state
    if existed_before and old_data is not None:
        with open(bin_path, 'wb') as fh:
            fh.write(old_data)
    elif not existed_before and os.path.exists(bin_path):
        os.remove(bin_path)


# ── send-to-hardware: 404 when file absent ────────────────────────────────────

def test_send_to_hardware_missing_file_returns_404(client, tmp_path, monkeypatch):
    """Returns 404 when boot-image.bin does not exist."""
    # Redirect SERVER_DIR to a temp dir that has no lumps/boot-image.bin.
    fake_server_dir = str(tmp_path / 'server')
    monkeypatch.setattr(_app_module, '_SERVER_DIR', fake_server_dir)

    resp = client.post('/api/boot-image/send-to-hardware',
                       content_type='application/json', data='{}')
    assert resp.status_code == 404
    body = json.loads(resp.data)
    assert 'error' in body
    assert 'boot-image.bin' in body['error']


# ── send-to-hardware: enqueues upload command ─────────────────────────────────

def test_send_to_hardware_enqueues_upload_command(client, boot_bin_path):
    """Returns 200 {queued:True} and places a 'u' command in the queue."""
    resp = client.post('/api/boot-image/send-to-hardware',
                       content_type='application/json', data='{}')
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body.get('queued') is True
    assert 'size' in body

    # Bridge poll should see a 'u' command.
    poll = client.get('/hardware/wukong/command')
    assert poll.status_code == 200
    cmd_data = json.loads(poll.data)
    assert cmd_data.get('cmd') == 'u'
    assert 'data' in cmd_data
    assert len(cmd_data['data']) > 0


def test_send_to_hardware_base64_payload_decodes_correctly(client, boot_bin_path):
    """The base64 'data' field round-trips back to the original file contents."""
    _, original_payload = boot_bin_path

    client.post('/api/boot-image/send-to-hardware',
                content_type='application/json', data='{}')

    poll = client.get('/hardware/wukong/command')
    cmd_data = json.loads(poll.data)
    decoded = base64.b64decode(cmd_data['data'])
    assert decoded == original_payload


# ── ACK race fix: ack cleared before command is observable ────────────────────

def test_send_to_hardware_clears_stale_ack_before_command(client, boot_bin_path):
    """Stale upload-ack from a prior upload is cleared before the new 'u'
    command is made visible to the bridge.  A fast bridge that completes the
    upload and POSTs upload-ack while send-to-hardware is in flight must not
    leave a stale ACK that the IDE could mis-read as a fresh result.

    We simulate this by pre-seeding a stale {ok:True} in the upload-ack
    store, then calling send-to-hardware and immediately GETting the ack.
    The GET must return {} (cleared), not the stale value.
    """
    # Pre-seed stale ACK from a prior upload session.
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {'ok': True}

    resp = client.post('/api/boot-image/send-to-hardware',
                       content_type='application/json', data='{}')
    assert resp.status_code == 200

    # The ack store must be empty now (cleared by send-to-hardware).
    ack = client.get('/hardware/wukong/upload-ack')
    assert ack.status_code == 200
    ack_data = json.loads(ack.data)
    assert ack_data == {}


# ── /hardware/wukong/command: 'u' cmd accepted / rejected ─────────────────────

def test_wukong_command_accepts_u_with_data(client):
    """POST /hardware/wukong/command accepts {cmd:'u', data:'...'} → 200."""
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'u', 'data': 'AAAA'}))
    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body.get('ok') is True


def test_wukong_command_rejects_u_without_data(client):
    """POST /hardware/wukong/command with cmd='u' but no data → 400."""
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'u'}))
    assert resp.status_code == 400
    body = json.loads(resp.data)
    assert body.get('ok') is False


def test_wukong_command_rejects_unknown_cmd(client):
    """Existing behaviour: unknown cmds return 400."""
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'z'}))
    assert resp.status_code == 400


# ── /hardware/wukong/upload-ack GET + POST ────────────────────────────────────

def test_upload_ack_get_returns_empty_before_any_post(client):
    """GET upload-ack returns {} when no bridge post has occurred."""
    resp = client.get('/hardware/wukong/upload-ack')
    assert resp.status_code == 200
    assert json.loads(resp.data) == {}


def test_upload_ack_post_success_then_get_consumes(client):
    """Bridge POSTs {ok:True}; IDE GETs it once, then gets {} on next GET."""
    # Bridge reports success.
    post_resp = client.post('/hardware/wukong/upload-ack',
                            content_type='application/json',
                            data=json.dumps({'ok': True}))
    assert post_resp.status_code == 200

    # IDE reads result.
    get1 = client.get('/hardware/wukong/upload-ack')
    assert get1.status_code == 200
    data1 = json.loads(get1.data)
    assert data1.get('ok') is True

    # Second GET: result is consumed → empty.
    get2 = client.get('/hardware/wukong/upload-ack')
    assert json.loads(get2.data) == {}


def test_upload_ack_post_failure_carries_error(client):
    """Bridge POSTs {ok:False, error:'timeout'}; IDE reads the error string."""
    client.post('/hardware/wukong/upload-ack',
                content_type='application/json',
                data=json.dumps({'ok': False, 'error': 'board ACK timeout after 10 s'}))

    resp = client.get('/hardware/wukong/upload-ack')
    data = json.loads(resp.data)
    assert data.get('ok') is False
    assert 'timeout' in data.get('error', '')


# ── Existing s/r/h/b commands still work after adding 'u' ────────────────────

@pytest.mark.parametrize('cmd', ['s', 'r', 'h'])
def test_existing_single_byte_cmds_still_accepted(client, cmd):
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': cmd}))
    assert resp.status_code == 200
    assert json.loads(resp.data).get('ok') is True


def test_breakpoint_cmd_still_accepted(client):
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'b', 'nia': 0x100}))
    assert resp.status_code == 200
    assert json.loads(resp.data).get('ok') is True


# ── Endianness contract: LE file → bridge BE-swap → RTL → correct DMEM ────────

def test_server_queues_raw_le_file_bytes():
    """The server base64-encodes the raw boot-image.bin bytes (little-endian)
    unchanged.  The bridge is responsible for the LE→BE word swap before UART
    transmission.  This test confirms the server side of that contract."""
    import base64, struct
    # Construct a LE file with known word values
    words = [0xDEADBEEF, 0xCAFEBABE, 0x00000001, 0x12345678]
    le_bytes = struct.pack(f'<{len(words)}I', *words)

    lumps_dir = os.path.join(ROOT, 'server', 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)
    bin_path  = os.path.join(lumps_dir, 'boot-image.bin')

    existed   = os.path.exists(bin_path)
    old_data  = open(bin_path, 'rb').read() if existed else None
    try:
        with open(bin_path, 'wb') as fh:
            fh.write(le_bytes)

        app.config['TESTING'] = True
        with app.test_client() as c:
            import server.app as _app_module
            with _app_module._wukong_command_lock:
                _app_module._wukong_pending_cmd = None

            resp = c.post('/api/boot-image/send-to-hardware',
                          content_type='application/json', data='{}')
        assert resp.status_code == 200

        with app.test_client() as c:
            poll = c.get('/hardware/wukong/command')
        cmd_data = json.loads(poll.data)
        decoded  = base64.b64decode(cmd_data['data'])

        # Server should have queued the raw LE bytes as-is
        assert decoded == le_bytes, "Server altered the file bytes before base64-encoding"

        # Bridge formula: byte-swap each LE word to BE before UART transmission.
        n = len(decoded) // 4
        be_wire  = struct.pack(f'>{n}I', *struct.unpack(f'<{n}I', decoded[:n * 4]))
        recovered = list(struct.unpack(f'>{n}I', be_wire))
        assert recovered == words, (
            f"LE→BE round-trip failed: got {[hex(w) for w in recovered]}")
    finally:
        if existed and old_data is not None:
            with open(bin_path, 'wb') as fh:
                fh.write(old_data)
        elif not existed and os.path.exists(bin_path):
            os.remove(bin_path)


def test_bridge_le_to_be_swap_formula():
    """Unit-level proof of the LE→BE word-swap formula that wukong_bridge.py uses.

    boot-image.bin words are stored little-endian by boot_image.py
    (struct.pack('<...I', *mem)).  The RTL upload FSM treats the first received
    byte as the MSByte of each DMEM word (big-endian assembly in the Cat()
    expression).  The bridge must therefore swap each LE word to BE before
    writing to UART.  This test verifies the transformation is invertible.
    """
    words    = [0xDEADBEEF, 0xCAFEBABE, 0x00000001, 0x80000000, 0x12345678]
    le_bytes = struct.pack(f'<{len(words)}I', *words)

    # Bridge byte-swap (mirrors _handle_upload in wukong_bridge.py)
    n       = len(le_bytes) // 4
    be_wire = struct.pack(f'>{n}I', *struct.unpack(f'<{n}I', le_bytes[:n * 4]))

    # RTL assembly: read big-endian words from wire bytes
    recovered = list(struct.unpack(f'>{n}I', be_wire))
    assert recovered == words, (
        f"Byte-swap round-trip failed at words "
        f"{[i for i, (a, b) in enumerate(zip(recovered, words)) if a != b]}"
    )


# ── Upload in-flight serialisation ────────────────────────────────────────────

def test_board_cmds_rejected_while_upload_in_flight(client):
    """s/r/h/b commands return 409 while _upload_in_flight is True.

    The UART is a shared serial channel — the bridge serialises operations by
    blocking in _handle_upload.  If an s/r/h/b command were queued during that
    window it would reach the RTL immediately after the upload, potentially
    landing as DMEM payload and silently corrupting the boot image.
    """
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = True

    for cmd in ('s', 'r', 'h'):
        resp = client.post('/hardware/wukong/command',
                           content_type='application/json',
                           data=json.dumps({'cmd': cmd}))
        assert resp.status_code == 409, (
            f"Expected 409 for cmd='{cmd}' while upload in-flight, got {resp.status_code}")
        body = json.loads(resp.data)
        assert body.get('ok') is False
        assert 'upload in progress' in body.get('error', '')

    # Breakpoint also rejected while in-flight
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'b', 'nia': 0x100}))
    assert resp.status_code == 409, "Expected 409 for 'b' while upload in-flight"


def test_u_cmd_rejected_while_upload_in_flight(client):
    """A second 'u' upload command via /hardware/wukong/command is rejected
    with 409 while _upload_in_flight is True.

    The server uses a one-slot command queue.  A second 'u' would overwrite the
    pending slot, leaving the bridge racing between two images; the first
    upload's ACK is then consumed as the second upload's result → wrong-image
    execution.  Blocking 'u' prevents this silently-wrong outcome.
    """
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = True

    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'u', 'data': 'AAAA'}))
    assert resp.status_code == 409, (
        f"Expected 409 for cmd='u' while upload in-flight, got {resp.status_code}")
    body = json.loads(resp.data)
    assert body.get('ok') is False
    assert 'upload in progress' in body.get('error', '')


def test_upload_in_flight_cleared_after_upload_ack(client):
    """POSTing upload-ack (success or failure) clears the in-flight flag so
    subsequent execution commands are accepted."""
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = True

    # Bridge posts success ACK
    client.post('/hardware/wukong/upload-ack',
                content_type='application/json',
                data=json.dumps({'ok': True}))

    with _app_module._upload_in_flight_lock:
        assert not _app_module._upload_in_flight, (
            "_upload_in_flight should be False after upload-ack POST")

    # Now execution commands should be accepted again
    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 's'}))
    assert resp.status_code == 200


def test_upload_in_flight_cleared_after_upload_ack_failure(client):
    """An upload-ack POST with ok=false also clears the in-flight flag."""
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = True

    client.post('/hardware/wukong/upload-ack',
                content_type='application/json',
                data=json.dumps({'ok': False, 'error': 'board ACK timeout'}))

    with _app_module._upload_in_flight_lock:
        assert not _app_module._upload_in_flight, (
            "_upload_in_flight should be False even after a failed upload-ack")


def test_send_to_hardware_sets_in_flight_flag(client, boot_bin_path):
    """send-to-hardware sets _upload_in_flight before returning, blocking
    execution commands that would otherwise corrupt the UART stream."""
    # Initially not in-flight
    with _app_module._upload_in_flight_lock:
        assert not _app_module._upload_in_flight

    client.post('/api/boot-image/send-to-hardware',
                content_type='application/json', data='{}')

    with _app_module._upload_in_flight_lock:
        assert _app_module._upload_in_flight, (
            "_upload_in_flight should be True after send-to-hardware")


def test_send_to_hardware_rejected_while_upload_in_flight(client, boot_bin_path):
    """A second call to send-to-hardware while an upload is in-flight returns
    409 with {in_flight: True}.

    Without this guard, the second call would overwrite the pending command
    slot; the bridge then transmits a race-condition image and the first ACK
    clears the flag for the wrong upload.
    """
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = True

    resp = client.post('/api/boot-image/send-to-hardware',
                       content_type='application/json', data='{}')
    assert resp.status_code == 409, (
        f"Expected 409 for send-to-hardware while in-flight, got {resp.status_code}")
    body = json.loads(resp.data)
    assert body.get('in_flight') is True
    assert 'upload in progress' in body.get('error', '')


def test_double_send_to_hardware_second_blocked(client, boot_bin_path):
    """Simulates a double-click: the first send-to-hardware succeeds and sets
    the in-flight flag; the second returns 409 and does NOT overwrite the
    queued command or disturb the flag state."""
    # First request: should succeed
    resp1 = client.post('/api/boot-image/send-to-hardware',
                        content_type='application/json', data='{}')
    assert resp1.status_code == 200, (
        f"First send-to-hardware expected 200, got {resp1.status_code}")
    body1 = json.loads(resp1.data)
    assert body1.get('queued') is True

    # Capture the command queued by the first request
    poll1 = client.get('/hardware/wukong/command')
    first_cmd = json.loads(poll1.data)
    assert first_cmd.get('cmd') == 'u'
    first_data = first_cmd.get('data', '')

    # Re-queue the same command (poll consumed it) so we can check after
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = {'cmd': 'u', 'data': first_data}

    # Second request while still in-flight: must be rejected
    resp2 = client.post('/api/boot-image/send-to-hardware',
                        content_type='application/json', data='{}')
    assert resp2.status_code == 409, (
        f"Second send-to-hardware expected 409, got {resp2.status_code}")
    assert json.loads(resp2.data).get('in_flight') is True

    # The pending command must still be the ORIGINAL first-upload data
    poll2 = client.get('/hardware/wukong/command')
    second_pending = json.loads(poll2.data)
    assert second_pending.get('data') == first_data, (
        "Second send-to-hardware overwrote the pending command — double-click race")

    # In-flight flag still set (bridge hasn't POSTed ack yet)
    with _app_module._upload_in_flight_lock:
        assert _app_module._upload_in_flight, (
            "_upload_in_flight was cleared prematurely by the rejected second request")


def test_concurrent_send_to_hardware_only_one_wins(boot_bin_path):
    """Concurrent send-to-hardware requests: exactly one succeeds (200) and
    the other is rejected (409).  Validates that the atomic check-and-set under
    _upload_in_flight_lock prevents both requests from passing the check and
    overwriting the single command-queue slot.
    """
    import threading

    results = []

    def _do_request():
        app.config['TESTING'] = True
        with app.test_client() as c:
            resp = c.post('/api/boot-image/send-to-hardware',
                          content_type='application/json', data='{}')
            results.append(resp.status_code)

    # Reset globals before concurrent run
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False

    threads = [threading.Thread(target=_do_request) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    ok_count  = results.count(200)
    err_count = results.count(409)
    assert ok_count == 1, (
        f"Expected exactly 1 success from concurrent sends, got {ok_count} "
        f"(statuses: {results})")
    assert err_count == len(results) - 1, (
        f"Expected {len(results)-1} rejections, got {err_count} "
        f"(statuses: {results})")

    # In-flight flag must be set by the winner
    with _app_module._upload_in_flight_lock:
        assert _app_module._upload_in_flight, (
            "_upload_in_flight should be True after a successful concurrent send")


def test_direct_u_cmd_sets_in_flight_flag(client):
    """Direct POST /hardware/wukong/command with cmd='u' establishes the same
    upload lifecycle as /api/boot-image/send-to-hardware.

    Without this, a caller that posts 'u' directly can later send s/r/h/b
    while the bridge is still transmitting DMEM bytes, writing command bytes
    as DMEM payload and silently corrupting the boot image.
    """
    with _app_module._upload_in_flight_lock:
        assert not _app_module._upload_in_flight

    resp = client.post('/hardware/wukong/command',
                       content_type='application/json',
                       data=json.dumps({'cmd': 'u', 'data': 'AAAA'}))
    assert resp.status_code == 200

    with _app_module._upload_in_flight_lock:
        assert _app_module._upload_in_flight, (
            "_upload_in_flight not set after direct 'u' command — "
            "execution commands would be accepted while bridge is transmitting")
