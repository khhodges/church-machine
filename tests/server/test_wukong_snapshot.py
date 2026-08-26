"""Server validation and ordering tests for Wukong snapshots."""

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


def _reset():
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace = {}
        _app_module._wukong_latest_snapshot = {}
        _app_module._wukong_latest_cr_gts = {}
        _app_module._wukong_event_queue[:] = []
        _app_module._wukong_event_seq = 0
        _app_module._wukong_call_depth = 0
        _app_module._wukong_fault_incidents.clear()
        _app_module._wukong_fault_candidate = {
            'state': 'unavailable',
            'decision': 'missing_trace',
            'incident_id': '',
        }
    with _app_module._fault_snapshot_lock:
        _app_module._fault_snapshot = None


def _snapshot():
    return {
        'snapshot': True,
        'version': 1,
        'seq': 4,
        'reason': 3,
        'flags': 0x0D,
        'm_flag': True,
        'nia': 0x164,
        'sto': 0x55,
        'thread_base': 0x220,
        'stored_cr12_gt': 0xA1,
        'stored_packed_pc': 0xB2,
        'stored_mflag': 0xC3,
        'cr': [[i, i + 1, i + 2] for i in range(16)],
        'dr': [0x100 + i for i in range(16)],
        'crc16': 0xCAFE,
        'crc_valid': True,
        'integrity': 'CRC16 verified',
        'ts': time.time(),
    }


def _fault_trace(incident_id='incident-0000000000000001',
                 bridge_session='bridge-session-a', nia=0x164,
                 flags=0x0D, fault_code=3):
    return {
        'nia': nia, 'ev_type': 0, 'payload_gt': 0,
        'flags': flags, 'fault_code': fault_code, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
        'incident_id': incident_id,
        'bridge_session': bridge_session,
    }


def _post_fault_trace(client, **kwargs):
    trace = _fault_trace(**kwargs)
    response = client.post('/hardware/wukong/trace',
                           data=json.dumps(trace),
                           content_type='application/json')
    assert response.status_code == 200
    return trace, response.get_json()


def _correlated_snapshot(trace, trace_ack):
    snapshot = _snapshot()
    snapshot.update({
        'reason': 2,
        'nia': trace['nia'],
        'flags': trace['flags'],
        'incident_id': trace['incident_id'],
        'bridge_session': trace['bridge_session'],
        'fault_trace_seq': trace_ack['seq'],
        'fault_boot_id': trace_ack['boot_id'],
    })
    return snapshot


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset()
    with app.test_client() as c:
        yield c
    _reset()


def test_snapshot_shape_is_rejected_without_queue_mutation(client):
    bad = _snapshot()
    bad['cr'] = bad['cr'][:-1]
    response = client.post('/hardware/wukong/snapshot',
                           data=json.dumps(bad),
                           content_type='application/json')
    assert response.status_code == 400
    assert client.get('/hardware/wukong/events?after=0').get_json()['events'] == []


def test_snapshot_is_ordered_with_trace_events(client):
    trace = {
        'nia': 0x10, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0, 'fault_code': 0, 'fault_valid': False,
        'bp_hit': False, 'ts': time.time(),
    }
    assert client.post('/hardware/wukong/trace',
                       data=json.dumps(trace),
                       content_type='application/json').status_code == 200
    assert client.post('/hardware/wukong/snapshot',
                       data=json.dumps(_snapshot()),
                       content_type='application/json').status_code == 200
    trace['nia'] = 0x14
    assert client.post('/hardware/wukong/trace',
                       data=json.dumps(trace),
                       content_type='application/json').status_code == 200

    events = client.get('/hardware/wukong/events?after=0').get_json()['events']
    assert [event.get('snapshot', False) for event in events] == [False, True, False]
    assert [event['seq'] for event in events] == [1, 2, 3]
    assert events[1]['stored_cr12_gt'] == 0xA1
    assert events[1]['dr'][15] == 0x10F


def test_latest_snapshot_is_exposed_by_read_only_status(client):
    payload = _snapshot()
    assert client.post('/hardware/wukong/snapshot',
                       data=json.dumps(payload),
                       content_type='application/json').status_code == 200

    status = client.get('/hardware/wukong/status').get_json()
    assert status['latest_snapshot']['snapshot'] is True
    assert status['latest_snapshot']['nia'] == 0x164
    assert status['latest_snapshot']['stored_cr12_gt'] == 0xA1


