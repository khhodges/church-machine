"""
tests/server/test_wukong_command_delivery.py

Task 2491 regression guard: Reboot ('f') command delivery must be observable
and reliable.  Covers the full queue → consume → ack lifecycle exposed via
GET /hardware/wukong/status, plus the documented overwrite behavior:

  - POST /hardware/wukong/command records a delivery lifecycle entry
    (id, cmd, queued_ts, consumed_ts, write_ok, write_error, write_ts)
    keyed by a server-generated monotonic command ID
  - GET  /hardware/wukong/command (bridge dequeue) stamps consumed_ts
  - POST /hardware/wukong/command-ack (bridge write result) stamps
    write_ok / write_error / write_ts
  - a new POST overwrites a still-pending command and SURFACES the overwrite
    in the response as {'overwrote': '<prev cmd>'} (never a silent loss)
  - status polling never mutates the delivery record
"""

import json
import os
import sys
import time

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


def _reset_state():
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace = {}
        _app_module._wukong_latest_snapshot = {}
        _app_module._wukong_event_queue.clear()
        _app_module._wukong_fault_incidents.clear()
        _app_module._wukong_fault_candidate = {
            'state': 'unavailable', 'decision': 'missing_trace',
            'incident_id': '',
        }
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
        _app_module._wukong_cmd_delivery = None
        _app_module._wukong_cmd_id = 0
        _app_module._wukong_run_unlocked = True
        _app_module._wukong_step_write_trace_seq = None
        _app_module._wukong_step_bridge_session = ''
        _app_module._wukong_bridge_trace_highwater.clear()
        _app_module._wukong_skip_pending = None
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    with _app_module._wukong_boot_info_lock:
        _app_module._wukong_boot_info = {}
    _app_module._wukong_last_bridge_poll = 0.0
    _app_module._wukong_total_bridge_polls = 0
    _app_module._wukong_bridge_incident_counter = 0
    _app_module._wukong_bridge_alert = {
        'active': False, 'incident_id': '', 'kind': '',
        'title': '', 'message': '', 'action': '',
        'started_ts': None, 'updated_ts': None, 'dismissed': False,
    }
    # Clear bridge timeline so absence assertions are deterministic across tests.
    with _app_module._wukong_bridge_lock:
        _app_module._wukong_bridge_timeline.clear()
        _app_module._wukong_bridge_info.clear()


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset_state()
    with app.test_client() as c:
        yield c
    _reset_state()


def _post_cmd(client, cmd, **extra):
    body = {'cmd': cmd}
    body.update(extra)
    return client.post('/hardware/wukong/command',
                       data=json.dumps(body), content_type='application/json')


def _status(client):
    r = client.get('/hardware/wukong/status')
    assert r.status_code == 200
    return r.get_json()


def _ack(client, cmd, cmd_id, ok, error='', session_id='', trace_counter=None,
         state_counter=None):
    body = {'cmd': cmd, 'id': cmd_id, 'ok': ok}
    if error:
        body['error'] = error
    if session_id:
        body['session_id'] = session_id
    if trace_counter is not None:
        body['trace_counter'] = trace_counter
    if state_counter is not None:
        body['state_counter'] = state_counter
    return client.post('/hardware/wukong/command-ack',
                       data=json.dumps(body), content_type='application/json')


def _trace(client, session_id, counter):
    return client.post('/hardware/wukong/trace', data=json.dumps({
        'nia': 0x140, 'ev_type': 0, 'payload_gt': 0, 'flags': 0,
        'fault_code': 0, 'fault_valid': False, 'bp_hit': False,
        'ts': time.time(), 'bridge_session': session_id,
        'bridge_trace_counter': counter,
    }), content_type='application/json')


def _bridge_status(client, **body):
    return client.post('/hardware/wukong/bridge-status',
                       data=json.dumps(body), content_type='application/json')


def _halt_state(client, command_id, session='bridge-a',
                write_counter=4, board_counter=5, automatic=False,
                halt_nonce=9):
    token = os.environ.get('REPORT_TOKEN', '')
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    return client.post('/hardware/wukong/halt-state', data=json.dumps({
        'state': 'halted',
        'reason': 'explicit_halt',
        'command_id': command_id,
        'automatic': automatic,
        'session_id': session,
        'state_counter_at_write': write_counter,
        'board_state_counter': board_counter,
        'halt_nonce': halt_nonce,
    }), content_type='application/json', headers=headers)


