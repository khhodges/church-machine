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
        """f -> consume -> new f queued -> late ack for the FIRST f must not
        mark the second f as written (same command letter, different id)."""
        id1 = _post_cmd(client, 'f').get_json()['id']
        client.get('/hardware/wukong/command')       # bridge consumes first f
        id2 = _post_cmd(client, 'f').get_json()['id']  # user clicks again
        assert id2 != id1
        _ack(client, 'f', id1, True)                 # late ack for first f
        d = _status(client)['command_delivery']
        assert d['id'] == id2
        assert d['write_ok'] is None, 'late same-letter ack corrupted new record'
        # After the second f is consumed, its own ack applies normally.
        client.get('/hardware/wukong/command')
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

    def test_no_overwrite_flag_after_consumption(self, client):
        _post_cmd(client, 'f')
        client.get('/hardware/wukong/command')   # bridge consumed it
        r = _post_cmd(client, 's')
        assert 'overwrote' not in r.get_json()


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