def test_simulator_fault_gets_a_durable_display_identity(client):
    response = client.post('/api/fault-snapshot', data=json.dumps({
        'fault_code': 8, 'fault_message': 'BOUNDS',
        'nia': 0x44, 'pc': 0x44, 'source': 'simulator',
        'cr': [[0, 0, 0] for _ in range(16)],
        'dr': [0 for _ in range(16)],
    }), content_type='application/json')
    assert response.status_code == 200
    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['display_state'] == 'accepted'
    assert stored['snapshot_complete'] is True
    assert stored['incident_id'].startswith('simulator-')
    assert stored['correlation_status'] == 'local simulator capture'
    assert stored['promotion_status'] == 'stored'


def test_bridge_local_fault_candidate_is_visible_before_trace_delivery(client):
    incident_id = 'bridge-local-incident-0001'
    response = client.post(
        '/hardware/wukong/bridge-status',
        data=json.dumps({
            'session_id': 'bridge-session-local',
            'event': 'fault_decoded',
            'state': 'fault_hold',
            'fault_delivery': {
                'state': 'local_decoded_awaiting_delivery',
                'incident_id': incident_id,
                'fault_code': 3,
                'fault_name': 'PERM_X',
                'nia': 0x164,
                'flags': 0x0D,
                'correlation_status': 'local decoded; awaiting IDE delivery',
                'promotion_status': 'pending server delivery',
            },
        }),
        content_type='application/json')
    assert response.status_code == 200

    pending = client.get('/api/fault-snapshot').get_json()
    assert pending['display_state'] == 'pending'
    assert pending['decision'] == 'local_fault_awaiting_delivery'
    assert pending['fault_name'] == 'PERM_X'
    assert pending['nia'] == 0x164
    assert pending['correlation_status'] == \
        'local decoded; awaiting IDE delivery'

    status = client.get('/hardware/wukong/status').get_json()
    assert status['fault_candidate']['state'] == 'pending'
    assert status['fault_candidate']['incident_id'] == incident_id
    assert status['bridge']['fault_delivery']['state'] == \
        'local_decoded_awaiting_delivery'

    trace, trace_ack = _post_fault_trace(client, incident_id=incident_id)
    assert trace_ack['decision'] == 'trace_accepted'
    trace_pending = client.get('/api/fault-snapshot').get_json()
    assert trace_pending['display_state'] == 'pending'
    assert trace_pending['decision'] == 'trace_accepted_awaiting_snapshot'
    assert trace_pending['fault_name'] == 'PERM_X'
    assert trace_pending['nia'] == trace['nia']


def test_new_local_fault_is_not_masked_by_older_promoted_snapshot(client):
    old_trace, old_ack = _post_fault_trace(
        client, incident_id='old-promoted-incident-0001')
    old_snapshot = _correlated_snapshot(old_trace, old_ack)
    assert client.post(
        '/hardware/wukong/snapshot', data=json.dumps(old_snapshot),
        content_type='application/json').get_json()['decision'] == 'promoted'

    response = client.post(
        '/hardware/wukong/bridge-status',
        data=json.dumps({
            'session_id': 'bridge-session-new',
            'event': 'fault_decoded',
            'fault_delivery': {
                'state': 'local_decoded_awaiting_delivery',
                'incident_id': 'new-local-incident-0001',
                'fault_code': 8,
                'fault_name': 'BOUNDS',
                'nia': 0x200,
                'flags': 1,
            },
        }),
        content_type='application/json')
    assert response.status_code == 200
    pending = client.get('/api/fault-snapshot').get_json()
    assert pending['display_state'] == 'pending'
    assert pending['incident_id'] == 'new-local-incident-0001'
    assert pending['fault_name'] == 'BOUNDS'
    assert pending['nia'] == 0x200