class TestQueueConsumeAckLifecycle:
    def test_halt_write_is_requested_until_board_evidence_arrives(self, client):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _ack(client, 'h', qid, True, session_id='bridge-a')
        status = _status(client)
        assert status['halt']['state'] == 'halt requested'
        assert status['command_delivery']['board_halt_confirmed'] is False

    def test_matching_board_halt_evidence_confirms_exact_command(self, client):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _ack(client, 'h', qid, True, session_id='bridge-a',
             trace_counter=9)
        # State counter is independently captured at the serial write.
        client.post('/hardware/wukong/command-ack', data=json.dumps({
            'cmd': 'h', 'id': qid, 'ok': True, 'session_id': 'bridge-a',
            'trace_counter': 9, 'state_counter': 4,
            'halt_nonce': 9,
        }), content_type='application/json')
        response = _halt_state(client, qid)
        assert response.status_code == 200
        status = _status(client)
        assert status['halt']['state'] == 'halt confirmed'
        assert status['command_delivery']['board_state_counter'] == 5

    def test_stale_or_wrong_session_halt_evidence_is_rejected(self, client):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        client.post('/hardware/wukong/command-ack', data=json.dumps({
            'cmd': 'h', 'id': qid, 'ok': True, 'session_id': 'bridge-a',
            'state_counter': 4,
            'halt_nonce': 9,
        }), content_type='application/json')
        assert _halt_state(client, qid, session='bridge-b').status_code == 409
        assert _halt_state(client, qid, board_counter=4).status_code == 409
        assert _halt_state(client, qid, halt_nonce=8).status_code == 409
        assert _status(client)['halt']['state'] == 'halt requested'

    def test_halt_timeout_and_reconnect_remain_unconfirmed(self, client, monkeypatch):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        client.post('/hardware/wukong/command-ack', data=json.dumps({
            'cmd': 'h', 'id': qid, 'ok': True, 'session_id': 'bridge-a',
            'state_counter': 4,
            'halt_nonce': 9,
        }), content_type='application/json')
        with _app_module._wukong_command_lock:
            _app_module._wukong_cmd_delivery['write_ts'] = (
                time.time() - _app_module._WUKONG_HALT_CONFIRM_TIMEOUT - 1)
        assert _status(client)['halt']['state'] == 'halt confirmation timed out'
        _bridge_status(client, session_id='bridge-a', event='reconnect_attempt',
                       state='reconnecting', reason='USB disconnected')
        assert _status(client)['halt']['state'] == 'halt confirmation unavailable'

    def test_execution_command_cannot_overtake_pending_halt_evidence(self, client):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        client.post('/hardware/wukong/command-ack', data=json.dumps({
            'cmd': 'h', 'id': qid, 'ok': True, 'session_id': 'bridge-a',
            'state_counter': 4,
            'halt_nonce': 9,
        }), content_type='application/json')
        blocked = _post_cmd(client, 's')
        assert blocked.status_code == 409
        assert blocked.get_json()['blocked_stage'] == 'awaiting_board_evidence'

    def test_new_command_is_allowed_after_halt_confirmation_timeout(self, client):
        qid = _post_cmd(client, 'h').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        client.post('/hardware/wukong/command-ack', data=json.dumps({
            'cmd': 'h', 'id': qid, 'ok': True, 'session_id': 'bridge-a',
            'state_counter': 4,
        }), content_type='application/json')
        with _app_module._wukong_command_lock:
            _app_module._wukong_cmd_delivery['write_ts'] = (
                time.time() - _app_module._WUKONG_HALT_CONFIRM_TIMEOUT - 1)
        assert _post_cmd(client, 's').status_code == 200

    def test_queue_records_delivery_entry(self, client):
        t0 = time.time()
        r = _post_cmd(client, 'f')
        assert r.status_code == 200
        cmd_id = r.get_json()['id']
        d = _status(client)['command_delivery']
        assert d['cmd'] == 'f'
        assert d['id'] == cmd_id
        assert d['queued_ts'] >= t0 - 1
        assert d['consumed_ts'] is None
        assert d['write_ok'] is None
        assert d['write_error'] == ''
        assert d['write_ts'] is None

    def test_bridge_get_stamps_consumed_ts(self, client):
        qid = _post_cmd(client, 'f').get_json()['id']
        got = client.get('/hardware/wukong/command').get_json()
        assert got.get('cmd') == 'f'
        assert got.get('id') == qid, 'bridge must receive the command id on dequeue'
        d = _status(client)['command_delivery']
        assert d['consumed_ts'] is not None
        assert d['write_ok'] is None, 'write result must not be implied by consumption'

    def test_command_ack_success(self, client):
        qid = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')
        r = _ack(client, 'f', qid, True)
        assert r.status_code == 200
        d = _status(client)['command_delivery']
        assert d['write_ok'] is True
        assert d['write_error'] == ''
        assert d['write_ts'] is not None

    def test_command_ack_failure_carries_error(self, client):
        qid = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')
        _ack(client, 'f', qid, False, 'serial write failed: port dead')
        d = _status(client)['command_delivery']
        assert d['write_ok'] is False
        assert d['write_error'] == 'serial write failed: port dead'
        assert d['write_ts'] is not None

    def test_stale_ack_for_superseded_command_ignored(self, client):
        """An ack for a command that has been superseded must not corrupt
        the delivery record of the newer command."""
        sid = _post_cmd(client, 's').get_json()['id']
        _post_cmd(client, 'f')          # supersedes 's'
        client.get('/hardware/wukong/command')      # consume 'f'
        _ack(client, 's', sid, False, 'late ack')
        d = _status(client)['command_delivery']
        assert d['cmd'] == 'f'
        assert d['write_ok'] is None
        assert d['write_error'] == ''

    def test_same_letter_late_ack_race_ignored(self, client):
        """f -> consume -> write_ok -> new f queued -> late stale ack for the
        FIRST f must not mark the second f as written."""
        id1 = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')       # bridge consumes first f
        # Confirm the first write so the slot is no longer in-flight.
        _ack(client, 'f', id1, True)
        assert _status(client)['command_delivery']['write_ok'] is True
        # Only now is a new command accepted (write confirmed, slot free).
        id2 = _post_cmd(client, 'f').get_json()['id']
        assert id2 != id1
        # A stale ACK with id1 must be ignored once id2 owns the slot.
        client.get('/hardware/wukong/command')
        _ack(client, 'f', id1, True)                 # late ack for first f
        d = _status(client)['command_delivery']
        assert d['id'] == id2
        assert d['write_ok'] is None, 'late same-letter ack corrupted new record'
        # After the second f is consumed, its own ack applies normally.
        _ack(client, 'f', id2, True)
        d = _status(client)['command_delivery']
        assert d['id'] == id2 and d['write_ok'] is True

    def test_ack_before_consume_ignored(self, client):
        """An ack must be ignored while the command is still queued — a write
        cannot have happened before the bridge dequeued the command."""
        qid = _post_cmd(client, 'f').get_json()['id']
        _ack(client, 'f', qid, True)
        d = _status(client)['command_delivery']
        assert d['consumed_ts'] is None
        assert d['write_ok'] is None, 'ack accepted before consumption'

    def test_ack_without_id_ignored(self, client):
        qid = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')
        client.post('/hardware/wukong/command-ack',
                    data=json.dumps({'cmd': 'f', 'ok': True}),
                    content_type='application/json')
        assert _status(client)['command_delivery']['write_ok'] is None
        _ack(client, 'f', qid, True)   # correct id still works afterwards
        assert _status(client)['command_delivery']['write_ok'] is True

    def test_write_ts_after_sentinel_received_ts_ordering(self, client, monkeypatch):
        """Sentinel confirmation is bound to write_ts: a boot-info received
        BEFORE the write ack must have received_ts < write_ts so the UI can
        reject a pre-existing sentinel as proof of reboot."""
        monkeypatch.setenv('REPORT_TOKEN', 'bridge-report-secret')
        _app_module._wukong_bridge_info['session_id'] = 'test-session'
        response = client.post(
            '/hardware/wukong/boot-info',
            data=json.dumps({'stale_tu': False, 'tu_version': 3,
                             'build_version': 7,
                             'startup_state': 'awaiting_first_step',
                             'session_id': 'test-session'}),
            headers={'Authorization': 'Bearer bridge-report-secret'},
            content_type='application/json')
        assert response.status_code == 200
        old_ts = _status(client)['boot_info']['received_ts']
        qid = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')
        time.sleep(0.01)
        _ack(client, 'f', qid, True)
        d = _status(client)['command_delivery']
        assert d['write_ts'] > old_ts, (
            'pre-existing sentinel must be older than the write ack')

    def test_status_polls_never_mutate_delivery(self, client):
        _post_cmd(client, 'f')
        first = _status(client)['command_delivery']
        for _ in range(10):
            _status(client)
        assert _status(client)['command_delivery'] == first
        # And the command is still dequeueable by the bridge.
        assert client.get('/hardware/wukong/command').get_json().get('cmd') == 'f'

    def test_no_delivery_record_before_first_command(self, client):
        assert _status(client)['command_delivery'] is None

    def test_delayed_consumption_is_not_delivery(self, client):
        """Polling status while the bridge is disconnected leaves reboot pending."""
        queued = _post_cmd(client, 'f').get_json()
        d = _status(client)
        assert d['command_delivery']['id'] == queued['id']
        assert d['command_delivery']['consumed_ts'] is None
        assert d['command_delivery']['write_ok'] is None
        assert d['halt']['state'] == 'reboot pending'
        assert 'not proven written' in d['halt']['reason']

    def test_old_bridge_without_write_ack_stays_pending(self, client):
        """Legacy bridges dequeue commands but cannot prove UART delivery."""
        queued = _post_cmd(client, 'f').get_json()
        got = client.get('/hardware/wukong/command').get_json()
        assert got['id'] == queued['id']
        d = _status(client)
        assert d['command_delivery']['consumed_ts'] is not None
        assert d['command_delivery']['write_ok'] is None
        assert d['halt']['state'] == 'reboot pending'


