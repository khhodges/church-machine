"""
tests/server/test_wukong_status_readonly.py

Regression guard for Task: the /fpga page polls GET /hardware/wukong/status
every second.  That endpoint MUST remain strictly read-only:

  - it must NOT dequeue a pending command   (unlike GET /hardware/wukong/command)
  - it must NOT consume the upload-ack      (unlike GET /hardware/wukong/upload-ack)
  - it must NOT change server_seq, queue contents, call_depth, CR GTs,
    boot_info, or the upload_in_flight flag

If a future edit accidentally makes the status endpoint consume state, board
uploads and step/run commands from the IDE would start failing intermittently.

Also verifies bridge heartbeat ages behave sensibly:
  - bridge_poll_age / last_trace_age are null before first contact
  - they become small (fresh) immediately after bridge activity
  - bridge_connected reflects a recent bridge poll
"""

import json
import os
import sys
import time
import hashlib

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app

TARGET_DEVICE_UID = 'status-readonly-board'
TARGET_SESSION_ID = 'status-readonly-session'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_wukong_state():
    """Reset every in-process Wukong global between tests."""
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace   = {}
        _app_module._wukong_latest_cr_gts  = {}
        _app_module._wukong_event_queue[:] = []
        _app_module._wukong_event_seq      = 0
        _app_module._wukong_call_depth     = 0
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd  = None
        _app_module._wukong_cmd_delivery = None
        _app_module._wukong_cmd_id       = 0
    with _app_module._wukong_upload_ack_lock:
        _app_module._wukong_upload_ack = {}
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    with _app_module._wukong_boot_info_lock:
        _app_module._wukong_boot_info = {}
    with _app_module._wukong_bridge_lock:
        _app_module._wukong_bridge_info.clear()
    _app_module._wukong_last_bridge_poll = 0.0
    _app_module._wukong_last_trace_post  = 0.0


def _target():
    return {
        'target_device_uid': TARGET_DEVICE_UID,
        'target_session_id': TARGET_SESSION_ID,
    }


def _command(client, data):
    payload = dict(data)
    payload.update(_target())
    return client.post('/hardware/wukong/command', json=payload)


def _bridge_poll(client):
    return client.get('/hardware/wukong/command', headers={
        'X-Wukong-Session': TARGET_SESSION_ID,
        'X-Wukong-Device-UID': TARGET_DEVICE_UID,
    })


def _post_trace(client, ev_type=0x00, payload_gt=0, nia=0x10):
    return client.post(
        '/hardware/wukong/trace',
        data=json.dumps({
            'nia': nia, 'ev_type': ev_type, 'payload_gt': payload_gt,
            'flags': 0, 'fault_code': 0, 'fault_valid': False,
            'bp_hit': False, 'ts': time.time(),
        }),
        content_type='application/json',
    )


def _status(client):
    resp = client.get('/hardware/wukong/status')
    assert resp.status_code == 200
    return resp.get_json()


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset_wukong_state()
    with app.test_client() as c:
        established = c.post('/hardware/wukong/bridge-status', json={
            'device_uid': TARGET_DEVICE_UID,
            'session_id': TARGET_SESSION_ID,
            'state': 'connected',
        })
        assert established.status_code == 200
        yield c
    _reset_wukong_state()


# ---------------------------------------------------------------------------
# Tests — status endpoint never consumes state
# ---------------------------------------------------------------------------

