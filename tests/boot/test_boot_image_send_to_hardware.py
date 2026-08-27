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
from server.boot_image import (
    generate_boot_image,
    build_wukong_upload_image,
    NS_ENTRY_WORDS,
    create_gt,
    WUKONG_DMEM_WORDS,
    WUKONG_UPLOAD_BODY_BASE_WORD,
)

LUMPS_DIR = os.path.join(ROOT, 'server', 'lumps')


# ── Module-scoped snapshot/restore ───────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    The boot_bin_path per-test fixture manually backs up and restores
    server/lumps/boot-image.bin, but only for the tests that request it.
    A mid-suite failure or exception in fixture teardown could leave the
    directory in an unexpected state.  This module-scoped autouse fixture
    holds the cross-process lumps_write_lock for the entire snapshot → tests →
    restore span and guarantees full restoration even on unexpected failures.
    """
    from tests.boot.conftest import lumps_write_lock
    import shutil as _shutil

    with lumps_write_lock():
        snap_dir = str(tmp_path_factory.mktemp("lumps_snapshot"))
        entries = {}
        for name in os.listdir(LUMPS_DIR):
            p = os.path.join(LUMPS_DIR, name)
            if os.path.islink(p):
                entries[name] = ("link", os.readlink(p))
            elif os.path.isfile(p):
                dst = os.path.join(snap_dir, name)
                _shutil.copy2(p, dst)
                entries[name] = ("file", dst)

        yield

        # 1. Remove anything created during the module.
        for name in os.listdir(LUMPS_DIR):
            if name not in entries:
                p = os.path.join(LUMPS_DIR, name)
                if os.path.islink(p) or os.path.isfile(p):
                    os.remove(p)

        # 2. Restore originals (content, symlink targets, deleted files).
        for name, (kind, val) in entries.items():
            p = os.path.join(LUMPS_DIR, name)
            if kind == "link":
                current = os.readlink(p) if os.path.islink(p) else None
                if current != val:
                    if os.path.islink(p) or os.path.exists(p):
                        os.remove(p)
                    os.symlink(val, p)
            else:
                with open(val, "rb") as fh:
                    original = fh.read()
                if os.path.islink(p):
                    os.remove(p)
                needs_write = True
                if os.path.isfile(p):
                    with open(p, "rb") as fh:
                        needs_write = fh.read() != original
                if needs_write:
                    with open(p, "wb") as fh:
                        fh.write(original)


def _valid_image(entry_slot=None):
    """A real, valid boot image — the send-to-hardware residency/caps gate
    now rejects malformed placeholder blobs, so tests must use the genuine
    generator output."""
    cfg = {"step1": {"totalNamespaceWords": 16384,
                     "namespaceLumpWords": 1024,
                     "threadLumpWords": 256}}
    return generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=entry_slot)


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
        _app_module._wukong_cmd_delivery = None
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    with _app_module._wukong_hw_entry_lock:
        _app_module._wukong_hw_entry_slot = None
        _app_module._wukong_pending_entry_slot = None
    yield
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
        _app_module._wukong_cmd_delivery = None
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    with _app_module._wukong_hw_entry_lock:
        _app_module._wukong_hw_entry_slot = None
        _app_module._wukong_pending_entry_slot = None


@pytest.fixture
def boot_bin_path(tmp_path, monkeypatch):
    """Temporarily replace server/lumps/boot-image.bin with a valid test image.

    Must be a REAL generated image: send-to-hardware now runs a residency /
    caps[0] gate (read_boot_entry_info) and rejects malformed blobs with 400.
    """
    lumps_dir = LUMPS_DIR
    os.makedirs(lumps_dir, exist_ok=True)
    bin_path = os.path.join(lumps_dir, 'boot-image.bin')

    payload = _valid_image()

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
    # The handler reads its configured LUMPS_DIR, which boot tests redirect to
    # private storage. Point that exact dependency at an empty temporary dir.
    fake_lumps_dir = str(tmp_path / 'lumps')
    monkeypatch.setattr(_app_module, 'LUMPS_DIR', fake_lumps_dir)

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
    assert cmd_data.get('reboot') is True


def test_send_to_hardware_base64_payload_decodes_correctly(client, boot_bin_path):
    """The queued data is the expected native Wukong projection, not the
    generic simulator image stored in boot-image.bin."""
    _, original_payload = boot_bin_path

    client.post('/api/boot-image/send-to-hardware',
                content_type='application/json', data='{}')

    poll = client.get('/hardware/wukong/command')
    cmd_data = json.loads(poll.data)
    decoded = base64.b64decode(cmd_data['data'])
    expected, info = build_wukong_upload_image(original_payload)
    assert decoded == expected
    assert len(decoded) == WUKONG_DMEM_WORDS * 4
    assert decoded != original_payload
    words = struct.unpack(f'<{WUKONG_DMEM_WORDS}I', decoded)
    assert words[info['entry_slot'] * NS_ENTRY_WORDS] == WUKONG_UPLOAD_BODY_BASE_WORD * 4


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

def test_server_queues_native_wukong_le_image():
    """The server projects the generic image onto Wukong's forward 16K DMEM
    layout, then queues that new image as little-endian words for the bridge."""
    import base64, struct
    # A real generated image (LE words on disk) — the upload gate rejects
    # arbitrary placeholder bytes, so the contract is checked with genuine
    # generator output.
    le_bytes = _valid_image()
    n_all = len(le_bytes) // 4
    words = list(struct.unpack(f'<{n_all}I', le_bytes))

    lumps_dir = LUMPS_DIR
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

        # The server must project the generic tail-table image before encoding.
        expected, info = build_wukong_upload_image(le_bytes)
        assert decoded == expected
        assert decoded != le_bytes
        assert len(decoded) == WUKONG_DMEM_WORDS * 4
        assert cmd_data.get('reboot') is True
        assert info['entry_loc'] == WUKONG_UPLOAD_BODY_BASE_WORD

        # Bridge formula: byte-swap each LE word to BE before UART transmission.
        n = len(decoded) // 4
        be_wire  = struct.pack(f'>{n}I', *struct.unpack(f'<{n}I', decoded[:n * 4]))
        recovered = list(struct.unpack(f'>{n}I', be_wire))
        expected_words = list(struct.unpack(f'<{n}I', expected))
        assert recovered == expected_words, (
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


# ── Boot-entry gate + hardware entry-slot tracking ────────────────────────────

def _install_boot_bin(payload):
    """Write payload to server/lumps/boot-image.bin; returns (path, old_data)."""
    lumps_dir = LUMPS_DIR
    os.makedirs(lumps_dir, exist_ok=True)
    bin_path = os.path.join(lumps_dir, 'boot-image.bin')
    old_data = open(bin_path, 'rb').read() if os.path.exists(bin_path) else None
    with open(bin_path, 'wb') as fh:
        fh.write(payload)
    return bin_path, old_data


def _restore_boot_bin(bin_path, old_data):
    if old_data is not None:
        with open(bin_path, 'wb') as fh:
            fh.write(old_data)
    elif os.path.exists(bin_path):
        os.remove(bin_path)


def test_send_to_hardware_rejects_non_resident_entry(client):
    """An image whose entry lump body is not resident (entry slot 2 = MMIO
    UART_DEV, no code) is rejected with 400 before reaching the bridge."""
    payload = _valid_image(entry_slot=2)   # simulator-legal, hardware-fatal
    p, old = _install_boot_bin(payload)
    try:
        resp = client.post('/api/boot-image/send-to-hardware',
                           content_type='application/json', data='{}')
        assert resp.status_code == 400, (
            f"Expected 400 for non-resident entry image, got {resp.status_code}")
        body = json.loads(resp.data)
        assert 'not resident' in body.get('error', '')
        # Nothing queued, in-flight rolled back, no pending entry slot.
        with _app_module._wukong_command_lock:
            assert _app_module._wukong_pending_cmd is None
        with _app_module._upload_in_flight_lock:
            assert not _app_module._upload_in_flight
        with _app_module._wukong_hw_entry_lock:
            assert _app_module._wukong_pending_entry_slot is None
    finally:
        _restore_boot_bin(p, old)


def test_send_to_hardware_rejects_mismatched_caps0(client):
    """An image whose Thread.caps[0] GT points at a different slot than the
    stored entry slot would silently boot the wrong lump — rejected 400."""
    payload = bytearray(_valid_image(entry_slot=7))
    n = len(payload) // 4
    words = list(struct.unpack(f'<{n}I', payload))
    thread_loc = words[n - 2 * NS_ENTRY_WORDS]           # NS slot 1 word0
    caps0_idx = thread_loc + 244
    wrong_gt = create_gt(0, 6, {"E": 1}, 1)              # slot 6, not 7
    struct.pack_into('<I', payload, caps0_idx * 4, wrong_gt)
    p, old = _install_boot_bin(bytes(payload))
    try:
        resp = client.post('/api/boot-image/send-to-hardware',
                           content_type='application/json', data='{}')
        assert resp.status_code == 400, (
            f"Expected 400 for mismatched Thread.caps[0], got {resp.status_code}")
        assert 'Thread.caps[0]' in json.loads(resp.data).get('error', '')
        with _app_module._upload_in_flight_lock:
            assert not _app_module._upload_in_flight
    finally:
        _restore_boot_bin(p, old)


def test_send_to_hardware_rejects_multithread_without_board_scheduler(client):
    """A board upload must not promise unavailable Thread#2+ scheduling."""
    cfg = {"step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 1024,
        "threadLumpWords": 256,
        "threadCount": 2,
    }}
    payload = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=10,
                                  require_entry_resident=True)
    p, old = _install_boot_bin(payload)
    try:
        response = client.post('/api/boot-image/send-to-hardware',
                               content_type='application/json', data='{}')
        assert response.status_code == 400
        body = json.loads(response.data)
        assert body["thread_count"] == 2
        assert "no physical scheduler" in body["error"]
        with _app_module._wukong_command_lock:
            assert _app_module._wukong_pending_cmd is None
        with _app_module._upload_in_flight_lock:
            assert not _app_module._upload_in_flight
    finally:
        _restore_boot_bin(p, old)


