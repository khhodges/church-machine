"""Focused tests for the read-only Wukong architectural snapshot protocol."""

import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from hardware import wukong_bridge as wb


def _frame():
    payload = bytes([3, 0x0D, 1, 0])
    payload += b''.join(struct.pack('>I', x) for x in range(0x10, 0x16))
    payload += b''.join(struct.pack('>III', i, i + 1, i + 2)
                        for i in range(16))
    payload += b''.join(struct.pack('>I', 0xA000 + i) for i in range(16))
    assert len(payload) == wb.SNAPSHOT_PAYLOAD_LEN
    header = bytes([wb.SNAPSHOT_MAGIC, wb.SNAPSHOT_VERSION])
    header += struct.pack('>HH', len(payload), 0x1234)
    body = header + payload
    return body + struct.pack('>H', wb._crc16_ccitt(body))


def test_snapshot_round_trip_contains_live_and_stored_context():
    decoded = wb.decode_snapshot_frame(_frame())
    assert decoded['snapshot'] is True
    assert decoded['reason'] == 3
    assert decoded['flags'] == 0x0D
    assert decoded['m_flag'] is True
    assert decoded['nia'] == 0x10
    assert decoded['stored_cr12_gt'] == 0x13
    assert decoded['stored_packed_pc'] == 0x14
    assert decoded['stored_mflag'] == 0x15
    assert decoded['cr'][15] == [15, 16, 17]
    assert decoded['dr'][15] == 0xA00F


def test_snapshot_parser_rejects_truncation_and_bad_crc():
    frame = _frame()
    assert wb.try_parse_snapshot_frame(bytearray(frame[:-1])) is False
    broken = bytearray(frame)
    broken[-1] ^= 0x01
    assert wb.try_parse_snapshot_frame(broken) is None