class TestOverwriteBehavior:
    def test_overwrite_surfaced_in_response(self, client):
        """Documented policy: a new POST overwrites a pending command and the
        response surfaces the overwrite (no silent loss, no 409)."""
        r1 = _post_cmd(client, 'f')
        assert 'overwrote' not in r1.get_json()
        r2 = _post_cmd(client, 's')
        body = r2.get_json()
        assert r2.status_code == 200
        assert body['ok'] is True
        assert body['overwrote'] == 'f'
        assert body['id'] > r1.get_json()['id'], 'ids must be monotonic'
        # New command wins the single slot; delivery record follows it.
        assert _status(client)['command_delivery']['cmd'] == 's'
        assert client.get('/hardware/wukong/command').get_json().get('cmd') == 's'


class TestBridgeDisconnectDiagnostics:
    def test_network_and_serial_reconnect_events_keep_session_timestamps(self, client):
        session = 'bridge-session-a'
        assert _bridge_status(
            client, session_id=session, serial_port='/dev/ttyUSB0',
            event='poll_failed', state='network_error',
            reason='HTTPS poll disconnected').status_code == 200
        assert _bridge_status(
            client, session_id=session, serial_port='/dev/ttyUSB1',
            event='reconnect_attempt', state='reconnecting',
            reason='USB port renumbered', reconnect_attempt=2).status_code == 200
        status = _status(client)
        assert status['bridge']['session_id'] == session
        assert status['bridge']['state'] == 'reconnecting'
        timeline = status['bridge_timeline']
        assert len(timeline) >= 2
        assert [event['session_id'] for event in timeline[-2:]] == [session, session]
        assert all(isinstance(event['ts'], (int, float)) for event in timeline[-2:])
        assert timeline[-1]['serial_port'] == '/dev/ttyUSB1'
        assert timeline[-1]['reconnect_attempt'] == 2

    def test_timeline_is_bounded_without_losing_latest_actionable_event(self, client):
        for i in range(_app_module._WUKONG_BRIDGE_TIMELINE_MAXLEN + 20):
            _bridge_status(client, session_id=f's-{i}', event='heartbeat',
                           state='connected', serial_port=f'USB{i}')
        timeline = _status(client)['bridge_timeline']
        assert len(timeline) == 32  # status intentionally exposes latest 32
        assert timeline[0]['session_id'] == f's-{_app_module._WUKONG_BRIDGE_TIMELINE_MAXLEN + 20 - 32}'
        assert timeline[-1]['session_id'] == 's-147'

    def test_transport_diagnostics_stay_out_of_execution_event_queue(self, client):
        _bridge_status(client, session_id='bridge-session-a',
                       event='http_error', state='network_error',
                       reason='temporary HTTPS timeout')
        _bridge_status(client, session_id='bridge-session-a',
                       event='reconnect_attempt', state='reconnecting',
                       reason='waiting for serial port', reconnect_attempt=1)
        _bridge_status(client, session_id='bridge-session-a',
                       event='reconnected', state='connected',
                       reason='serial port available')
        events = client.get('/hardware/wukong/events?after=0').get_json()['events']
        assert not any(e.get('event') in (
            'http_error', 'reconnect_attempt', 'reconnected'
        )
                       for e in events)
        timeline = _status(client)['bridge_timeline']
        assert [e['event'] for e in timeline[-3:]] == [
            'http_error', 'reconnect_attempt', 'reconnected'
        ]

    def test_sustained_bridge_loss_alerts_once_and_resets_after_recovery(self, client):
        _bridge_status(client, session_id='bridge-session-a',
                       event='session_started', state='connected')
        client.get('/hardware/wukong/command')
        _app_module._wukong_last_bridge_poll = time.time() - 6
        with _app_module._wukong_bridge_lock:
            _app_module._wukong_bridge_info['updated_ts'] = time.time() - 6
        first = _status(client)['bridge_alert']
        second = _status(client)['bridge_alert']
        assert first['active'] is True
        assert first['kind'] == 'bridge_unreachable'
        assert first['incident_id'] == second['incident_id']
        assert second['active'] is True
        client.get('/hardware/wukong/command')
        recovered = _status(client)['bridge_alert']
        assert recovered['active'] is False
        _app_module._wukong_last_bridge_poll = time.time() - 6
        later = _status(client)['bridge_alert']
        assert later['active'] is True
        assert later['incident_id'] != first['incident_id']

    def test_terminal_serial_reconnect_failure_is_actionable(self, client):
        _bridge_status(client, session_id='bridge-session-a',
                       event='reconnect_failed', state='serial_error',
                       reason='could not reopen serial port after 15 attempts',
                       reconnect_attempt=15)
        alert = _status(client)['bridge_alert']
        assert alert['active'] is True
        assert alert['kind'] == 'serial_reconnect_failed'
        assert 'USB-UART' in alert['action']
        _bridge_status(client, session_id='bridge-session-a',
                       event='serial_read_error', state='serial_error',
                       reason='dead port read failed again')
        still_terminal = _status(client)['bridge_alert']
        assert still_terminal['incident_id'] == alert['incident_id']
        assert still_terminal['kind'] == 'serial_reconnect_failed'

    def test_no_overwrite_flag_after_consumption(self, client):
        _post_cmd(client, 'f')
        client.get('/hardware/wukong/command')   # bridge consumed it
        # After consumption but before write confirmation, the slot is locked.
        r = _post_cmd(client, 's')
        assert r.status_code == 409


