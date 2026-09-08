"""Fail-closed physical target correlation for Task #3330."""

import base64
import hashlib
import json
import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as app_module


@pytest.fixture()
def client():
    app_module.app.config['TESTING'] = True
    with app_module._wukong_command_lock:
        app_module._wukong_pending_cmd = None
        app_module._wukong_cmd_delivery = None
        app_module._wukong_cmd_id = 0
    with app_module._wukong_bridge_lock:
        app_module._wukong_bridge_info.clear()
    with app_module._upload_in_flight_lock:
        app_module._upload_in_flight = False
    with app_module._wukong_upload_ack_lock:
        app_module._wukong_upload_ack = {}
    with app_module.app.test_client() as test_client:
        yield test_client


def _bridge(client, uid='board-a', session='bridge-a'):
    return client.post('/hardware/wukong/bridge-status', json={
        'device_uid': uid, 'session_id': session, 'event': 'session_started',
        'state': 'connected',
    })


def test_command_requires_exact_live_target_and_matching_consumer(client):
    assert client.post('/hardware/wukong/command', json={'cmd': 's'}).status_code == 409
    assert _bridge(client).status_code == 200
    queued = client.post('/hardware/wukong/command', json={
        'cmd': 's', 'target_device_uid': 'board-a',
        'target_session_id': 'bridge-a',
    })
    assert queued.status_code == 200
    command_id = queued.get_json()['id']
    wrong = client.get('/hardware/wukong/command', headers={
        'X-Wukong-Session': 'bridge-a', 'X-Wukong-Device-UID': 'board-b',
    })
    assert wrong.status_code == 409
    got = client.get('/hardware/wukong/command', headers={
        'X-Wukong-Session': 'bridge-a', 'X-Wukong-Device-UID': 'board-a',
    }).get_json()
    assert got['id'] == command_id and got['target_device_uid'] == 'board-a'


def test_runtime_ack_must_echo_consumed_target_and_artifact_identity(client):
    _bridge(client)
    raw = b'board runtime image'
    digest = hashlib.sha256(raw).hexdigest()
    queued = client.post('/hardware/wukong/command', json={
        'cmd': 'u', 'data': base64.b64encode(raw).decode(),
        'target_device_uid': 'board-a', 'target_session_id': 'bridge-a',
        'artifact_sha256': digest, 'artifact_size': len(raw),
        'artifact_identity': 'boot-image:test',
    }).get_json()
    client.get('/hardware/wukong/command', headers={
        'X-Wukong-Session': 'bridge-a', 'X-Wukong-Device-UID': 'board-a',
    })
    bad = client.post('/hardware/wukong/upload-ack', json={
        'id': queued['id'], 'ok': True, 'target_device_uid': 'board-a',
        'session_id': 'bridge-a', 'artifact_sha256': digest,
        'artifact_size': len(raw), 'artifact_identity': 'other',
    })
    assert bad.status_code == 409
    good = client.post('/hardware/wukong/upload-ack', json={
        'id': queued['id'], 'ok': True, 'target_device_uid': 'board-a',
        'session_id': 'bridge-a', 'artifact_sha256': digest,
        'artifact_size': len(raw), 'artifact_identity': 'boot-image:test',
    })
    assert good.get_json()['accepted'] is True