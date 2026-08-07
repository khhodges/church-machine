"""scripts/test_wukong_trace_decode.py — Unit tests for wukong_bridge decode_trace_packet().

Exercises every TRACE_EV_* case, with emphasis on the 3-packet CALL sequence
(CALL_CR6 / CALL_CR14 / CALL_PUSH) that ELOADCALL and XLOADLAMBDA retires emit.

Run:
    python -m pytest scripts/test_wukong_trace_decode.py -v
"""

import struct
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'hardware'))

from wukong_bridge import (
    decode_trace_packet,
    TRACE_MAGIC,
    TRACE_LEN,
    TRACE_EV_RESULT,
    TRACE_EV_LOAD_SHADOW,
    TRACE_EV_LOAD_NEW,
    TRACE_EV_CHANGE_PUSH,
    TRACE_EV_CHANGE_CR12,
    TRACE_EV_CHANGE_CR5,
    TRACE_EV_CALL_CR6,
    TRACE_EV_CALL_CR14,
    TRACE_EV_CALL_PUSH,
    TRACE_EV_RETURN_POP,
    TRACE_EV_RETURN_CR6,
    TRACE_EV_RETURN_CR14,
)


# ── Packet builder ─────────────────────────────────────────────────────────────

def _make_packet(nia, ev_type, payload_gt=0, flags=0, fault_code=0,
                 fault_valid=False, bp_hit=False):
    """Build a valid 12-byte trace packet."""
    raw11 = (fault_code & 0x1F) | (0x40 if fault_valid else 0) | (0x80 if bp_hit else 0)
    return bytes([TRACE_MAGIC]) + struct.pack('>I', nia) + bytes([ev_type]) + \
           struct.pack('>I', payload_gt) + bytes([flags, raw11])


# ── Sanity: packet length ──────────────────────────────────────────────────────

def test_make_packet_length():
    pkt = _make_packet(0xDEAD0000, TRACE_EV_RESULT)
    assert len(pkt) == TRACE_LEN == 12


# ── CALL sequence: ELOADCALL / XLOADLAMBDA ────────────────────────────────────
#
# Hardware TraceUnit emits 3 consecutive packets per ELOADCALL/XLOADLAMBDA:
#   [0] CALL_CR6   ev_type=0x06  payload = abstraction GT word0
#   [1] CALL_CR14  ev_type=0x07  payload = code/return GT word0
#   [2] CALL_PUSH  ev_type=0x08  payload = 0 (stack push, no GT)
#
# The bridge must forward each packet with the correct ev_type and payload_gt
# so the IDE can update CR6 and CR14.

NIA_ELOADCALL = 0x00000700   # arbitrary instruction address

ABSTRACTION_GT = 0xA0000005  # example abstraction GT word0 for CR6
RETURN_GT      = 0xB0000006  # example return GT word0 for CR14


def test_call_cr6_ev_type_and_payload():
    """CALL_CR6 packet: ev_type=0x06, payload_gt = abstraction GT word0."""
    pkt = _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR6, payload_gt=ABSTRACTION_GT)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_CALL_CR6 == 0x06
    assert d['payload_gt'] == ABSTRACTION_GT
    assert d['nia']        == NIA_ELOADCALL


def test_call_cr14_ev_type_and_payload():
    """CALL_CR14 packet: ev_type=0x07, payload_gt = code/return GT word0."""
    pkt = _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR14, payload_gt=RETURN_GT)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_CALL_CR14 == 0x07
    assert d['payload_gt'] == RETURN_GT
    assert d['nia']        == NIA_ELOADCALL


def test_call_push_ev_type_and_zero_payload():
    """CALL_PUSH packet: ev_type=0x08, payload_gt = 0 (stack push carries no GT)."""
    pkt = _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_PUSH, payload_gt=0)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_CALL_PUSH == 0x08
    assert d['payload_gt'] == 0
    assert d['nia']        == NIA_ELOADCALL


def test_call_sequence_same_nia():
    """All 3 CALL packets share the same NIA — same retiring instruction."""
    pkts = [
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR6,  payload_gt=ABSTRACTION_GT),
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR14, payload_gt=RETURN_GT),
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_PUSH,  payload_gt=0),
    ]
    decoded = [decode_trace_packet(p) for p in pkts]
    nias = {d['nia'] for d in decoded}
    assert nias == {NIA_ELOADCALL}, \
        f'Expected single NIA across CALL sequence, got {nias}'


def test_call_sequence_ev_types_in_order():
    """3-packet CALL sequence must decode as CR6 → CR14 → PUSH in order."""
    pkts = [
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR6,  payload_gt=ABSTRACTION_GT),
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR14, payload_gt=RETURN_GT),
        _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_PUSH,  payload_gt=0),
    ]
    ev_types = [decode_trace_packet(p)['ev_type'] for p in pkts]
    assert ev_types == [TRACE_EV_CALL_CR6, TRACE_EV_CALL_CR14, TRACE_EV_CALL_PUSH]


def test_call_cr6_payload_distinct_from_cr14():
    """CALL_CR6 and CALL_CR14 carry different payloads — must not be swapped."""
    pkt_cr6  = _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR6,  payload_gt=ABSTRACTION_GT)
    pkt_cr14 = _make_packet(NIA_ELOADCALL, TRACE_EV_CALL_CR14, payload_gt=RETURN_GT)
    d_cr6  = decode_trace_packet(pkt_cr6)
    d_cr14 = decode_trace_packet(pkt_cr14)
    assert d_cr6['payload_gt']  == ABSTRACTION_GT
    assert d_cr14['payload_gt'] == RETURN_GT
    assert d_cr6['payload_gt'] != d_cr14['payload_gt']