class TestInFlightWriteGuard:
    """Regression guard: a command consumed by the bridge but not yet write-
    confirmed must not be silently replaced by a subsequent POST.

    The 'STEP superseded' trace pattern occurs when:
      1. Bridge consumes a STEP command (GET stamps consumed_ts)
      2. Bridge is slow writing to serial (>8 s in observed trace)
      3. User re-clicks STEP before write_ok arrives
      4. Old delivery-tracking ID is replaced → old ACK rejected → step lost

    Fix: server returns 409 while write_ts is None but consumed_ts is set.
    """

    def test_consumed_not_confirmed_rejects_new_command(self, client):
        """A command the bridge has consumed but not yet confirmed blocks a
        new POST with 409 rather than silently dropping the in-flight step."""
        qid = _post_cmd(client, 's').get_json()['id']
        client.get('/hardware/wukong/command')      # bridge consumes it
        d = _status(client)['command_delivery']
        assert d['consumed_ts'] is not None
        assert d['write_ts'] is None
        r = _post_cmd(client, 's')
        assert r.status_code == 409
        body = r.get_json()
        assert body['ok'] is False
        assert 'in progress' in body['error']
        # Delivery record still points to the original command.
        assert _status(client)['command_delivery']['id'] == qid

    def test_pending_not_consumed_can_still_be_overwritten(self, client):
        """A command that is queued but not yet consumed (bridge hasn't polled)
        can still be overwritten — that is the documented pre-existing policy."""
        r1 = _post_cmd(client, 'f').get_json()
        r2 = _post_cmd(client, 's')
        assert r2.status_code == 200
        assert r2.get_json()['overwrote'] == 'f'

    def test_after_write_confirmed_new_command_accepted(self, client):
        """Once write_ok arrives the slot is free and the next STEP is accepted
        normally (no lingering 409)."""
        qid = _post_cmd(client, 's').get_json()['id']
        client.get('/hardware/wukong/command')
        _ack(client, 's', qid, True)
        assert _status(client)['command_delivery']['write_ok'] is True
        r = _post_cmd(client, 's')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_after_write_failed_new_command_accepted(self, client):
        """A confirmed write failure (ok=false) also frees the slot so the
        user can retry without being stuck at 409 forever."""
        qid = _post_cmd(client, 's').get_json()['id']
        client.get('/hardware/wukong/command')
        _ack(client, 's', qid, False, 'serial port dead')
        assert _status(client)['command_delivery']['write_ok'] is False
        r = _post_cmd(client, 's')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True


