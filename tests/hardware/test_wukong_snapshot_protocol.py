"""Focused tests for the read-only Wukong architectural snapshot protocol."""

import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from amaranth.sim import Simulator
from hardware import wukong_bridge as wb
from hardware.wukong_top import FaultRecoveryControl


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


def test_fault_recovery_hardware_is_fail_closed_and_frame_serialized():
    """Cycle-level RTL proof of fault hold, authorization, and safe reboot."""
    dut = FaultRecoveryControl()

    async def bench(ctx):
        ctx.set(dut.reboot_safe, 0)

        # A fault immediately establishes the execution hold.
        ctx.set(dut.fault_halt, 1)
        await ctx.tick()
        ctx.set(dut.fault_halt, 0)
        assert ctx.get(dut.hold) == 1
        assert ctx.get(dut.fault_pending) == 1

        # Authorization before a complete reason-2 snapshot is ignored.
        ctx.set(dut.authorize_recovery_cmd, 1)
        await ctx.tick()
        ctx.set(dut.authorize_recovery_cmd, 0)
        assert ctx.get(dut.authorized_reboot_pending) == 0

        # An explicit/clean snapshot cannot unlock fault recovery.
        ctx.set(dut.snapshot_reason, 3)
        ctx.set(dut.snapshot_complete, 1)
        await ctx.tick()
        ctx.set(dut.snapshot_complete, 0)
        assert ctx.get(dut.snapshot_drained) == 0
        assert ctx.get(dut.hold) == 1

        # The final byte of the reason-2 snapshot makes authorization eligible.
        ctx.set(dut.snapshot_reason, wb.FaultRecovery.FAULT_SNAPSHOT_REASON)
        ctx.set(dut.snapshot_complete, 1)
        await ctx.tick()
        ctx.set(dut.snapshot_complete, 0)
        assert ctx.get(dut.snapshot_drained) == 1

        # Promotion authorization is remembered, but cannot reboot while the
        # shared UART boundary is busy.
        ctx.set(dut.authorize_recovery_cmd, 1)
        await ctx.tick()
        ctx.set(dut.authorize_recovery_cmd, 0)
        assert ctx.get(dut.authorized_reboot_pending) == 1
        assert ctx.get(dut.reboot_pulse) == 0
        assert ctx.get(dut.hold) == 1

        # Once trace/snapshot traffic is idle, reboot and sentinel re-arm pulse
        # together; the following edge clears the recovery lock for later faults.
        ctx.set(dut.reboot_safe, 1)
        await ctx.delay(1e-9)
        assert ctx.get(dut.reboot_pulse) == 1
        assert ctx.get(dut.rearm_sentinel) == 1
        await ctx.tick()
        assert ctx.get(dut.reboot_pulse) == 0
        assert ctx.get(dut.hold) == 0

        # A later rejected recovery remains halted until explicit manual reboot.
        ctx.set(dut.reboot_safe, 0)
        ctx.set(dut.fault_halt, 1)
        await ctx.tick()
        ctx.set(dut.fault_halt, 0)
        ctx.set(dut.snapshot_reason, wb.FaultRecovery.FAULT_SNAPSHOT_REASON)
        ctx.set(dut.snapshot_complete, 1)
        await ctx.tick()
        ctx.set(dut.snapshot_complete, 0)
        for _ in range(3):
            await ctx.tick()
            assert ctx.get(dut.hold) == 1
            assert ctx.get(dut.reboot_pulse) == 0

        # Existing explicit reboot remains an intentional, serialized override.
        ctx.set(dut.manual_reboot_cmd, 1)
        await ctx.tick()
        ctx.set(dut.manual_reboot_cmd, 0)
        assert ctx.get(dut.reboot_pulse) == 0
        ctx.set(dut.reboot_safe, 1)
        await ctx.delay(1e-9)
        assert ctx.get(dut.reboot_pulse) == 1

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_fault_recovery_control_is_wired_into_top_execution_and_uart_gates():
    """Keep the focused controller connected to production fetch and framing."""
    source = (Path(__file__).resolve().parents[2] / 'hardware' /
              'wukong_top.py').read_text()
    reboot_block = source[source.index('m.d.comb += reboot_safe.eq('):
                          source.index('# ── TraceUnit FSM')]
    assert '~trace_stall & ~snapshot_busy & ~snapshot_pending' in reboot_block
    assert 'sentinel_sent.eq(0)' in reboot_block
    assert 'sentinel_phase.eq(0)' in reboot_block
    assert 'step_halted.eq(0)' in reboot_block

    execution_gate = source[source.index('core.imem_valid.eq('):
                            source.index('core.free_run_start.eq(0)')]
    assert '~sentinel_req & ~recovery_hold' in execution_gate
    assert 'core.halt_req.eq(step_halted | trace_stall | recovery_hold)' in execution_gate

    snapshot_final_byte = source.index(
        'with m.If(snap_bidx == _SNAP_FRAME_LEN - 1):')
    snapshot_done_block = source[snapshot_final_byte:snapshot_final_byte + 400]
    assert 'snapshot_complete.eq(1)' in snapshot_done_block
    assert 'snapshot_complete_reason.eq(snap_reason)' in snapshot_done_block


class _FakeResponse:
    def __init__(self, status_code=200, promoted=True):
        self.status_code = status_code
        self._promoted = promoted

    def json(self):
        return {'promoted': self._promoted}


class _FakeSerial:
    def __init__(self):
        self.writes = []
        self.flushes = 0

    def write(self, data):
        self.writes.append(bytes(data))

    def flush(self):
        self.flushes += 1


