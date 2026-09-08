"""Focused target-routing payload checks for the production Wukong bridge."""

import base64
import hashlib
import os
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import hardware.wukong_bridge as bridge


class UploadSerial:
    def __init__(self):
        self.written = []
        self.in_waiting = 0
        self._ack = False

    def read(self, _count):
        if self._ack:
            self._ack = False
            return b'\x06'
        return b''

    def write(self, data):
        self.written.append(bytes(data))
        self._ack = True

    def flush(self):
        pass


def test_upload_ack_and_uart_frame_keep_the_consumed_artifact_identity(
        monkeypatch):
    source = struct.pack('<I', 0x11223344)
    command = {
        'id': 93,
        'data': base64.b64encode(source).decode('ascii'),
        'artifact_sha256': hashlib.sha256(source).hexdigest(),
        'artifact_size': len(source),
        'artifact_identity': 'boot-image:93',
        'target_device_uid': 'board-A',
        'target_session_id': 'session-A',
    }
    posted = []
    monkeypatch.setattr(
        bridge.requests, 'post',
        lambda url, **kwargs: posted.append((url, kwargs['json'])))
    ser = UploadSerial()

    bridge._handle_upload(command, ser, 'https://ide.example', True,
                          'session-A', 'board-A')

    # UART bytes remain the board's native u + BE-length + word-swapped frame.
    assert ser.written == [b'u' + struct.pack('>I', 4) + b'\x11\x22\x33\x44']
    assert posted == [(
        'https://ide.example/hardware/wukong/upload-ack',
        {
            'ok': True, 'error': '', 'id': 93,
            'target_device_uid': 'board-A', 'device_uid': 'board-A',
            'session_id': 'session-A',
            'artifact_sha256': command['artifact_sha256'],
            'artifact_size': 4, 'artifact_identity': 'boot-image:93',
        },
    )]


def test_target_matching_rejects_another_live_bridge_session():
    command = {
        'target_device_uid': 'board-A',
        'target_session_id': 'session-A',
    }
    assert bridge._command_target_matches(command, 'board-A', 'session-A')
    assert not bridge._command_target_matches(command, 'board-A', 'session-B')
    assert not bridge._command_target_matches(command, 'board-B', 'session-A')


def test_all_protected_bridge_posts_use_report_token_and_exact_target(
        monkeypatch):
    monkeypatch.setenv('REPORT_TOKEN', 'existing-report-token')
    calls = []

    class Response:
        status_code = 200
        content = b'{}'

        def __init__(self, url):
            self.url = url

        def json(self):
            if self.url.endswith('/trace'):
                return {'accepted': True, 'seq': 1, 'boot_id': 'boot-1'}
            if self.url.endswith('/snapshot'):
                return {
                    'accepted': True, 'promoted': True,
                    'decision': 'promoted',
                }
            if self.url.endswith('/recovery-authorization'):
                return {'accepted': True, 'decision': 'recovery_authorized'}
            return {'accepted': True}

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return Response(url)

    monkeypatch.setattr(bridge.requests, 'post', post)
    uid = 'board-exact'
    session = 'session-exact'
    worker = bridge.FaultDeliveryWorker(
        'https://ide.example', True, session_id=session, device_uid=uid)
    try:
        for kind in ('status', 'console', 'boot_info', 'halt_state', 'trace',
                     'snapshot', 'recovery_authorization'):
            worker.submit(kind, {'kind': kind})
        worker.wait_for_idle()
    finally:
        worker.close()

    bridge.post_command_ack(
        'https://ide.example', True, 's', True, cmd_id=17,
        session_id=session, device_uid=uid)
    bridge._post_upload_ack(
        {
            'id': 18, 'artifact_sha256': 'a' * 64, 'artifact_size': 4,
            'artifact_identity': 'boot-image:18',
        },
        True, '', 'https://ide.example', True, session, uid)

    protected = {
        'bridge-status', 'console', 'boot-info', 'halt-state', 'trace',
        'snapshot', 'recovery-authorization', 'command-ack', 'upload-ack',
    }
    assert {url.rsplit('/', 1)[-1] for url, _ in calls} == protected
    for _url, kwargs in calls:
        assert kwargs['headers'] == {
            'Authorization': 'Bearer existing-report-token',
        }
        assert kwargs['json']['session_id'] == session
        assert kwargs['json']['device_uid'] == uid