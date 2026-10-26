"""Replay the retained physical trial, not a synthesized substitute program."""
import copy
import json
import random
from pathlib import Path

import pytest
from test_wukong_snapshot import (
    client, _app_module as server, _snapshot, _correlated_snapshot,
)


@pytest.fixture(autouse=True)
def isolated_bridge(monkeypatch):
    monkeypatch.setattr(server, '_wukong_bridge_info', {})
    monkeypatch.setattr(server, '_wukong_bridge_trace_highwater', {})
    monkeypatch.setattr(server, '_wukong_control_auth', lambda: (True, None))


def retained_packets():
    path = Path(__file__).resolve().parents[2] / (
        'docs/phase-1/reload-evidence/new-layout-amoeba-runtime/'
        'physical-runtime-reload-events.json')
    events = json.loads(path.read_text())['events']
    packets = [copy.deepcopy(e) for e in events if 'ev_type' in e]
    assert sorted(e['bridge_trace_counter'] for e in packets) == list(range(1, 40))
    session = next(e['bridge_session'] for e in packets if e.get('bridge_session'))
    # Historical server dropped ordinary tags. Explicit replay envelope only:
    # the retained source file remains unchanged, not retroactively attested.
    for packet in packets:
        packet['bridge_session'] = session
    return packets, session


@pytest.mark.parametrize('order', ['recorded', 'reverse', 'shuffle'])
def test_retained_39_packet_replay(client, order):
    packets, session = retained_packets()
    if order == 'reverse':
        packets.sort(key=lambda p: -p['bridge_trace_counter'])
    elif order == 'shuffle':
        random.Random(3862).shuffle(packets)
    highest = 0
    for packet in packets:
        reply = client.post('/hardware/wukong/trace', json=packet)
        assert reply.status_code == 200, reply.get_json()
        highest = max(highest, packet['bridge_trace_counter'])
        latest = client.get('/hardware/wukong/trace').get_json()
        assert latest['bridge_trace_counter'] == highest
        assert latest['bridge_session'] == session
        if packet['fault_valid']:
            snap = _correlated_snapshot(packet, reply.get_json())
            assert client.post('/hardware/wukong/snapshot', json=snap).status_code == 200
        if highest >= 38:
            assert latest['fault_valid'] and latest['nia'] == 0x2e08
    status = client.get('/hardware/wukong/status').get_json()
    assert status['latest_trace']['bridge_trace_counter'] == 39
    assert status['latest_trace']['fault_valid']
    assert server._fault_snapshot['snapshot_complete']
    fault39 = next(p for p in packets if p['bridge_trace_counter'] == 39)
    assert status['fault_candidate']['incident_id'] == fault39['incident_id']
    assert status['last_accepted_fault']['incident_id'] == fault39['incident_id']
    stored = client.get('/api/fault-snapshot').get_json()
    assert stored['incident_id'] == fault39['incident_id']
    assert stored['bridge_trace_counter'] == 39
    events = client.get('/hardware/wukong/events').get_json()['events']
    traces = [e for e in events if 'ev_type' in e]
    assert len(traces) == 39
    assert all(e['bridge_session'] == session for e in traces)
    assert sorted(e['bridge_trace_counter'] for e in traces) == list(range(1, 40))


def test_duplicates_legacy_and_old_sessions_cannot_clear_fault(client):
    def post(counter, session='a', fault=False):
        response = client.post('/hardware/wukong/trace', json={
            'bridge_session': session, 'bridge_trace_counter': counter,
            'ev_type': 0, 'nia': counter, 'fault_valid': fault,
        })
        assert response.status_code == 200
    post(39, fault=True)
    post(39)  # duplicate counter, even a conflicting payload, is history only
    post(38)
    post(-1, '')
    post(400, 'unannounced')
    assert server._wukong_latest_trace['fault_valid']
    post(40)
    assert not server._wukong_latest_trace['fault_valid']
    server._wukong_bridge_info['session_id'] = 'b'
    post(1, 'b', True)
    post(401, 'a')
    assert server._wukong_latest_trace['bridge_session'] == 'b'
    assert server._wukong_latest_trace['fault_valid']