class TestBreakpointNiaParsing:
    """A malformed NIA must be a hard 400 — never coerced to 0xFFFFFFFF,
    which the RTL interprets as 'clear breakpoint' (a parse error would
    otherwise silently DISARM breakpoints)."""

    def _pending_nia(self):
        with _app_module._wukong_command_lock:
            return (_app_module._wukong_pending_cmd or {}).get('nia')

    def test_int_nia_accepted(self, client):
        r = _post_cmd(client, 'b', nia=16)
        assert r.status_code == 200 and r.get_json()['ok']
        assert self._pending_nia() == 16

    def test_hex_string_nia_accepted(self, client):
        r = _post_cmd(client, 'b', nia='0x00000010')
        assert r.status_code == 200 and r.get_json()['ok']
        assert self._pending_nia() == 0x10

    def test_bare_hex_string_nia_accepted(self, client):
        r = _post_cmd(client, 'b', nia='DEAD0010')
        assert r.status_code == 200 and r.get_json()['ok']
        assert self._pending_nia() == 0xDEAD0010

    def test_decimal_string_nia_accepted(self, client):
        r = _post_cmd(client, 'b', nia='512')
        assert r.status_code == 200 and r.get_json()['ok']
        assert self._pending_nia() == 512

    def test_clear_sentinel_accepted(self, client):
        r = _post_cmd(client, 'b', nia=0xFFFFFFFF)
        assert r.status_code == 200 and r.get_json()['ok']
        assert self._pending_nia() == 0xFFFFFFFF

    def test_garbage_nia_rejected_not_coerced(self, client):
        r = _post_cmd(client, 'b', nia='not-an-address')
        assert r.status_code == 400
        assert self._pending_nia() is None      # nothing queued

    def test_out_of_range_nia_rejected(self, client):
        r = _post_cmd(client, 'b', nia=2**32)
        assert r.status_code == 400
        assert self._pending_nia() is None

    def test_none_nia_rejected(self, client):
        r = _post_cmd(client, 'b', nia=None)
        assert r.status_code == 400
        assert self._pending_nia() is None