def test_fault_snapshot_survives_reboot_trace_with_complete_machine_state(client):
    """SelfTest fault → reason-2 AC snapshot → Boot.0 keeps the actual fault."""
    partial = {
        'fault_code': 3,
        'fault_message': 'PERM_X',
        'nia': 0x164,
        'pc': 0x164,
        'source': 'hardware',
        'snapshot_complete': False,
        'cr': [[0, 0, 0] for _ in range(16)],
    }
    assert client.post('/api/fault-snapshot', data=json.dumps(partial),
                       content_type='application/json').status_code == 200
    fault_trace, trace_ack = _post_fault_trace(client)
    snapshot = _correlated_snapshot(fault_trace, trace_ack)
    snapshot_response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(snapshot),
        content_type='application/json')
    assert snapshot_response.status_code == 200
    assert snapshot_response.get_json()['decision'] == 'promoted'

    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['snapshot_complete'] is True
    assert stored['fault_code'] == 3
    assert stored['fault_message'] == 'PERM_X'
    assert stored['nia'] == 0x164
    assert stored['cr'][15] == [15, 16, 17]
    assert stored['dr'][15] == 0x10F
    assert stored['incident_id'] == fault_trace['incident_id']
    assert stored['correlation_status'] == 'correlated'
    assert stored['promotion_status'] == 'promoted'

    # A late trace-only browser POST and Boot.0's clean event must not erase it.
    assert client.post('/api/fault-snapshot', data=json.dumps(partial),
                       content_type='application/json').get_json()['stored'] is False
    boot_zero = dict(fault_trace, nia=0, fault_code=0, fault_valid=False)
    boot_zero.pop('incident_id')
    boot_zero.pop('bridge_session')
    assert client.post('/hardware/wukong/trace', data=json.dumps(boot_zero),
                       content_type='application/json').status_code == 200
    after_boot = client.get('/api/fault-snapshot').get_json()
    assert after_boot['snapshot_complete'] is True
    assert after_boot['nia'] == 0x164
    status = client.get('/hardware/wukong/status').get_json()
    assert status['halt']['state'] == 'running'
    assert status['last_accepted_fault']['incident_id'] == \
        fault_trace['incident_id']


def test_new_fault_snapshot_uses_its_own_trace_metadata_not_prior_fault(client):
    first = {
        'fault_code': 1, 'fault_message': 'PERM_R', 'nia': 0x100,
        'pc': 0x100, 'source': 'hardware', 'snapshot_complete': False,
    }
    assert client.post('/api/fault-snapshot', data=json.dumps(first),
                       content_type='application/json').status_code == 200
    newer_trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000002', flags=0)
    newer_snapshot = _correlated_snapshot(newer_trace, trace_ack)
    assert client.post('/hardware/wukong/snapshot',
                       data=json.dumps(newer_snapshot),
                       content_type='application/json').status_code == 200

    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['fault_code'] == 3
    assert stored['fault_message'] == 'PERM_X'
    assert stored['nia'] == 0x164


def test_uncorrelated_fault_reason_snapshot_does_not_replace_last_fault(client):
    """A trace rejected before the snapshot must not produce a stale Last Fault."""
    original = {
        'fault_code': 1, 'fault_message': 'PERM_R', 'nia': 0x100,
        'pc': 0x100, 'source': 'hardware', 'snapshot_complete': True,
    }
    assert client.post('/api/fault-snapshot', data=json.dumps(original),
                       content_type='application/json').status_code == 200
    fault_reason_snapshot = _snapshot()
    fault_reason_snapshot['reason'] = 2
    response = client.post('/hardware/wukong/snapshot',
                           data=json.dumps(fault_reason_snapshot),
                           content_type='application/json')
    assert response.status_code == 409
    assert response.get_json()['decision'] == 'missing_trace'

    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['fault_code'] == 1
    assert stored['fault_message'] == 'PERM_R'
    assert stored['snapshot_complete'] is True


def test_incomplete_fault_snapshot_never_authorizes_recovery(client):
    """A fault trace alone, or an incomplete AC payload, cannot authorize g."""
    before = client.get('/api/fault-snapshot').get_json()
    trace, trace_meta = _post_fault_trace(
        client, incident_id='incident-0000000000000003', flags=0)
    incomplete = _correlated_snapshot(trace, trace_meta)
    incomplete['cr'] = incomplete['cr'][:-1]
    response = client.post('/hardware/wukong/snapshot',
                           data=json.dumps(incomplete),
                           content_type='application/json')
    assert response.status_code == 400
    assert response.get_json().get('promoted') is not True
    after = client.get('/api/fault-snapshot').get_json()
    assert before['display_state'] == 'unavailable'
    assert after['display_state'] in ('pending', 'unavailable')


