"""
tests/hardware/test_wukong_bridge_church_only.py

Task #3041: --church-only trace filter

Tests that _is_turing_only_result() correctly identifies bare Turing RESULT
packets (to be suppressed) vs Church-level packets (to be forwarded).

The predicate suppresses a decoded packet when ALL THREE hold:
  • ev_type == TRACE_EV_RESULT   (not a CALL/RETURN sub-packet)
  • fault_valid is False         (faulting instructions must always be visible)
  • payload_gt == 0              (no GT — LOAD/CHANGE carry one)
"""

import os
import struct
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import hardware.wukong_bridge as bridge


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_packet(ev_type, payload_gt=0, fault_valid=False, fault_code=0,
                 nia=0x1000, flags=0, bp_hit=False):
    """Build a syntactically valid 12-byte trace packet for the given ev_type."""
    raw11 = (fault_code & 0x1F)
    if fault_valid:
        raw11 |= 0x40
    if bp_hit:
        raw11 |= 0x80
    pkt = (bytes([bridge.TRACE_MAGIC])
           + struct.pack('>I', nia)
           + bytes([ev_type])
           + struct.pack('>I', payload_gt)
           + bytes([flags, raw11]))
    assert len(pkt) == bridge.TRACE_LEN
    return pkt


def _decode(ev_type, **kw):
    return bridge.decode_trace_packet(_make_packet(ev_type, **kw))


# ── Tests: packets that MUST be suppressed ────────────────────────────────────

class TestSuppressed:
    """Bare Turing RESULT packets — no fault, no GT."""

    def test_plain_result_no_gt_no_fault(self):
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0, fault_valid=False)
        assert bridge._is_turing_only_result(d) is True

    def test_plain_result_flags_nonzero(self):
        # NZCV flags set is irrelevant — still a bare Turing result
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0, fault_valid=False,
                    flags=0b1010)
        assert bridge._is_turing_only_result(d) is True

    def test_plain_result_different_nia(self):
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0, fault_valid=False,
                    nia=0x0B94)
        assert bridge._is_turing_only_result(d) is True


# ── Tests: packets that MUST NOT be suppressed ────────────────────────────────

class TestForwarded:
    """Packets that must always pass through the church-only filter."""

    # ── Faulting RESULT ───────────────────────────────────────────────────────

    def test_faulting_result_no_gt(self):
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0, fault_valid=True,
                    fault_code=0x1C)
        assert bridge._is_turing_only_result(d) is False

    def test_faulting_result_with_gt(self):
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0xDEADBEEF,
                    fault_valid=True)
        assert bridge._is_turing_only_result(d) is False

    # ── RESULT carrying a GT payload (LOAD / CHANGE) ──────────────────────────

    def test_result_with_nonzero_gt(self):
        # LOAD or CHANGE emitting a payload GT — Church-level operation
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0x4A000006,
                    fault_valid=False)
        assert bridge._is_turing_only_result(d) is False

    def test_result_with_gt_and_fault(self):
        d = _decode(bridge.TRACE_EV_RESULT, payload_gt=0x12345678,
                    fault_valid=True)
        assert bridge._is_turing_only_result(d) is False

    # ── CALL sub-packets ──────────────────────────────────────────────────────

    def test_call_cr6(self):
        d = _decode(bridge.TRACE_EV_CALL_CR6, payload_gt=0x4A000001)
        assert bridge._is_turing_only_result(d) is False

    def test_call_cr14(self):
        d = _decode(bridge.TRACE_EV_CALL_CR14, payload_gt=0x4A000006)
        assert bridge._is_turing_only_result(d) is False

    def test_call_push(self):
        # CALL_PUSH has payload_gt=0 but ev_type != RESULT
        d = _decode(bridge.TRACE_EV_CALL_PUSH, payload_gt=0)
        assert bridge._is_turing_only_result(d) is False

    # ── RETURN sub-packets ────────────────────────────────────────────────────

    def test_return_pop(self):
        d = _decode(bridge.TRACE_EV_RETURN_POP, payload_gt=0)
        assert bridge._is_turing_only_result(d) is False

    def test_return_cr6(self):
        d = _decode(bridge.TRACE_EV_RETURN_CR6, payload_gt=0x4A000001)
        assert bridge._is_turing_only_result(d) is False

    def test_return_cr14(self):
        d = _decode(bridge.TRACE_EV_RETURN_CR14, payload_gt=0x4A000006)
        assert bridge._is_turing_only_result(d) is False

    # ── LOAD sub-packets ──────────────────────────────────────────────────────

    def test_load_shadow(self):
        d = _decode(bridge.TRACE_EV_LOAD_SHADOW, payload_gt=0x4A000003)
        assert bridge._is_turing_only_result(d) is False

    def test_load_new(self):
        d = _decode(bridge.TRACE_EV_LOAD_NEW, payload_gt=0x4A000005)
        assert bridge._is_turing_only_result(d) is False

    # ── CHANGE sub-packets ────────────────────────────────────────────────────

    def test_change_push(self):
        d = _decode(bridge.TRACE_EV_CHANGE_PUSH, payload_gt=0)
        assert bridge._is_turing_only_result(d) is False

    def test_change_cr12(self):
        d = _decode(bridge.TRACE_EV_CHANGE_CR12, payload_gt=0x12000001)
        assert bridge._is_turing_only_result(d) is False

    def test_change_cr5(self):
        d = _decode(bridge.TRACE_EV_CHANGE_CR5, payload_gt=0x10000001)
        assert bridge._is_turing_only_result(d) is False