class TestAutomaticHaltAfterSentinelLabel:
    def test_automatic_halt_label_appears_in_timeline(self, client):
        r = _bridge_status(
            client,
            session_id='halt-sentinel-test',
            event='automatic_halt_after_sentinel',
            state='awaiting_first_step',
            reason='halt written after boot sentinel; awaiting first deliberate step',
            serial_port='/dev/ttyUSB0',
        )
        assert r.status_code == 200
        timeline = _status(client)['bridge_timeline']
        matching = [e for e in timeline
                    if e['event'] == 'automatic_halt_after_sentinel']
        assert matching
        entry = matching[-1]
        assert entry['state'] == 'awaiting_first_step'
        assert entry['session_id'] == 'halt-sentinel-test'


class TestPriorityStop:
    @pytest.mark.parametrize('cmd', ['r', 's'])
    def test_stop_atomically_replaces_queued_execution_command(self, client, cmd):
        queued = _post_cmd(client, cmd).get_json()
        stopped = _post_cmd(client, 'h')
        assert stopped.status_code == 200
        body = stopped.get_json()
        assert body['cancelled'] == {'cmd': cmd, 'id': queued['id']}
        pending = _status(client)['pending_command']
        assert pending['cmd'] == 'h'
        assert pending['id'] == body['id']

    @pytest.mark.parametrize('cmd,extra', [
        ('f', {}),
        ('b', {'nia': 16}),
        ('q', {}),
        ('h', {}),
    ])
    def test_stop_refuses_non_execution_pending_command(self, client, cmd, extra):
        assert _post_cmd(client, cmd, **extra).status_code == 200
        stopped = _post_cmd(client, 'h')
        assert stopped.status_code == 409
        body = stopped.get_json()
        assert body['blocked_cmd'] == cmd
        assert body['blocked_stage'] == 'queued'
        assert _status(client)['pending_command']['cmd'] == cmd

    def test_stop_refuses_upload_in_progress(self, client):
        assert _post_cmd(client, 'u', data='YQ==').status_code == 200
        stopped = _post_cmd(client, 'h')
        assert stopped.status_code == 409
        body = stopped.get_json()
        assert body['blocked_cmd'] == 'u'
        assert body['blocked_stage'] == 'upload'
        assert _status(client)['pending_command']['cmd'] == 'u'

    def test_stop_refuses_command_already_consumed(self, client):
        queued = _post_cmd(client, 'r').get_json()
        client.get('/hardware/wukong/command')
        stopped = _post_cmd(client, 'h')
        assert stopped.status_code == 409
        body = stopped.get_json()
        assert body['blocked_cmd'] == 'r'
        assert body['blocked_stage'] == 'consumed'
        assert _status(client)['command_delivery']['id'] == queued['id']