def test_fault_snapshot_uses_correlated_trace_even_after_competing_events(client):
    """A clean or another fault-valid trace cannot hijack an armed recovery."""
    fault_a, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000004', flags=0)
    clean = {
        'nia': 0, 'ev_type': 0, 'payload_gt': 0, 'flags': 0,
        'fault_code': 0, 'fault_valid': False, 'bp_hit': False,
        'ts': time.time(),
    }
    fault_b = _fault_trace(
        incident_id='incident-0000000000000005', nia=0x200,
        flags=0, fault_code=1)
    assert client.post('/hardware/wukong/trace', data=json.dumps(clean),
                       content_type='application/json').status_code == 200
    assert client.post('/hardware/wukong/trace', data=json.dumps(fault_b),
                       content_type='application/json').status_code == 200

    snapshot = _correlated_snapshot(fault_a, trace_ack)
    response = client.post('/hardware/wukong/snapshot', data=json.dumps(snapshot),
                           content_type='application/json')
    assert response.status_code == 200
    assert response.get_json()['promoted'] is True
    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['fault_code'] == 3
    assert stored['fault_message'] == 'PERM_X'
    assert stored['nia'] == 0x164


def test_fault_snapshot_rejects_reused_sequence_after_server_restart(client, monkeypatch):
    """A former server generation cannot promote a snapshot after restart."""
    original_boot_id = _app_module.BOOT_ID
    fault_a = _fault_trace(
        incident_id='incident-0000000000000006', flags=0)
    old_trace = client.post('/hardware/wukong/trace', data=json.dumps(fault_a),
                            content_type='application/json').get_json()

    # Simulate a process restart: the queue sequence restarts and an unrelated
    # fault is assigned the same numeric sequence under a fresh BOOT_ID.
    monkeypatch.setattr(_app_module, 'BOOT_ID', 'new-server-generation')
    _reset()
    unrelated = _fault_trace(
        incident_id='incident-0000000000000007', nia=0x200,
        flags=0, fault_code=1)
    new_trace = client.post('/hardware/wukong/trace', data=json.dumps(unrelated),
                            content_type='application/json').get_json()
    assert old_trace['seq'] == new_trace['seq'] == 1
    assert old_trace['boot_id'] == original_boot_id
    assert new_trace['boot_id'] == 'new-server-generation'

    snapshot = _correlated_snapshot(fault_a, old_trace)
    response = client.post('/hardware/wukong/snapshot', data=json.dumps(snapshot),
                           content_type='application/json')
    assert response.status_code == 409
    assert response.get_json()['promoted'] is False
    assert response.get_json()['decision'] == 'server_generation_changed'


def test_trace_and_snapshot_retries_are_idempotent_after_lost_responses(client):
    """A response timeout may repeat the request, never the queued incident."""
    trace = _fault_trace(incident_id='incident-0000000000000008')
    first_trace = client.post(
        '/hardware/wukong/trace', data=json.dumps(trace),
        content_type='application/json').get_json()
    retry_trace = client.post(
        '/hardware/wukong/trace', data=json.dumps(trace),
        content_type='application/json').get_json()
    assert first_trace['decision'] == 'trace_accepted'
    assert retry_trace['decision'] == 'duplicate'
    assert retry_trace['seq'] == first_trace['seq']

    snapshot = _correlated_snapshot(trace, first_trace)
    first_snapshot = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(snapshot),
        content_type='application/json').get_json()
    retry_snapshot = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(snapshot),
        content_type='application/json').get_json()
    assert first_snapshot['decision'] == 'promoted'
    assert retry_snapshot['decision'] == 'duplicate'
    assert retry_snapshot['seq'] == first_snapshot['seq']

    events = client.get('/hardware/wukong/events?after=0').get_json()['events']
    assert len(events) == 2
    assert [event.get('incident_id') for event in events] == [
        trace['incident_id'], trace['incident_id']]


def test_invalid_crc_and_fault_time_mismatch_cannot_promote(client):
    trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000009')
    invalid_crc = _correlated_snapshot(trace, trace_ack)
    invalid_crc['crc_valid'] = False
    response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(invalid_crc),
        content_type='application/json')
    assert response.status_code == 400
    assert response.get_json()['decision'] == 'invalid_snapshot'

    reset_looking = _correlated_snapshot(trace, trace_ack)
    reset_looking['nia'] = 0
    reset_looking['flags'] = 0
    response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(reset_looking),
        content_type='application/json')
    assert response.status_code == 400
    assert response.get_json()['decision'] == 'invalid_snapshot'
    assert 'fault-time NIA/flags' in response.get_json()['reason']
    assert client.get('/api/fault-snapshot').get_json()['display_state'] == \
        'rejected'