# ── Integration: simulate a mixed packet stream ───────────────────────────────

class TestMixedStream:
    """Verify filter passes/drops the right mix in a realistic sequence."""

    def _run_filter(self, packets):
        """Decode each packet and return (kept, dropped) lists of ev_type values."""
        kept, dropped = [], []
        for pkt in packets:
            d = bridge.decode_trace_packet(pkt)
            if bridge._is_turing_only_result(d):
                dropped.append(d['ev_type'])
            else:
                kept.append(d['ev_type'])
        return kept, dropped

    def test_selftest_style_stream(self):
        """A run of Turing results bracketed by CALL/RETURN packets."""
        packets = [
            # CALL sequence (3 packets, same NIA)
            _make_packet(bridge.TRACE_EV_CALL_CR6,  payload_gt=0x4A000006),
            _make_packet(bridge.TRACE_EV_CALL_CR14, payload_gt=0x4A000006),
            _make_packet(bridge.TRACE_EV_CALL_PUSH, payload_gt=0),
            # Several Turing arithmetic steps
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0, nia=0x944),
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0, nia=0x948),
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0, nia=0x94C),
            # A faulting Turing step — must NOT be dropped
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0,
                         fault_valid=True, fault_code=5, nia=0x950),
            # RETURN sequence
            _make_packet(bridge.TRACE_EV_RETURN_POP,  payload_gt=0),
            _make_packet(bridge.TRACE_EV_RETURN_CR6,  payload_gt=0x4A000001),
            _make_packet(bridge.TRACE_EV_RETURN_CR14, payload_gt=0x4A000006),
        ]
        kept, dropped = self._run_filter(packets)

        # Exactly 3 bare Turing results suppressed
        assert dropped == [bridge.TRACE_EV_RESULT] * 3

        kept_ev = kept
        # CALL sub-packets
        assert bridge.TRACE_EV_CALL_CR6  in kept_ev
        assert bridge.TRACE_EV_CALL_CR14 in kept_ev
        assert bridge.TRACE_EV_CALL_PUSH in kept_ev
        # Faulting RESULT
        fault_results = [e for e in kept_ev if e == bridge.TRACE_EV_RESULT]
        assert len(fault_results) == 1
        # RETURN sub-packets
        assert bridge.TRACE_EV_RETURN_POP  in kept_ev
        assert bridge.TRACE_EV_RETURN_CR6  in kept_ev
        assert bridge.TRACE_EV_RETURN_CR14 in kept_ev


# ── Boot gate interaction ─────────────────────────────────────────────────────