def test_hw_entry_slot_committed_only_after_ok_ack(client):
    """hw_entry_slot stays at the power-on default (7) until the bridge ACKs
    the upload ok, then reflects the uploaded image's entry slot."""
    payload = _valid_image(entry_slot=6)
    p, old = _install_boot_bin(payload)
    try:
        # Before any upload: power-on default.
        st = json.loads(client.get('/hardware/wukong/status').data)
        assert st['hw_entry_slot'] == 7
        assert st['hw_entry_source'] == 'power-on'

        resp = client.post('/api/boot-image/send-to-hardware',
                           content_type='application/json', data='{}')
        assert resp.status_code == 200
        assert json.loads(resp.data).get('entry_slot') == 6

        # Pending slot recorded BEFORE the command became observable.
        with _app_module._wukong_hw_entry_lock:
            assert _app_module._wukong_pending_entry_slot == 6

        # Queued but not ACKed: still power-on.
        st = json.loads(client.get('/hardware/wukong/status').data)
        assert st['hw_entry_slot'] == 7

        # Bridge ACKs ok → committed.
        client.post('/hardware/wukong/upload-ack',
                    content_type='application/json',
                    data=json.dumps({'ok': True}))
        st = json.loads(client.get('/hardware/wukong/status').data)
        assert st['hw_entry_slot'] == 6
        assert st['hw_entry_source'] == 'upload'
        with _app_module._wukong_hw_entry_lock:
            assert _app_module._wukong_pending_entry_slot is None
    finally:
        _restore_boot_bin(p, old)


