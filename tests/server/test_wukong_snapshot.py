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


def _snapshot():
    return {
        'snapshot': True,
        'version': 1,
        'seq': 4,
        'reason': 3,
        'flags': 0x0D,
        'm_flag': True,
        'nia': 0x1234,
        'sto': 0x55,
        'thread_base': 0x220,
        'stored_cr12_gt': 0xA1,
        'stored_packed_pc': 0xB2,
        'stored_mflag': 0xC3,
        'cr': [[i, i + 1, i + 2] for i in range(16)],
        'dr': [0x100 + i for i in range(16)],
        'crc16': 0xCAFE,
        'ts': time.time(),
    }


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
    assert status['latest_snapshot']['nia'] == 0x1234
    assert status['latest_snapshot']['stored_cr12_gt'] == 0xA1


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
    fault_trace = {
        'nia': 0x164, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0x0D, 'fault_code': 3, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
    }
    trace_response = client.post('/hardware/wukong/trace', data=json.dumps(fault_trace),
                                 content_type='application/json')
    assert trace_response.status_code == 200
    snapshot = _snapshot()
    snapshot['reason'] = 2
    trace_ack = trace_response.get_json()
    snapshot['fault_trace_seq'] = trace_ack['seq']
    snapshot['fault_boot_id'] = trace_ack['boot_id']
    assert client.post('/hardware/wukong/snapshot', data=json.dumps(snapshot),
                       content_type='application/json').status_code == 200

    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['snapshot_complete'] is True
    assert stored['fault_code'] == 3
    assert stored['fault_message'] == 'PERM_X'
    assert stored['nia'] == 0x164
    assert stored['cr'][15] == [15, 16, 17]
    assert stored['dr'][15] == 0x10F

    # A late trace-only browser POST and Boot.0's clean event must not erase it.
    assert client.post('/api/fault-snapshot', data=json.dumps(partial),
                       content_type='application/json').get_json()['stored'] is False
    boot_zero = dict(fault_trace, nia=0, fault_code=0, fault_valid=False)
    assert client.post('/hardware/wukong/trace', data=json.dumps(boot_zero),
                       content_type='application/json').status_code == 200
    after_boot = client.get('/api/fault-snapshot').get_json()
    assert after_boot['snapshot_complete'] is True
    assert after_boot['nia'] == 0x164


def test_new_fault_snapshot_uses_its_own_trace_metadata_not_prior_fault(client):
    first = {
        'fault_code': 1, 'fault_message': 'PERM_R', 'nia': 0x100,
        'pc': 0x100, 'source': 'hardware', 'snapshot_complete': False,
    }
    assert client.post('/api/fault-snapshot', data=json.dumps(first),
                       content_type='application/json').status_code == 200
    newer_trace = {
        'nia': 0x164, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0, 'fault_code': 3, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
    }
    trace_response = client.post('/hardware/wukong/trace', data=json.dumps(newer_trace),
                                 content_type='application/json')
    assert trace_response.status_code == 200
    newer_snapshot = _snapshot()
    newer_snapshot['reason'] = 2
    trace_ack = trace_response.get_json()
    newer_snapshot['fault_trace_seq'] = trace_ack['seq']
    newer_snapshot['fault_boot_id'] = trace_ack['boot_id']
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
    assert client.post('/hardware/wukong/snapshot',
                       data=json.dumps(fault_reason_snapshot),
                       content_type='application/json').status_code == 200

    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['fault_code'] == 1
    assert stored['fault_message'] == 'PERM_R'
    assert stored['snapshot_complete'] is True


def test_incomplete_fault_snapshot_never_authorizes_recovery(client):
    """A fault trace alone, or an incomplete AC payload, cannot authorize g."""
    before = client.get('/api/fault-snapshot').get_json()
    trace = {
        'nia': 0x164, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0, 'fault_code': 3, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
    }
    trace_response = client.post('/hardware/wukong/trace', data=json.dumps(trace),
                                 content_type='application/json')
    trace_meta = trace_response.get_json()
    incomplete = _snapshot()
    incomplete['reason'] = 2
    incomplete['cr'] = incomplete['cr'][:-1]
    incomplete['fault_trace_seq'] = trace_meta['seq']
    incomplete['fault_boot_id'] = trace_meta['boot_id']
    response = client.post('/hardware/wukong/snapshot',
                           data=json.dumps(incomplete),
                           content_type='application/json')
    assert response.status_code == 400
    assert response.get_json().get('promoted') is not True
    assert client.get('/api/fault-snapshot').get_json() == before


def test_fault_snapshot_uses_correlated_trace_even_after_competing_events(client):
    """A clean or another fault-valid trace cannot hijack an armed recovery."""
    fault_a = {
        'nia': 0x164, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0, 'fault_code': 3, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
    }
    trace_a = client.post('/hardware/wukong/trace', data=json.dumps(fault_a),
                          content_type='application/json')
    assert trace_a.status_code == 200
    clean = dict(fault_a, nia=0, fault_code=0, fault_valid=False)
    fault_b = dict(fault_a, nia=0x200, fault_code=1, fault_valid=True)
    assert client.post('/hardware/wukong/trace', data=json.dumps(clean),
                       content_type='application/json').status_code == 200
    assert client.post('/hardware/wukong/trace', data=json.dumps(fault_b),
                       content_type='application/json').status_code == 200

    snapshot = _snapshot()
    snapshot['reason'] = 2
    trace_ack = trace_a.get_json()
    snapshot['fault_trace_seq'] = trace_ack['seq']
    snapshot['fault_boot_id'] = trace_ack['boot_id']
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
    fault_a = {
        'nia': 0x164, 'ev_type': 0, 'payload_gt': 0,
        'flags': 0, 'fault_code': 3, 'fault_valid': True,
        'bp_hit': False, 'ts': time.time(),
    }
    old_trace = client.post('/hardware/wukong/trace', data=json.dumps(fault_a),
                            content_type='application/json').get_json()

    # Simulate a process restart: the queue sequence restarts and an unrelated
    # fault is assigned the same numeric sequence under a fresh BOOT_ID.
    monkeypatch.setattr(_app_module, 'BOOT_ID', 'new-server-generation')
    _reset()
    unrelated = dict(fault_a, nia=0x200, fault_code=1)
    new_trace = client.post('/hardware/wukong/trace', data=json.dumps(unrelated),
                            content_type='application/json').get_json()
    assert old_trace['seq'] == new_trace['seq'] == 1
    assert old_trace['boot_id'] == original_boot_id
    assert new_trace['boot_id'] == 'new-server-generation'

    snapshot = _snapshot()
    snapshot['reason'] = 2
    snapshot['fault_trace_seq'] = old_trace['seq']
    snapshot['fault_boot_id'] = old_trace['boot_id']
    response = client.post('/hardware/wukong/snapshot', data=json.dumps(snapshot),
                           content_type='application/json')
    assert response.status_code == 200
    assert response.get_json()['promoted'] is False