# ── Other event types ─────────────────────────────────────────────────────────

def test_result_packet():
    pkt = _make_packet(0x00000100, TRACE_EV_RESULT, payload_gt=0xCAFEBABE)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_RESULT == 0x00
    assert d['payload_gt'] == 0xCAFEBABE


def test_load_shadow_packet():
    pkt = _make_packet(0x00000200, TRACE_EV_LOAD_SHADOW, payload_gt=0x11223344)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_LOAD_SHADOW == 0x01
    assert d['payload_gt'] == 0x11223344


def test_load_new_packet():
    pkt = _make_packet(0x00000200, TRACE_EV_LOAD_NEW, payload_gt=0xAABBCCDD)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_LOAD_NEW == 0x02
    assert d['payload_gt'] == 0xAABBCCDD


def test_change_push_packet():
    pkt = _make_packet(0x00000300, TRACE_EV_CHANGE_PUSH, payload_gt=0)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_CHANGE_PUSH == 0x03
    assert d['payload_gt'] == 0


def test_change_cr12_packet():
    pkt = _make_packet(0x00000300, TRACE_EV_CHANGE_CR12, payload_gt=0x12345678)
    d = decode_trace_packet(pkt)
    assert d['ev_type'] == TRACE_EV_CHANGE_CR12 == 0x04


def test_change_cr5_packet():
    pkt = _make_packet(0x00000300, TRACE_EV_CHANGE_CR5, payload_gt=0xFEDCBA98)
    d = decode_trace_packet(pkt)
    assert d['ev_type'] == TRACE_EV_CHANGE_CR5 == 0x05


def test_return_pop_packet():
    pkt = _make_packet(0x00000400, TRACE_EV_RETURN_POP, payload_gt=0)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_RETURN_POP == 0x09
    assert d['payload_gt'] == 0


def test_return_cr6_packet():
    pkt = _make_packet(0x00000400, TRACE_EV_RETURN_CR6, payload_gt=0xABCD0001)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_RETURN_CR6 == 0x0A
    assert d['payload_gt'] == 0xABCD0001


def test_return_cr14_packet():
    pkt = _make_packet(0x00000400, TRACE_EV_RETURN_CR14, payload_gt=0xDEAD0002)
    d = decode_trace_packet(pkt)
    assert d['ev_type']    == TRACE_EV_RETURN_CR14 == 0x0B
    assert d['payload_gt'] == 0xDEAD0002


# ── Flags and fault fields ─────────────────────────────────────────────────────

def test_nzcv_flags_decoded():
    """bits[3:0] of the flags byte must reach the decoded 'flags' field."""
    for nzcv in range(16):
        pkt = _make_packet(0x00000500, TRACE_EV_RESULT, flags=nzcv)
        d = decode_trace_packet(pkt)
        assert d['flags'] & 0x0F == nzcv


def test_fault_valid_set():
    pkt = _make_packet(0x00000600, TRACE_EV_RESULT, fault_valid=True, fault_code=3)
    d = decode_trace_packet(pkt)
    assert d['fault_valid'] is True
    assert d['fault_code'] == 3


def test_fault_valid_clear():
    pkt = _make_packet(0x00000600, TRACE_EV_RESULT, fault_valid=False, fault_code=0)
    d = decode_trace_packet(pkt)
    assert d['fault_valid'] is False


def test_bp_hit_set():
    pkt = _make_packet(0x00000700, TRACE_EV_RESULT, bp_hit=True)
    d = decode_trace_packet(pkt)
    assert d['bp_hit'] is True


def test_bp_hit_clear():
    pkt = _make_packet(0x00000700, TRACE_EV_RESULT, bp_hit=False)
    d = decode_trace_packet(pkt)
    assert d['bp_hit'] is False


# ── Malformed packet rejection ─────────────────────────────────────────────────

def test_wrong_magic_raises():
    bad = bytes([0xFF]) + bytes(11)
    with pytest.raises(ValueError, match='0xAA'):
        decode_trace_packet(bad)


def test_wrong_length_raises():
    with pytest.raises(ValueError):
        decode_trace_packet(bytes(11))
    with pytest.raises(ValueError):
        decode_trace_packet(bytes(13))


def test_empty_raises():
    with pytest.raises(ValueError):
        decode_trace_packet(b'')


# ── NIA field ─────────────────────────────────────────────────────────────────

def test_nia_full_range():
    """NIA spans bytes 1-4 (big-endian uint32) — max value must round-trip."""
    pkt = _make_packet(0xFFFFFFFF, TRACE_EV_RESULT)
    assert decode_trace_packet(pkt)['nia'] == 0xFFFFFFFF


def test_nia_zero():
    pkt = _make_packet(0x00000000, TRACE_EV_RESULT)
    assert decode_trace_packet(pkt)['nia'] == 0


# ── payload_gt full range ─────────────────────────────────────────────────────

def test_payload_gt_max():
    pkt = _make_packet(0x00000100, TRACE_EV_CALL_CR6, payload_gt=0xFFFFFFFF)
    assert decode_trace_packet(pkt)['payload_gt'] == 0xFFFFFFFF