class TestStepFirstRunGate:
    def _step_ack(self, client, session='bridge-a', counter=10):
        step_id = _post_cmd(client, 's').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': session})
        _ack(client, 's', step_id, True, session_id=session,
             trace_counter=counter)

    def test_direct_run_rejected_before_first_step_progress(self, client):
        _app_module._wukong_run_unlocked = False
        response = _post_cmd(client, 'r')
        assert response.status_code == 409
        assert response.get_json()['blocked_stage'] == 'awaiting_first_step'

    def test_step_ack_then_newer_same_session_trace_unlocks(self, client):
        self._step_ack(client)
        assert _status(client)['run_unlocked'] is False
        _trace(client, 'bridge-a', 11)
        assert _status(client)['run_unlocked'] is True
        assert _post_cmd(client, 'r').status_code == 200

    def test_pre_write_counter_does_not_unlock(self, client):
        _trace(client, 'bridge-a', 10)
        self._step_ack(client, counter=10)
        assert _status(client)['run_unlocked'] is False

    def test_wrong_session_trace_does_not_unlock(self, client):
        self._step_ack(client)
        _trace(client, 'bridge-b', 11)
        assert _status(client)['run_unlocked'] is False

    def test_trace_arriving_before_ack_is_reconciled_from_highwater(self, client):
        step_id = _post_cmd(client, 's').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _trace(client, 'bridge-a', 11)
        _ack(client, 's', step_id, True, session_id='bridge-a',
             trace_counter=10)
        assert _status(client)['run_unlocked'] is True


