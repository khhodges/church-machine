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