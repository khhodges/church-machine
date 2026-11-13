"""Passive UCV4 decoding must never reach legacy command/control paths."""
import binascii
import struct

import pytest

from hardware import wukong_bridge as bridge


def frame(sequence=655190, epoch=2, fault=0, image=None):
    image = image or next(iter(bridge.UCV4_IMAGES))
    fields = [epoch, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0,
              0x71b8420e, 0xe370841e, fault, 0x017d7751]
    body = (b'UCV4' + struct.pack('>I', sequence) + bytes.fromhex(image)
            + bytes.fromhex(bridge.UCV4_INPUTS) + struct.pack('>16I', *fields))
    return body + struct.pack('>H', binascii.crc_hqx(body, 0xffff))


def test_captured_packet_crc_and_identity():
    raw = frame()
    # Independently observed CRC from the operator's passive capture.
    assert raw[-2:] == b'\x87\xbe'
    report = bridge.decode_ucv4(raw)
    assert report['sequence'] == 655190
    assert report['image_label'] == 'USER B'
    assert report['known_inputs'] is True
    assert report['epoch'] == 2
    assert report['fault_seen'] == 0
    assert report['progress'] == 1907900942


@pytest.mark.parametrize('offset', range(138))
def test_mid_frame_attach_and_fragmented_reads(offset):
    raw = frame()[offset:] + frame(655191)
    parser = bridge.UCV4Stream()
    reports = []
    for byte in raw:
        reports += parser.feed(bytes([byte]))
    assert reports[-1]['sequence'] == 655191
    assert len(parser.buffer) < bridge.UCV4_SIZE


def test_crc_failure_never_becomes_a_report_and_recovers():
    bad = bytearray(frame())
    bad[80:84] = b'\xbc\xaa\xbbq'
    parser = bridge.UCV4Stream()
    reports = parser.feed(bytes(bad) + frame(655191))
    assert [r['sequence'] for r in reports] == [655191]
    assert parser.bad_crc == 1
    with pytest.raises(ValueError, match='CRC'):
        bridge.decode_ucv4(bytes(bad))


def test_unknown_identity_and_fault_are_not_hidden():
    report = bridge.decode_ucv4(frame(fault=1, image='01' * 32))
    assert report['image_label'] == 'Unknown image'
    assert report['fault_seen'] == 1


def test_noise_buffer_is_bounded():
    parser = bridge.UCV4Stream()
    assert parser.feed(b'\xbc' * 100000) == []
    assert len(parser.buffer) == 3


class PassiveSerial:
    def __init__(self, chunks):
        self.chunks = iter(chunks)
        self.closed = False

    def write(self, *args):
        pytest.fail('Passive path attempted a UART write')

    def close(self):
        self.closed = True


def reader(ser):
    try:
        return next(ser.chunks)
    except StopIteration:
        raise KeyboardInterrupt


def test_auto_detection_is_passive_and_retains_bytes(monkeypatch):
    monkeypatch.setattr(bridge, 'read_available_serial', reader)
    port = PassiveSerial([b'\xaa\xbcnoiseUC', b'V4' + frame()[4:]])
    protocol, raw = bridge.select_bridge_protocol(port, 'auto')
    assert protocol == 'ucv4'
    assert raw.endswith(frame())


def test_unknown_protocol_never_falls_back_to_legacy(monkeypatch):
    monkeypatch.setattr(bridge, 'read_available_serial', lambda _: b'\xbc\xaa')
    times = iter([0, 1, 2, 4])
    with pytest.raises(ValueError, match='No commands were sent'):
        bridge.select_bridge_protocol(PassiveSerial([]), 'auto', lambda: next(times))


def test_monitor_gap_epoch_fault_and_stale_are_visible_without_writes(monkeypatch):
    monkeypatch.setattr(bridge, 'read_available_serial', reader)
    port = PassiveSerial([frame(655193), frame(1, epoch=3, fault=1), b'', b''])
    output = []
    now = [0]

    def clock():
        now[0] += 2
        return now[0]

    bridge.monitor_ucv4(port, frame(), out=output.append, clock=clock)
    assert port.closed
    text = '\n'.join(output)
    assert 'Sequence gap' in text
    assert text.count('New observation identity') == 2
    assert '"fault_seen": 1' in text
    assert 'STALE' in text


@pytest.mark.parametrize('protocol', ['auto', 'ucv4'])
def test_main_monitor_never_starts_command_poll_or_legacy_parser(monkeypatch, protocol):
    from types import SimpleNamespace
    port = PassiveSerial([frame()])
    port.open = lambda: None
    monkeypatch.setattr(bridge, 'serial', SimpleNamespace(
        Serial=lambda **_: port, SerialException=OSError))
    monkeypatch.setattr(bridge.sys, 'argv', [
        'wukong_bridge.py', '--port', 'COM4', '--protocol', protocol])
    monkeypatch.setattr(bridge.sys, 'platform', 'linux')
    monkeypatch.setattr(bridge, 'configured_device_uid', lambda _: 'test-board')
    monkeypatch.setattr(bridge, '_available_serial_ports', lambda: ['COM4'])
    monkeypatch.setattr(bridge, 'read_available_serial', reader)

    def forbidden(*args, **kwargs):
        pytest.fail('Read-only mode entered legacy/network control path')

    for name in ('CommandPoll', 'StreamSync', 'FaultDeliveryWorker'):
        monkeypatch.setattr(bridge, name, forbidden)
    assert bridge.main() == 0
    assert port.closed
    assert port.dtr is False and port.rts is False
