"""Focused simulation of RETURN's frame validation and root marker."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest
from amaranth.sim import Simulator

from hardware.hw_types import (
    FaultType,
    GT_TYPE_INFORM,
    PERM_MASK_E,
    PERM_MASK_R,
    PERM_MASK_W,
    make_gt,
)
from hardware.ret import ChurchReturn
from hardware.thread_design import THREAD_STO_OFFSET


THREAD_BASE = 0x4000
STO = 241
PREV_STO = 243
STO_ADDR = THREAD_BASE + THREAD_STO_OFFSET * 4


def _cap(gt, location):
    return gt | (location << 32)


def _header():
    # 256 words, typ=Thread, cw=32, cc=12.
    return (0x1F << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12


def _run(frame_pc=10, companion=None, validate_fault=False):
    dut = ChurchReturn()
    if companion is None:
        companion = make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2)
    frame = (frame_pc << 13) | PREV_STO
    memory = {
        STO_ADDR: STO | (1 << 12),
        THREAD_BASE + (STO + 2) * 4: frame,
        THREAD_BASE + (STO + 1) * 4: companion,
    }
    cr5 = _cap(
        make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, slot_id=5),
        0x5000,
    )
    cr12 = _cap(make_gt(GT_TYPE_INFORM, 0, slot_id=12), THREAD_BASE)
    writes = []
    nia_events = []
    flag_events = []
    result = {}

    async def bench(ctx):
        ctx.set(dut.cr5_heap.as_value(), cr5)
        ctx.set(dut.cr12_thread.as_value(), cr12)
        ctx.set(dut.thread_base, THREAD_BASE)
        ctx.set(dut.thread_hdr, _header())
        ctx.set(dut.return_start, 1)
        ctx.set(dut.mem_rd_valid, 0)
        await ctx.tick()
        ctx.set(dut.return_start, 0)

        pending = None
        mload_pending = False
        mload_fault_issued = False
        for _ in range(80):
            rd_en = ctx.get(dut.mem_rd_en)
            rd_addr = ctx.get(dut.mem_rd_addr)
            ctx.set(dut.mem_rd_valid, 0)
            ctx.set(dut.mload_done, int(mload_pending))
            mload_fault_issued |= mload_pending and validate_fault
            ctx.set(dut.mload_fault, int(mload_fault_issued))
            ctx.set(dut.mload_fault_type, int(FaultType.STACK_CORRUPT))
            mload_pending = bool(ctx.get(dut.mload_start))
            if pending is not None:
                pending_addr, pending_data = pending
                assert rd_en and rd_addr == pending_addr
                ctx.set(dut.mem_rd_data, pending_data)
                ctx.set(dut.mem_rd_valid, 1)
                pending = None
            elif rd_en:
                pending = (rd_addr, memory.get(rd_addr, 0))

            if ctx.get(dut.mem_wr_en):
                writes.append((ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data)))
            if ctx.get(dut.nia_set):
                nia_events.append(ctx.get(dut.nia_value))
            if ctx.get(dut.flags_restore_en):
                flag_events.append(ctx.get(dut.flags_restore_data.as_value()))
            if ctx.get(dut.fault_valid):
                result["fault"] = ctx.get(dut.fault_type)
                return
            if ctx.get(dut.complete):
                result["complete"] = True
                return
            await ctx.tick()
        raise AssertionError("RETURN did not reach a terminal state")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return result, writes, nia_events, flag_events


def test_return_pops_only_after_validating_frame_and_companion():
    result, writes, nia_events, flag_events = _run()
    assert result == {"complete": True}
    assert writes == [(STO_ADDR, PREV_STO)]
    assert len(nia_events) == 1
    assert flag_events


def test_return_root_poison_is_underflow_not_boot_rom_return():
    result, writes, nia_events, flag_events = _run(frame_pc=0x7FFF)
    assert result == {"fault": int(FaultType.STACK_UNDERFLOW)}
    assert writes == []
    assert nia_events == []
    assert flag_events == []


def test_return_rejects_invalid_companion_before_sto_update():
    result, writes, nia_events, flag_events = _run(companion=0)
    assert result == {"fault": int(FaultType.STACK_CORRUPT)}
    assert writes == []
    assert nia_events == []
    assert flag_events == []


@pytest.mark.parametrize(
    "companion",
    [
        make_gt(3, PERM_MASK_E, slot_id=2),  # Abstract
        make_gt(GT_TYPE_INFORM, 0, slot_id=2),  # Inform, non-E
    ],
)
def test_return_rejects_non_inform_e_companions_without_architectural_mutation(
    companion,
):
    result, writes, nia_events, flag_events = _run(companion=companion)
    assert result == {"fault": int(FaultType.STACK_CORRUPT)}
    assert writes == []
    assert nia_events == []
    assert flag_events == []


def test_return_propagates_stale_companion_mload_validation_fault():
    stale_inform_e = make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=0x123, gt_seq=7)
    result, writes, nia_events, flag_events = _run(
        companion=stale_inform_e, validate_fault=True
    )
    assert result == {"fault": int(FaultType.STACK_CORRUPT)}
    assert writes == []
    assert nia_events == []
    assert flag_events == []