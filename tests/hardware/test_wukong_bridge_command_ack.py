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
import types

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


def test_main_reconnects_after_read_failure_and_acknowledges_after_write(
        monkeypatch):
    """The long-running loop survives a dead UART and finds its new port.

    This deliberately drives ``main`` rather than only testing the command
    helper: a read exception must not terminate the bridge or start a new
    session, and a consumed command must not look delivered before its write
    acknowledgement reaches the server.
    """
    timeline = []
    serials = []
    command_pending = True

    class FakeSerial:
        def __init__(self, port, baud, timeout):
            self.port = port
            self.written = []
            self.read_count = 0
            serials.append(self)

        def read(self, _size):
            self.read_count += 1
            if self.port == '/dev/ttyUSB0':
                raise OSError('USB read failed')
            if self.read_count == 1:
                return b''
            raise KeyboardInterrupt

        def write(self, data):
            timeline.append(('serial_write', self.port, bytes(data)))
            self.written.append(bytes(data))

        def reset_input_buffer(self):
            timeline.append(('flush', self.port))

        def close(self):
            timeline.append(('close', self.port))

    class FakeResponse:
        status_code = 200

        def __init__(self, body):
            self.body = body

        def json(self):
            return self.body

    class FakeRequests:
        def post(self, url, json=None, headers=None, timeout=None, verify=None):
            event = ('post', url, dict(json or {}), 1000 + len(timeline))
            timeline.append(event)
            return FakeResponse({})

        def get(self, url, headers=None, timeout=None, verify=None):
            nonlocal command_pending
            if command_pending:
                command_pending = False
                timeline.append(('command_consumed', 1000 + len(timeline)))
                return FakeResponse({'cmd': 's', 'id': 314})
            return FakeResponse({})

    class FakeTime:
        def __init__(self):
            self.now = 2000.0

        def time(self):
            self.now += 0.01
            return self.now

        def sleep(self, _seconds):
            pass

    class FakeUUID:
        @staticmethod
        def uuid4():
            return types.SimpleNamespace(hex='stable-bridge-session')

    fake_time = FakeTime()
    fake_requests = FakeRequests()
    delivery_workers = []
    real_delivery_worker = bridge.FaultDeliveryWorker

    class CapturingDeliveryWorker(real_delivery_worker):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            delivery_workers.append(self)

    fake_serial_module = types.SimpleNamespace(
        Serial=FakeSerial,
        SerialException=OSError,
    )
    monkeypatch.setattr(bridge, 'serial', fake_serial_module)
    monkeypatch.setattr(bridge, 'requests', fake_requests)
    monkeypatch.setattr(bridge, 'FaultDeliveryWorker',
                        CapturingDeliveryWorker)
    monkeypatch.setattr(bridge, 'time', fake_time)
    monkeypatch.setattr(bridge, 'uuid', FakeUUID)
    monkeypatch.setattr(bridge, '_compute_expected_n_init', lambda: None)
    monkeypatch.setattr(bridge, '_available_serial_ports',
                        lambda: ['/dev/ttyUSB0'])
    monkeypatch.setattr(bridge, '_find_serial_port',
                        lambda preferred=None: '/dev/ttyUSB1')
    monkeypatch.setattr(sys, 'argv', [
        'wukong_bridge.py', '--port=/dev/ttyUSB0', '--ide=http://ide.test',
    ])

    bridge.main()
    assert len(delivery_workers) == 1
    delivery_workers[0].wait_for_idle()
    delivery_workers[0].close()

    assert [ser.port for ser in serials] == [
        '/dev/ttyUSB0', '/dev/ttyUSB1',
    ]
    assert serials[1].written == [b's']

    status_posts = [
        entry for entry in timeline
        if entry[0] == 'post' and entry[1].endswith('/bridge-status')
    ]
    assert [entry[2]['event'] for entry in status_posts] == [
        'session_started', 'serial_read_error', 'reconnect_attempt',
        'reconnected',
    ]
    assert all(entry[2]['session_id'] == 'stable-bridge-session'
               for entry in status_posts)
    assert status_posts[-1][2]['serial_port'] == '/dev/ttyUSB1'
    assert all(isinstance(entry[3], (int, float)) for entry in status_posts)
    assert status_posts[-1][3] > status_posts[0][3]

    command_index = next(i for i, entry in enumerate(timeline)
                         if entry[0] == 'command_consumed')
    write_index = next(i for i, entry in enumerate(timeline)
                       if entry[0] == 'serial_write')
    ack_index = next(i for i, entry in enumerate(timeline)
                     if entry[0] == 'post'
                     and entry[1].endswith('/command-ack'))
    assert command_index < write_index < ack_index
    assert timeline[ack_index][2] == {
        'cmd': 's', 'ok': True, 'error': '', 'id': 314,
        'session_id': 'stable-bridge-session', 'trace_counter': 0,
    }