def test_fault_recovery_authorizes_after_snapshot_then_rearms_at_sentinel(monkeypatch):
    """Promotion authorizes one recovery and a full sentinel re-arms the next."""
    posts = []

    def fake_post(url, json=None, timeout=None, verify=None):
        posts.append((url, json))
        return _FakeResponse()

    monkeypatch.setattr(wb.requests, 'post', fake_post)
    recovery = wb.FaultRecovery()
    serial = _FakeSerial()
    fault_snapshot = wb.decode_snapshot_frame(_frame())
    fault_snapshot['reason'] = wb.FaultRecovery.FAULT_SNAPSHOT_REASON

    recovery.note_trace(
        {'fault_valid': True, 'nia': 0x164}, trace_seq=7,
        server_boot_id='server-a')
    snapshot_payload = recovery.snapshot_payload(fault_snapshot)
    accepted = wb._post_wukong_snapshot('http://ide.test', snapshot_payload, True)
    assert accepted is True
    assert recovery.should_reboot_after_snapshot(fault_snapshot, accepted) is True
    assert wb._authorize_fault_recovery(serial) is True
    recovery.mark_reboot_sent()

    assert posts == [('http://ide.test/hardware/wukong/snapshot', snapshot_payload)]
    assert snapshot_payload['fault_trace_seq'] == 7
    assert snapshot_payload['fault_boot_id'] == 'server-a'
    assert serial.writes == [b'g']
    assert serial.flushes == 1
    assert recovery.reboot_sent is True
    assert recovery.should_reboot_after_snapshot(fault_snapshot, True) is False

    # The complete recovered Boot.0 sentinel completes recovery and re-arms a
    # later fault without a second serial reboot colliding with its four bytes.
    sentinel = wb.parse_boot_sentinel(
        bytes([wb.BOOT_SENTINEL_V2, 0x0E, wb.TU_VERSION_CALL_3PKT, 16]))
    assert sentinel['length'] == wb.SENTINEL_V2_LEN
    assert sentinel['tu_version'] == wb.TU_VERSION_CALL_3PKT
    assert sentinel['build_version'] == 16
    recovery.note_boot_sentinel()
    assert recovery.reboot_sent is False
    recovery.note_trace(
        {'fault_valid': True, 'nia': 0x164}, trace_seq=8,
        server_boot_id='server-b')
    assert recovery.should_reboot_after_snapshot(fault_snapshot, True) is True


def test_fault_recovery_never_reboots_for_clean_pause_or_rejected_snapshot():
    recovery = wb.FaultRecovery()
    clean_pause = wb.decode_snapshot_frame(_frame())
    clean_pause['reason'] = 3

    recovery.note_trace({'fault_valid': False}, trace_seq=7, server_boot_id='server-a')
    assert recovery.should_reboot_after_snapshot(clean_pause, True) is False
    recovery.note_trace({'fault_valid': True}, trace_seq=7, server_boot_id='server-a')
    assert recovery.should_reboot_after_snapshot(clean_pause, True) is False
    clean_pause['reason'] = wb.FaultRecovery.FAULT_SNAPSHOT_REASON
    assert recovery.should_reboot_after_snapshot(clean_pause, False) is False


def test_fault_recovery_keeps_board_halted_when_fault_trace_was_rejected():
    """Never reboot if the server cannot correlate snapshot to the fault trace."""
    recovery = wb.FaultRecovery()
    fault_snapshot = wb.decode_snapshot_frame(_frame())
    fault_snapshot['reason'] = wb.FaultRecovery.FAULT_SNAPSHOT_REASON
    recovery.note_trace(
        {'fault_valid': True, 'nia': 0x164}, trace_seq=None,
        server_boot_id='server-a')
    assert recovery.should_reboot_after_snapshot(fault_snapshot, True) is False


def test_fault_recovery_never_reboots_when_server_cannot_promote_snapshot(monkeypatch):
    def fake_post(*_args, **_kwargs):
        return _FakeResponse(promoted=False)

    monkeypatch.setattr(wb.requests, 'post', fake_post)
    recovery = wb.FaultRecovery()
    recovery.note_trace(
        {'fault_valid': True}, trace_seq=12, server_boot_id='server-a')
    fault_snapshot = wb.decode_snapshot_frame(_frame())
    fault_snapshot['reason'] = wb.FaultRecovery.FAULT_SNAPSHOT_REASON
    accepted = wb._post_wukong_snapshot(
        'http://ide.test', recovery.snapshot_payload(fault_snapshot), True)
    assert accepted is False
    assert recovery.should_reboot_after_snapshot(fault_snapshot, accepted) is False


def test_rejected_later_fault_cannot_reuse_an_older_pending_correlation():
    """F2 must stay halted instead of borrowing F1's accepted trace id."""
    recovery = wb.FaultRecovery()
    recovery.note_trace(
        {'fault_valid': True, 'nia': 0x164}, trace_seq=11,
        server_boot_id='server-a')
    assert recovery.snapshot_payload({})['fault_trace_seq'] == 11

    # A clean/explicit snapshot consumes F1 without rebooting.
    recovery.clear_pending()
    # F2's trace POST then fails. note_trace must clear F1 before it observes
    # that F2 has no usable correlation.
    recovery.note_trace(
        {'fault_valid': True, 'nia': 0x200}, trace_seq=None,
        server_boot_id=None)
    fault_snapshot = wb.decode_snapshot_frame(_frame())
    fault_snapshot['reason'] = wb.FaultRecovery.FAULT_SNAPSHOT_REASON
    assert 'fault_trace_seq' not in recovery.snapshot_payload(fault_snapshot)
    assert recovery.should_reboot_after_snapshot(fault_snapshot, accepted=True) is False