class TestTestingOnlySkipFault:
    """The `k` command is available only for the exact live promoted incident."""

    def _seed_fault(self, promoted=True, matching=True):
        incident = 'a' * 32
        with _app_module._wukong_trace_lock:
            fault_event = {
                'seq': 41, 'fault_valid': True, 'incident_id': incident,
                'nia': 0x140, 'fault_code': 1,
            }
            _app_module._wukong_event_queue[:] = [fault_event]
            _app_module._wukong_latest_trace = dict(fault_event)
            _app_module._wukong_latest_snapshot = {
                'reason': 2,
                'snapshot_seq': 12,
                'incident_id': incident if matching else 'b' * 32,
                'fault_trace_seq': 41,
                'promotion_status': 'promoted' if promoted else 'pending',
            }
        return incident

    def test_skip_rejects_stale_or_unpromoted_fault_evidence(self, client):
        self._seed_fault(promoted=False)
        rejected = _post_cmd(client, 'k')
        assert rejected.status_code == 409
        assert rejected.get_json()['blocked_stage'] == 'no_current_hardware_fault'
        self._seed_fault(promoted=True, matching=False)
        assert _post_cmd(client, 'k').status_code == 409

    def test_skip_accepts_exact_promoted_live_incident_and_ack_clears_live_only(self, client):
        incident = self._seed_fault()
        queued = _post_cmd(client, 'k')
        assert queued.status_code == 200
        cmd_id = queued.get_json()['id']
        assert _status(client)['skip_fault_available'] is True
        got = client.get('/hardware/wukong/command').get_json()
        assert got['cmd'] == 'k' and got['incident_id'] == incident
        assert _ack(client, 'k', cmd_id, True, session_id='bridge-a',
                    state_counter=7).status_code == 200
        # UART ACK alone is not board acceptance and must not hide the fault.
        assert _status(client)['latest_trace']['fault_valid'] is True
        assert _post_cmd(client, 'k').status_code == 409
        token = os.environ.get('REPORT_TOKEN', '')
        report_headers = (
            {'Authorization': f'Bearer {token}'} if token else {})
        rejected = client.post('/hardware/wukong/skip-fault-completion',
                               data=json.dumps({
                                   'command_id': cmd_id, 'incident_id': incident,
                                   'fault_nia': 0x140, 'nia': 0x140, 'reason': 3,
                                   'snapshot': True, 'version': 1, 'crc_valid': True,
                                   'bridge_session': 'bridge-a',
                                   'seq': 13,
                               }), content_type='application/json',
                               headers=report_headers)
        assert rejected.status_code == 409
        complete = client.post('/hardware/wukong/skip-fault-completion',
                               data=json.dumps({
                                   'command_id': cmd_id, 'incident_id': incident,
                                   'fault_nia': 0x140, 'nia': 0x144, 'reason': 3,
                                   'snapshot': True, 'version': 1, 'crc_valid': True,
                                   'bridge_session': 'bridge-a',
                                   'seq': 13,
                               }), content_type='application/json',
                               headers=report_headers)
        assert complete.status_code == 200
        status = _status(client)
        assert status['latest_trace']['fault_valid'] is False
        assert status['latest_trace']['skip_fault_consumed'] is True
        # Snapshot remains a durable historical record; only live status clears.
        assert status['latest_snapshot']['incident_id'] == incident
        assert status['latest_snapshot']['promotion_status'] == 'promoted'
        assert status['skip_fault_available'] is False
        # The historical event is immutable and still records the real fault.
        assert _app_module._wukong_event_queue[0]['fault_valid'] is True
        assert client.post('/hardware/wukong/skip-fault-completion',
                           data=json.dumps({
                               'command_id': cmd_id, 'incident_id': incident,
                               'fault_nia': 0x140, 'nia': 0x144, 'reason': 3,
                               'snapshot': True, 'version': 1, 'crc_valid': True,
                               'bridge_session': 'bridge-a',
                               'seq': 13,
                           }), content_type='application/json',
                           headers=report_headers).status_code == 409

    def test_completion_requires_auth_session_and_exact_hardware_sequence(
            self, client, monkeypatch):
        monkeypatch.setenv('REPORT_TOKEN', 'report-secret')
        incident = self._seed_fault()
        cmd_id = _post_cmd(client, 'k').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _ack(client, 'k', cmd_id, True, session_id='bridge-a',
             state_counter=7)
        body = {
            'command_id': cmd_id, 'incident_id': incident,
            'fault_nia': 0x140, 'nia': 0x144, 'reason': 3,
            'snapshot': True, 'version': 1, 'crc_valid': True,
            'bridge_session': 'bridge-a',
            'seq': 13,
        }
        assert client.post('/hardware/wukong/skip-fault-completion',
                           json=body).status_code == 401
        headers = {'Authorization': 'Bearer report-secret'}
        wrong_session = dict(body, bridge_session='bridge-b')
        assert client.post('/hardware/wukong/skip-fault-completion',
                           json=wrong_session, headers=headers).status_code == 409
        stale = dict(body, seq=12)
        assert client.post('/hardware/wukong/skip-fault-completion',
                           json=stale, headers=headers).status_code == 409
        assert client.post('/hardware/wukong/skip-fault-completion',
                           json=body, headers=headers).status_code == 200

    def test_completion_is_unavailable_without_report_token(
            self, client, monkeypatch):
        monkeypatch.delenv('REPORT_TOKEN', raising=False)
        response = client.post('/hardware/wukong/skip-fault-completion',
                               json={})
        assert response.status_code == 503
        assert response.get_json()['decision'] == 'auth_unavailable'

    def test_reconnect_makes_skip_indeterminate_and_reboot_clears_it(self, client):
        self._seed_fault()
        cmd_id = _post_cmd(client, 'k').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _ack(client, 'k', cmd_id, True, session_id='bridge-a',
             state_counter=2)
        _bridge_status(client, session_id='bridge-b', event='reconnect_attempt',
                       state='reconnecting')
        status = _status(client)
        assert status['skip_fault']['state'] == 'indeterminate'
        assert status['skip_fault']['action'] == 'Reboot required'
        assert _post_cmd(client, 'k').status_code == 409
        reboot_id = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-b'})
        _ack(client, 'f', reboot_id, True, session_id='bridge-b')
        assert _status(client)['skip_fault'] is None

    def test_completion_timeout_is_indeterminate_and_requires_reboot(self, client):
        self._seed_fault()
        cmd_id = _post_cmd(client, 'k').get_json()['id']
        client.get('/hardware/wukong/command',
                   headers={'X-Wukong-Session': 'bridge-a'})
        _ack(client, 'k', cmd_id, True, session_id='bridge-a',
             state_counter=3)
        with _app_module._wukong_command_lock:
            _app_module._wukong_skip_pending['write_ts'] = (
                time.time() - _app_module._WUKONG_SKIP_COMPLETION_TIMEOUT - 1)
        status = _status(client)
        assert status['skip_fault']['state'] == 'indeterminate'
        assert status['skip_fault']['action'] == 'Reboot required'
        assert status['latest_trace']['fault_valid'] is True


class TestBootInfoReceivedTs:
    def test_boot_info_stamped_with_received_ts(self, client, monkeypatch):
        """The sentinel-confirmation flow needs a server-side receive
        timestamp on boot_info so the UI can tell fresh from stale."""
        t0 = time.time()
        monkeypatch.setenv('REPORT_TOKEN', 'bridge-report-secret')
        _app_module._wukong_bridge_info['session_id'] = 'test-session'
        response = client.post(
            '/hardware/wukong/boot-info',
            data=json.dumps({'stale_tu': False, 'tu_version': 3,
                             'build_version': 7,
                             'startup_state': 'awaiting_first_step',
                             'session_id': 'test-session'}),
            headers={'Authorization': 'Bearer bridge-report-secret'},
            content_type='application/json')
        assert response.status_code == 200
        bi = _status(client)['boot_info']
        assert bi['received_ts'] >= t0 - 1
        assert bi['build_version'] == 7
        assert bi['startup_state'] == 'awaiting_first_step'
        assert _status(client)['startup_state'] == 'awaiting_first_step'