class TestStatusDoesNotConsume:
    def test_pending_command_survives_repeated_status_polls(self, client):
        """GET /status many times must NOT dequeue the pending command."""
        r = _command(client, {'cmd': 's'})
        assert r.status_code == 200

        for _ in range(10):
            data = _status(client)
            assert data['pending_command'] == {
                'cmd': 's', 'id': 1,
                'device_uid': TARGET_DEVICE_UID,
                'bridge_session': TARGET_SESSION_ID,
                'target_device_uid': TARGET_DEVICE_UID,
            }, (
                'status poll consumed or altered the pending command'
            )

        # The bridge (GET /command) must still receive the command afterwards.
        cmd = _bridge_poll(client).get_json()
        assert cmd.get('cmd') == 's', (
            'pending command lost before the bridge could dequeue it'
        )
        assert cmd['target_device_uid'] == TARGET_DEVICE_UID
        assert cmd['bridge_session'] == TARGET_SESSION_ID

    def test_pending_upload_command_survives_and_data_not_leaked(self, client):
        """A queued 'u' upload command must survive status polls, and the
        status response must summarize (not embed) the base64 payload."""
        payload = 'QUJDREVGRw=='  # base64('ABCDEFG')
        artifact = b'ABCDEFG'
        r = _command(client, {
            'cmd': 'u', 'data': payload,
            'artifact_sha256': hashlib.sha256(artifact).hexdigest(),
            'artifact_size': len(artifact),
            'artifact_identity': 'status-readonly-upload',
        })
        assert r.status_code == 200

        for _ in range(5):
            data = _status(client)
            assert data['pending_command'] == {'cmd': 'u',
                                               'data_bytes': len(payload)}
            assert data['upload_in_flight'] is True

        cmd = _bridge_poll(client).get_json()
        assert cmd.get('cmd') == 'u'
        assert cmd.get('data') == payload, 'upload payload corrupted'
        assert cmd['target_device_uid'] == TARGET_DEVICE_UID
        assert cmd['bridge_session'] == TARGET_SESSION_ID

    def test_non_string_upload_data_rejected_and_status_stays_200(self, client):
        """POST 'u' with non-string data must be rejected (400), and even if a
        malformed pending command somehow exists, /status must stay a 200
        read-only snapshot (never a 500 TypeError)."""
        r = _command(client, {'cmd': 'u', 'data': 1})
        assert r.status_code == 400, 'non-string upload data must be rejected'

        # Belt-and-braces: seed a malformed pending command directly.
        with _app_module._wukong_command_lock:
            _app_module._wukong_pending_cmd = {'cmd': 'u', 'data': 12345}
        data = _status(client)
        assert data['pending_command'] == {'cmd': 'u', 'data_bytes': 0}
        # And the malformed command was not consumed by the status poll.
        with _app_module._wukong_command_lock:
            assert _app_module._wukong_pending_cmd == {'cmd': 'u', 'data': 12345}

    def test_upload_ack_survives_repeated_status_polls(self, client):
        """GET /status must NOT consume the upload-ack result."""
        artifact = b'ack-payload'
        digest = hashlib.sha256(artifact).hexdigest()
        queued = _command(client, {
            'cmd': 'u', 'data': 'YWNrLXBheWxvYWQ=',
            'artifact_sha256': digest,
            'artifact_size': len(artifact),
            'artifact_identity': 'status-readonly-ack',
        })
        assert queued.status_code == 200
        command_id = queued.get_json()['id']
        consumed = _bridge_poll(client).get_json()
        assert consumed['id'] == command_id
        assert consumed['target_device_uid'] == TARGET_DEVICE_UID
        assert consumed['bridge_session'] == TARGET_SESSION_ID
        acknowledged = client.post('/hardware/wukong/upload-ack', json={
            'id': command_id, 'ok': True,
            'target_device_uid': TARGET_DEVICE_UID,
            'session_id': TARGET_SESSION_ID,
            'artifact_sha256': digest,
            'artifact_size': len(artifact),
            'artifact_identity': 'status-readonly-ack',
        })
        assert acknowledged.status_code == 200

        for _ in range(10):
            _status(client)

        # The IDE's dedicated poll must still see (and consume) the ack.
        ack = client.get('/hardware/wukong/upload-ack').get_json()
        assert ack == {
            'ok': True, 'error': '', 'id': command_id,
            'target_device_uid': TARGET_DEVICE_UID,
            'session_id': TARGET_SESSION_ID,
            'artifact_sha256': digest,
            'artifact_size': len(artifact),
            'artifact_identity': 'status-readonly-ack',
        }, (
            'upload-ack was consumed by a status poll before the IDE saw it'
        )
        # And exactly once — the second dedicated GET consumes it.
        ack2 = client.get('/hardware/wukong/upload-ack').get_json()
        assert ack2 == {}

    def test_status_does_not_change_server_seq_or_queue(self, client):
        """server_seq, queue contents, call_depth, and CR GTs are unchanged
        by any number of status polls."""
        _post_trace(client, ev_type=0x06, payload_gt=0xCAFE0001)
        _post_trace(client, ev_type=0x08)
        _post_trace(client, ev_type=0x08)

        before = _status(client)
        with _app_module._wukong_trace_lock:
            queue_before = [dict(e) for e in _app_module._wukong_event_queue]

        for _ in range(10):
            _status(client)

        after = _status(client)
        with _app_module._wukong_trace_lock:
            queue_after = [dict(e) for e in _app_module._wukong_event_queue]

        assert after['server_seq'] == before['server_seq'] == 3
        assert after['queue_len']  == before['queue_len']  == 3
        assert after['call_depth'] == before['call_depth'] == 2
        assert after['cr6_gt']     == 0xCAFE0001
        assert queue_after == queue_before, 'status poll mutated the event queue'

        # The IDE's event drain must still see all 3 events.
        events = client.get('/hardware/wukong/events?after=0').get_json()
        assert len(events['events']) == 3

    def test_status_does_not_clear_upload_in_flight(self, client):
        """Status polls must not clear the upload-in-flight flag; execution
        commands must still be rejected (409) afterwards."""
        with _app_module._upload_in_flight_lock:
            _app_module._upload_in_flight = True

        for _ in range(5):
            assert _status(client)['upload_in_flight'] is True

        r = _command(client, {'cmd': 's'})
        assert r.status_code == 409, (
            'execution command accepted mid-upload after status polls — '
            'status endpoint must not clear _upload_in_flight'
        )

    def test_status_does_not_touch_boot_info(self, client):
        with _app_module._wukong_boot_info_lock:
            _app_module._wukong_boot_info = {'stale_tu': False, 'tu_version': 3}

        for _ in range(5):
            data = _status(client)
            assert data['boot_info'] == {'stale_tu': False, 'tu_version': 3}

        with _app_module._wukong_boot_info_lock:
            assert _app_module._wukong_boot_info == {'stale_tu': False,
                                                     'tu_version': 3}

    def test_status_does_not_update_bridge_heartbeat(self, client):
        """GET /status must NOT count as bridge contact — only the bridge's
        own GET /command and POST /trace update the heartbeats."""
        for _ in range(5):
            data = _status(client)
        assert data['bridge_poll_age'] is None
        assert data['last_trace_age'] is None
        assert data['bridge_connected'] is False


