"""
tests/hardware/test_wukong_bridge_command_ack.py

Task 2491: the bridge must report serial-write success/failure back to the
server (POST /hardware/wukong/command-ack) after dequeuing a command, so a
consumed-but-unwritten command (e.g. Reboot 'f' lost to a dead serial port)
is never silent.

Unit-tests hardware.wukong_bridge.execute_board_command with a mocked serial
object and a monkeypatched requests.post.
"""

import os
import struct
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import hardware.wukong_bridge as bridge


class FakeSerial:
    def __init__(self, fail=False):
        self.fail = fail
        self.written = []

    def write(self, data):
        if self.fail:
            raise OSError('port dead')
        self.written.append(bytes(data))


@pytest.fixture()
def acks(monkeypatch):
    """Capture all command-ack POSTs made by the bridge."""
    posted = []

    def fake_post(url, json=None, timeout=None, verify=None):
        posted.append({'url': url, 'json': json})

        class R:
            status_code = 200
        return R()

    monkeypatch.setattr(bridge.requests, 'post', fake_post)
    return posted


IDE = 'http://ide.test'


def _run(cmd, ser, data=None, reopen=None, buf=None):
    if data is None:
        data = {}
    data.setdefault('id', 42)
    return bridge.execute_board_command(
        cmd, data, ser,
        reopen or (lambda: ser),
        buf if buf is not None else bytearray(),
        IDE, True)


class TestWriteSuccess:
    def test_simple_command_write_posts_ok_ack(self, acks):
        ser = FakeSerial()
        _run('s', ser)
        assert ser.written == [b's']
        assert len(acks) == 1
        assert acks[0]['url'] == IDE + '/hardware/wukong/command-ack'
        assert acks[0]['json'] == {'cmd': 's', 'ok': True, 'error': '',
                                   'id': 42}

    def test_snapshot_command_writes_q_and_posts_ok_ack(self, acks):
        ser = FakeSerial()
        _run('q', ser)
        assert ser.written == [b'q']
        assert acks[-1]['json'] == {'cmd': 'q', 'ok': True, 'error': '',
                                    'id': 42}

    def test_breakpoint_command_writes_nia(self, acks):
        ser = FakeSerial()
        _run('b', ser, data={'nia': 0x200})
        assert ser.written == [b'b' + struct.pack('>I', 0x200)]
        assert acks[-1]['json']['ok'] is True

    def test_f_reopens_serial_clears_buf_and_acks(self, acks):
        old = FakeSerial()
        new = FakeSerial()
        buf = bytearray(b'\xaa\x01stale')
        out = _run('f', old, reopen=lambda: new, buf=buf)
        assert out is new, "'f' must use the reopened serial object"
        assert new.written == [b'f']
        assert old.written == []
        assert buf == bytearray(), "'f' must clear the stale receive buffer"
        assert acks[-1]['json'] == {'cmd': 'f', 'ok': True, 'error': '',
                                    'id': 42}


class TestWriteFailure:
    def test_write_failure_posts_failure_ack(self, acks):
        ser = FakeSerial(fail=True)
        out = _run('f', ser)
        assert out is ser
        assert len(acks) == 1
        j = acks[0]['json']
        assert j['cmd'] == 'f'
        assert j['id'] == 42, 'failure ack must echo the command id'
        assert j['ok'] is False
        assert 'serial write failed' in j['error']
        assert 'port dead' in j['error']

    def test_reopen_failure_still_reports(self, acks):
        def bad_reopen():
            raise RuntimeError('no usb ports found')
        out = _run('f', FakeSerial(), reopen=bad_reopen)
        j = acks[-1]['json']
        assert j['ok'] is False
        assert 'no usb ports found' in j['error']

    def test_unknown_command_reports_failure(self, acks):
        _run('z', FakeSerial())
        j = acks[-1]['json']
        assert j['cmd'] == 'z'
        assert j['ok'] is False

    def test_read_or_write_serial_exception_is_reported(self, acks):
        """A consumed command with a dead UART produces an explicit failure."""
        ser = FakeSerial(fail=True)
        _run('s', ser, data={'id': 99})
        assert acks[-1]['json'] == {
            'cmd': 's', 'ok': False, 'error': 'serial write failed: port dead',
            'id': 99,
        }

    def test_serial_write_exception_ack_includes_bridge_session(self, acks):
        ser = FakeSerial(fail=True)
        bridge.execute_board_command('s', {'id': 100}, ser,
                                     lambda: ser, bytearray(), IDE, True,
                                     session_id='bridge-session-1')
        assert acks[-1]['json']['session_id'] == 'bridge-session-1'
        assert acks[-1]['json']['id'] == 100

    def test_ack_post_failure_never_raises(self, monkeypatch):
        def boom(*a, **k):
            raise ConnectionError('server down')
        monkeypatch.setattr(bridge.requests, 'post', boom)
        ser = FakeSerial()
        _run('s', ser)          # must not raise
        assert ser.written == [b's']