def test_missing_crc_verdict_or_server_generation_cannot_promote(client):
    trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000012')

    missing_crc = _correlated_snapshot(trace, trace_ack)
    missing_crc.pop('crc_valid')
    response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(missing_crc),
        content_type='application/json')
    assert response.status_code == 400
    assert response.get_json()['decision'] == 'invalid_snapshot'
    assert 'explicit valid CRC verdict' in response.get_json()['reason']

    missing_generation = _correlated_snapshot(trace, trace_ack)
    missing_generation.pop('fault_boot_id')
    response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(missing_generation),
        content_type='application/json')
    assert response.status_code == 409
    assert response.get_json()['decision'] == 'server_generation_changed'


def test_incident_session_mismatch_is_explicit_and_fail_closed(client):
    trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000010')
    snapshot = _correlated_snapshot(trace, trace_ack)
    snapshot['bridge_session'] = 'different-bridge-session'
    response = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(snapshot),
        content_type='application/json')
    assert response.status_code == 409
    assert response.get_json()['decision'] == 'incident_mismatch'
    assert response.get_json()['promoted'] is False


def test_recovery_authorization_requires_an_immutable_authorization_id(client):
    trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000013')
    snapshot = _correlated_snapshot(trace, trace_ack)
    assert client.post('/hardware/wukong/snapshot', data=json.dumps(snapshot),
                       content_type='application/json').status_code == 200

    response = client.post(
        '/hardware/wukong/recovery-authorization',
        data=json.dumps({
            'incident_id': trace['incident_id'],
            'bridge_session': trace['bridge_session'],
        }),
        content_type='application/json')
    assert response.status_code == 400
    assert response.get_json()['decision'] == 'invalid_snapshot'

    accepted = client.get('/api/fault-snapshot').get_json()
    assert accepted.get('recovery_authorized') is not True


def test_visible_event_order_is_fault_snapshot_authorization_then_boot_zero(client):
    """Accepted evidence remains complete after the ordered automatic recovery."""
    trace, trace_ack = _post_fault_trace(
        client, incident_id='incident-0000000000000011')
    snapshot = _correlated_snapshot(trace, trace_ack)
    snapshot_reply = client.post(
        '/hardware/wukong/snapshot', data=json.dumps(snapshot),
        content_type='application/json').get_json()
    assert snapshot_reply['decision'] == 'promoted'

    authorization = {
        'incident_id': trace['incident_id'],
        'bridge_session': trace['bridge_session'],
        'authorization_id': 'authorization-0000000000000001',
    }
    auth_reply = client.post(
        '/hardware/wukong/recovery-authorization',
        data=json.dumps(authorization),
        content_type='application/json').get_json()
    duplicate_auth = client.post(
        '/hardware/wukong/recovery-authorization',
        data=json.dumps(authorization),
        content_type='application/json').get_json()
    assert auth_reply['decision'] == 'recovery_authorized'
    assert duplicate_auth['decision'] == 'duplicate'

    boot_zero = {
        'nia': 0, 'ev_type': 0, 'payload_gt': 0, 'flags': 0,
        'fault_code': 0, 'fault_valid': False, 'bp_hit': False,
        'ts': time.time(),
    }
    assert client.post(
        '/hardware/wukong/trace', data=json.dumps(boot_zero),
        content_type='application/json').status_code == 200

    events = client.get('/hardware/wukong/events?after=0').get_json()['events']
    assert [event.get('event', 'trace' if not event.get('snapshot') else
                      'snapshot') for event in events] == [
        'trace', 'snapshot', 'recovery_authorized', 'trace']
    assert [event['seq'] for event in events] == [1, 2, 3, 4]

    status = client.get('/hardware/wukong/status').get_json()
    accepted = status['last_accepted_fault']
    assert status['latest_trace']['nia'] == 0
    assert status['halt']['state'] == 'running'
    assert accepted['incident_id'] == trace['incident_id']
    assert accepted['recovery_authorized'] is True
    assert accepted['cr'][0] == [0, 1, 2]
    assert accepted['cr'][15] == [15, 16, 17]
    assert accepted['dr'][0] == 0x100
    assert accepted['dr'][15] == 0x10F