# ---------------------------------------------------------------------------
# Tests — heartbeat ages
# ---------------------------------------------------------------------------

class TestHeartbeatAges:
    def test_ages_null_before_first_contact(self, client):
        data = _status(client)
        assert data['bridge_poll_age'] is None
        assert data['last_trace_age'] is None
        assert data['bridge_connected'] is False

    def test_bridge_poll_age_fresh_after_command_get(self, client):
        _bridge_poll(client)
        data = _status(client)
        assert data['bridge_poll_age'] is not None
        assert 0 <= data['bridge_poll_age'] < 3.0
        assert data['bridge_connected'] is True
        # Trace age still null — no trace posted yet.
        assert data['last_trace_age'] is None

    def test_last_trace_age_fresh_after_trace_post(self, client):
        _post_trace(client)
        data = _status(client)
        assert data['last_trace_age'] is not None
        assert 0 <= data['last_trace_age'] < 3.0

    def test_ages_decrease_on_new_activity(self, client):
        """Ages reset (decrease) when the bridge shows fresh activity."""
        # Simulate an old poll/trace 100 s ago.
        past = time.time() - 100.0
        _app_module._wukong_last_bridge_poll = past
        _app_module._wukong_last_trace_post  = past

        stale = _status(client)
        assert stale['bridge_poll_age'] > 90
        assert stale['last_trace_age'] > 90
        assert stale['bridge_connected'] is False

        _bridge_poll(client)  # fresh bridge poll
        _post_trace(client)                     # fresh trace

        fresh = _status(client)
        assert fresh['bridge_poll_age'] < stale['bridge_poll_age']
        assert fresh['last_trace_age'] < stale['last_trace_age']
        assert fresh['bridge_connected'] is True

    def test_ages_grow_between_polls(self, client):
        """With no new bridge activity, the reported age increases."""
        _bridge_poll(client)
        a1 = _status(client)['bridge_poll_age']
        time.sleep(0.05)
        a2 = _status(client)['bridge_poll_age']
        assert a2 > a1
