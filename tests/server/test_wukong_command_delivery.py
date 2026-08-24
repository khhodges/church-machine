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
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd = None
        _app_module._wukong_cmd_delivery = None
        _app_module._wukong_cmd_id = 0
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


def _ack(client, cmd, cmd_id, ok, error=''):
    body = {'cmd': cmd, 'id': cmd_id, 'ok': ok}
    if error:
        body['error'] = error
    return client.post('/hardware/wukong/command-ack',
                       data=json.dumps(body), content_type='application/json')


def _bridge_status(client, **body):
    return client.post('/hardware/wukong/bridge-status',
                       data=json.dumps(body), content_type='application/json')


class TestQueueConsumeAckLifecycle:
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

    def test_write_ts_after_sentinel_received_ts_ordering(self, client):
        """Sentinel confirmation is bound to write_ts: a boot-info received
        BEFORE the write ack must have received_ts < write_ts so the UI can
        reject a pre-existing sentinel as proof of reboot."""
        client.post('/hardware/wukong/boot-info',
                    data=json.dumps({'stale_tu': False, 'tu_version': 3,
                                     'build_version': 7}),
                    content_type='application/json')
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


class TestAutomaticRunAfterSentinelLabel:
    """Task 3012: the bridge now emits 'automatic_run_after_sentinel' (not the
    old 'automatic_halt_after_sentinel') after a clean boot sentinel.  Verify
    that the server surfaces the new label verbatim in bridge_timeline so the
    Devices panel can distinguish a post-sentinel connected state from a halt."""

    def test_automatic_run_label_appears_in_timeline(self, client):
        """POSTing the new event label must appear verbatim in bridge_timeline."""
        r = _bridge_status(
            client,
            session_id='run-sentinel-test',
            event='automatic_run_after_sentinel',
            state='connected',
            reason='intentional run after boot sentinel',
            serial_port='/dev/ttyUSB0',
        )
        assert r.status_code == 200
        timeline = _status(client)['bridge_timeline']
        matching = [e for e in timeline if e['event'] == 'automatic_run_after_sentinel']
        assert matching, (
            "bridge_timeline must contain an entry with "
            "event='automatic_run_after_sentinel'"
        )
        entry = matching[-1]
        assert entry['state'] == 'connected', (
            "automatic_run_after_sentinel must carry state='connected'"
        )
        assert entry['session_id'] == 'run-sentinel-test'

    def test_automatic_run_state_connected_not_halted(self, client):
        """The state field must be 'connected', not 'halted' — the board runs
        freely after a clean sentinel; only a fault_halt event would set halted."""
        _bridge_status(
            client,
            session_id='s-run',
            event='automatic_run_after_sentinel',
            state='connected',
            reason='intentional run after boot sentinel',
        )
        timeline = _status(client)['bridge_timeline']
        run_entries = [e for e in timeline if e['event'] == 'automatic_run_after_sentinel']
        assert run_entries, "expected at least one automatic_run_after_sentinel entry"
        for e in run_entries:
            assert e['state'] != 'halted', (
                "automatic_run_after_sentinel must never carry state='halted'; "
                "got state=%r" % e['state']
            )

    def test_old_halt_label_absent_from_bridge(self, client):
        """Regression: the old 'automatic_halt_after_sentinel' label must never
        be injected by the current bridge — if it appears in the timeline it
        means a stale bridge is connected."""
        # Populate the timeline with the correct new event only.
        _bridge_status(
            client,
            session_id='s-new',
            event='automatic_run_after_sentinel',
            state='connected',
            reason='intentional run after boot sentinel',
        )
        timeline = _status(client)['bridge_timeline']
        stale = [e for e in timeline if e['event'] == 'automatic_halt_after_sentinel']
        assert not stale, (
            "Found stale 'automatic_halt_after_sentinel' entries in bridge_timeline — "
            "the bridge must emit 'automatic_run_after_sentinel' instead: %r" % stale
        )


class TestBootInfoReceivedTs:
    def test_boot_info_stamped_with_received_ts(self, client):
        """The sentinel-confirmation flow needs a server-side receive
        timestamp on boot_info so the UI can tell fresh from stale."""
        t0 = time.time()
        client.post('/hardware/wukong/boot-info',
                    data=json.dumps({'stale_tu': False, 'tu_version': 3,
                                     'build_version': 7}),
                    content_type='application/json')
        bi = _status(client)['boot_info']
        assert bi['received_ts'] >= t0 - 1
        assert bi['build_version'] == 7