class TestBootGateInteraction:
    """Boot gate must count filtered packets so 'q' fires on schedule.

    The boot sequence after a sentinel is typically composed of bare RESULT
    packets (no GT, no fault).  With --church-only active the filter would
    suppress them from being forwarded, but the gate countdown must still
    decrement on every validated frame.  The correct ordering in the main
    loop is: gate decrement → filter check → forward/skip.

    These tests simulate that ordering directly against the predicate and the
    BOOT_TRACE_PACKET_COUNT constant so regressions are caught without needing
    a full mock of the serial/HTTP stack.
    """

    def _simulate_gate_with_filter(self, packets, church_only=True):
        """
        Simulate the gate + filter interaction for a list of raw packets.

        Returns (gate_fired, remaining_at_end, forwarded_count).
        """
        remaining = bridge.BOOT_TRACE_PACKET_COUNT
        gate_fired = False
        forwarded = 0

        for pkt in packets:
            d = bridge.decode_trace_packet(pkt)

            # ── Boot gate: runs BEFORE filter (correct ordering) ──────────────
            remaining -= 1
            if remaining <= 0:
                gate_fired = True

            # ── church-only filter ────────────────────────────────────────────
            if church_only and bridge._is_turing_only_result(d):
                continue   # skip forward; gate already decremented

            forwarded += 1

        return gate_fired, remaining, forwarded

    def test_gate_fires_on_schedule_when_all_packets_filtered(self):
        """8 bare-RESULT boot packets filtered → gate still fires after packet 8."""
        packets = [
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0,
                         fault_valid=False, nia=0x900 + i * 4)
            for i in range(bridge.BOOT_TRACE_PACKET_COUNT)
        ]
        gate_fired, remaining, forwarded = self._simulate_gate_with_filter(
            packets, church_only=True)

        assert gate_fired, "boot gate must fire after BOOT_TRACE_PACKET_COUNT packets"
        assert remaining == 0
        assert forwarded == 0   # all suppressed by filter

    def test_gate_fires_on_schedule_without_filter(self):
        """Baseline: gate fires on schedule when filter is off."""
        packets = [
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0,
                         fault_valid=False, nia=0x900 + i * 4)
            for i in range(bridge.BOOT_TRACE_PACKET_COUNT)
        ]
        gate_fired, remaining, forwarded = self._simulate_gate_with_filter(
            packets, church_only=False)

        assert gate_fired
        assert forwarded == bridge.BOOT_TRACE_PACKET_COUNT  # all forwarded

    def test_gate_fires_after_mixed_boot_sequence(self):
        """Mixed boot packets (some CALL, most bare RESULT) — gate fires on 8th."""
        # First 2 packets are a CALL_CR6/CR14 (Church-level, forwarded),
        # remaining 6 are bare RESULT (Turing, filtered under church-only).
        packets = (
            [_make_packet(bridge.TRACE_EV_CALL_CR6,  payload_gt=0x4A000006),
             _make_packet(bridge.TRACE_EV_CALL_CR14, payload_gt=0x4A000006)]
            + [_make_packet(bridge.TRACE_EV_RESULT, payload_gt=0,
                            fault_valid=False, nia=0x944 + i * 4)
               for i in range(bridge.BOOT_TRACE_PACKET_COUNT - 2)]
        )
        gate_fired, remaining, forwarded = self._simulate_gate_with_filter(
            packets, church_only=True)

        assert gate_fired
        assert remaining == 0
        # Only the 2 CALL packets were forwarded; 6 bare RESULTs were filtered
        assert forwarded == 2

    def test_gate_does_not_fire_early_when_fewer_packets_arrive(self):
        """Gate must not fire before BOOT_TRACE_PACKET_COUNT packets."""
        n = bridge.BOOT_TRACE_PACKET_COUNT - 1
        packets = [
            _make_packet(bridge.TRACE_EV_RESULT, payload_gt=0,
                         fault_valid=False, nia=0x900 + i * 4)
            for i in range(n)
        ]
        gate_fired, remaining, _ = self._simulate_gate_with_filter(
            packets, church_only=True)

        assert not gate_fired
        assert remaining == 1