def test_hw_entry_slot_not_committed_on_failed_ack(client):
    """A failed upload ACK must NOT change the reported hardware entry slot."""
    payload = _valid_image(entry_slot=6)
    p, old = _install_boot_bin(payload)
    try:
        resp = client.post('/api/boot-image/send-to-hardware',
                           content_type='application/json', data='{}')
        assert resp.status_code == 200

        client.post('/hardware/wukong/upload-ack',
                    content_type='application/json',
                    data=json.dumps({'ok': False, 'error': 'board ACK timeout'}))

        st = json.loads(client.get('/hardware/wukong/status').data)
        assert st['hw_entry_slot'] == 7, (
            "failed upload must leave the power-on entry slot in place")
        assert st['hw_entry_source'] == 'power-on'
        with _app_module._wukong_hw_entry_lock:
            assert _app_module._wukong_pending_entry_slot is None, (
                "pending entry slot must be cleared by any ACK")
    finally:
        _restore_boot_bin(p, old)


def test_fast_bridge_ack_before_send_returns_still_commits(client):
    """Ordering regression guard: the pending entry slot is recorded before
    the 'u' command is observable, so an ACK arriving immediately after the
    bridge consumes the command commits the correct slot."""
    payload = _valid_image(entry_slot=6)
    p, old = _install_boot_bin(payload)
    try:
        resp = client.post('/api/boot-image/send-to-hardware',
                           content_type='application/json', data='{}')
        assert resp.status_code == 200
        # Simulate the fast bridge: consume command, ACK immediately.
        client.get('/hardware/wukong/command')
        client.post('/hardware/wukong/upload-ack',
                    content_type='application/json',
                    data=json.dumps({'ok': True}))
        st = json.loads(client.get('/hardware/wukong/status').data)
        assert st['hw_entry_slot'] == 6
        assert st['hw_entry_source'] == 'upload'
    finally:
        _restore_boot_bin(p, old)
