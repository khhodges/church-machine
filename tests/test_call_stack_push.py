"""
Focused simulation test for ChurchCall stack push states.

Spec (CM_LUMP_SPECIFICATION.md §"Zone ② — LIFO Stack"):
  CALL frame (SZ=1 — 2 words):      STO -= 2 after push
    STO+0:  Frame word: SZ[1] | return_PC[15] | prev_STO[16]
    STO-1:  E-GT Word 0 of the callee

  Stack grows downward; STO stored at Heap[0] = Mem[CR5.word1_location].
  Thread header (at thread_base) encodes:
    n_minus_6, sw (cw field for typ=10), cc
  Derived bounds (hardware, IDE-set via sw):
    lumpSize = 1 << (n_minus_6 + 6)
    sp_max   = lumpSize - cc - 1        (initial STO, empty stack)
    sp_min   = lumpSize - cc - sw + 2   (CALL needs 2 words: STO >= sp_min)

  STACK_OVERFLOW  fault when STO < sp_min
  STACK_CORRUPT   fault when STO > sp_max

Scenarios (256-word thread: n_minus_6=2, sw=32, cc=12):
  lumpSize=256, sp_max=243, sp_min=214

  1. Normal push   — STO=243 (empty sentinel, sp_max): full frame push → STO=241
  2. Boundary low  — STO=214 (= sp_min): STO-2=212 at stack_min — should succeed
  3. Overflow      — STO=213 (< sp_min): STACK_OVERFLOW fault
  4. Corrupt       — STO=244 (> sp_max): STACK_CORRUPT fault
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.call import ChurchCall
from hardware.hw_types import (
    FaultType, PERM_MASK_E, PERM_MASK_X, PERM_MASK_R, PERM_MASK_W,
    GT_TYPE_INFORM,
    PERM_E,
)
from hardware.layouts import GT_LAYOUT, CAP_REG_LAYOUT

THREAD_BASE   = 0x4000
SP_STORE_ADDR = 0x3000
CALLEE_EGT    = 0x40800001
CALLER_PC     = 42

THR_N6  = 2    # n_minus_6 for 256-word thread
THR_SW  = 32   # stack words (cw field reinterpreted for typ=10)
THR_CC  = 12   # cap-list slots (architecture-fixed for Thread)

LUMP_SIZE = 1 << (THR_N6 + 6)          # 256
SP_MAX    = LUMP_SIZE - THR_CC - 1     # 243
SP_MIN    = LUMP_SIZE - THR_CC - THR_SW + 2  # 214


def _build_gt(slot_id=0, gt_seq=0, gt_type=GT_TYPE_INFORM, perms=0, b_flag=0):
    gt  = (slot_id & 0xFFFF)
    gt |= (gt_seq  & 0x7F) << 16
    gt |= (gt_type & 0x03) << 23
    gt |= (perms   & 0x3F) << 25
    gt |= (b_flag  & 0x01) << 31
    return gt


def _build_cap(slot_id=0, perms=0, location=0):
    gt = _build_gt(slot_id=slot_id, perms=perms)
    return gt | (location << 32)


def _build_lump_hdr(n_minus_6=0, cc=4, cw=8, magic=0x5):
    """LUMP_HEADER_LAYOUT: cc[7:0] | typ[9:8] | cw[22:10] | n_minus_6[26:23] | magic[31:27]"""
    h  = (cc         & 0xFF)
    h |= (cw         & 0x1FFF) << 10
    h |= (n_minus_6  & 0x0F)   << 23
    h |= (magic      & 0x1F)   << 27
    return h


def _expected_frame_word(sto, caller_pc):
    return_pc = (caller_pc + 1) & 0x7FFF
    prev_sto  = sto & 0xFFFF
    return (1 << 31) | (return_pc << 16) | prev_sto


def _run_scenario(initial_sto, expect_fault=None):
    """
    expect_fault: None (expect success), FaultType.STACK_OVERFLOW, or
                  FaultType.STACK_CORRUPT.
    """
    dut = ChurchCall()
    errors = []

    callee_cap = _build_cap(slot_id=1, perms=PERM_MASK_E, location=0x2000)
    cr6_cap    = CALLEE_EGT
    ns_cap     = _build_cap(slot_id=0, perms=0, location=0x8000)
    code_cap   = _build_cap(slot_id=2, perms=PERM_MASK_E, location=0x9004)
    cr5_cap    = _build_cap(slot_id=5, perms=PERM_MASK_R | PERM_MASK_W, location=SP_STORE_ADDR)
    cr12_cap   = _build_cap(slot_id=12, perms=0, location=THREAD_BASE)

    # Callee lump header (for FETCH_LUMP, callee ns entry word3):
    callee_lump_hdr = _build_lump_hdr(n_minus_6=0, cc=4, cw=8, magic=0x5)

    # Thread lump header (for FETCH_THREAD_HDR, at thread_base):
    #   typ field not encoded by _build_lump_hdr but hardware only reads cw/cc/n_minus_6/magic
    thr_hdr = _build_lump_hdr(n_minus_6=THR_N6, cc=THR_CC, cw=THR_SW, magic=0x1F)

    wr_ops = []

    async def process(ctx):
        ctx.set(dut.caller_pc, CALLER_PC)
        ctx.set(dut.thread_base, THREAD_BASE)
        ctx.set(dut.cr5_heap.as_value(), cr5_cap)
        ctx.set(dut.cr12_thread.as_value(), cr12_cap)
        ctx.set(dut.cr15_namespace.as_value(), ns_cap)
        ctx.set(dut.cr14_code.as_value(), code_cap)
        ctx.set(dut.thread_hdr, thr_hdr)
        ctx.set(dut.mask, 0)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_src, 0)
        ctx.set(dut.mload_done, 0)
        ctx.set(dut.mload_fault, 0)
        ctx.set(dut.mload_fault_type, 0)
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr_rd_data.as_value(), callee_cap)

        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)

        phase1_done = False
        mload_ack_pending = False
        callee_lump_served = False
        thread_hdr_served = False

        MAX_TICKS = 140
        for t in range(MAX_TICKS):
            busy      = ctx.get(dut.call_busy)
            comp      = ctx.get(dut.call_complete)
            fault     = ctx.get(dut.call_fault)
            ftype     = ctx.get(dut.fault_type)
            rd_en     = ctx.get(dut.mem_rd_en)
            rd_addr   = ctx.get(dut.mem_rd_addr)
            wr_en     = ctx.get(dut.mem_wr_en)
            wr_addr   = ctx.get(dut.mem_wr_addr)
            wr_data   = ctx.get(dut.mem_wr_data)
            ml_start  = ctx.get(dut.mload_start)

            if wr_en:
                wr_ops.append((wr_addr, wr_data))

            if mload_ack_pending:
                ctx.set(dut.mload_done, 0)
                mload_ack_pending = False
                if not phase1_done:
                    ctx.set(dut.cr_rd_data.as_value(), cr6_cap)
                    phase1_done = True
                else:
                    ctx.set(dut.cr_rd_data.as_value(), code_cap)

            if ml_start:
                ctx.set(dut.mload_done, 1)
                mload_ack_pending = True

            # Respond to memory reads by address:
            if rd_en:
                if rd_addr == THREAD_BASE and not thread_hdr_served:
                    # FETCH_THREAD_HDR: thread's own lump header at word 0
                    ctx.set(dut.mem_rd_data, thr_hdr)
                    ctx.set(dut.mem_rd_valid, 1)
                    thread_hdr_served = True
                elif not callee_lump_served and rd_addr != SP_STORE_ADDR and rd_addr != THREAD_BASE:
                    # FETCH_LUMP: callee lump header from NS entry word3
                    ctx.set(dut.mem_rd_data, callee_lump_hdr)
                    ctx.set(dut.mem_rd_valid, 1)
                    callee_lump_served = True
                elif rd_addr == SP_STORE_ADDR:
                    # STACK_READ_SP: STO value
                    ctx.set(dut.mem_rd_data, initial_sto)
                    ctx.set(dut.mem_rd_valid, 1)
                else:
                    ctx.set(dut.mem_rd_valid, 0)
            else:
                ctx.set(dut.mem_rd_valid, 0)

            if comp or fault:
                if expect_fault is not None:
                    if not fault:
                        errors.append(
                            f"Expected fault {expect_fault!r}, got comp=1 with no fault"
                        )
                    elif ftype != expect_fault:
                        errors.append(
                            f"Wrong fault: expected {expect_fault.name}=0x{int(expect_fault):x},"
                            f" got 0x{ftype:x}"
                        )
                elif fault:
                    errors.append(
                        f"Unexpected fault 0x{ftype:x} for STO={initial_sto}"
                    )
                break

            await ctx.tick()
        else:
            errors.append(f"FSM did not complete within {MAX_TICKS} ticks")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    sim.run()

    if errors:
        raise AssertionError("\n".join(errors))

    if expect_fault is None:
        stack_writes = [(a, d) for a, d in wr_ops if a > 15]

        if len(stack_writes) < 3:
            raise AssertionError(
                f"Expected ≥3 stack memory writes, got {len(stack_writes)}: {stack_writes}"
            )

        exp_egt_addr = THREAD_BASE + (initial_sto - 1) * 4
        a0, d0 = stack_writes[0]
        assert a0 == exp_egt_addr, (
            f"STACK_WRITE_EGT addr: expected 0x{exp_egt_addr:08x}, got 0x{a0:08x}"
        )
        assert d0 == CALLEE_EGT, (
            f"STACK_WRITE_EGT data: expected 0x{CALLEE_EGT:08x}, got 0x{d0:08x}"
        )

        exp_fw_addr = THREAD_BASE + initial_sto * 4
        exp_fw_data = _expected_frame_word(initial_sto, CALLER_PC)
        a1, d1 = stack_writes[1]
        assert a1 == exp_fw_addr, (
            f"STACK_WRITE_FRAME addr: expected 0x{exp_fw_addr:08x}, got 0x{a1:08x}"
        )
        assert d1 == exp_fw_data, (
            f"STACK_WRITE_FRAME data: expected 0x{exp_fw_data:08x}, got 0x{d1:08x}"
        )

        a2, d2 = stack_writes[2]
        assert a2 == SP_STORE_ADDR, (
            f"STACK_WRITE_SP addr: expected 0x{SP_STORE_ADDR:08x}, got 0x{a2:08x}"
        )
        assert d2 == initial_sto - 2, (
            f"STACK_WRITE_SP data: expected STO-2={initial_sto - 2}, got {d2}"
        )


def test_normal_push():
    """STO=sp_max=243 (empty sentinel): full frame push, STO → 241."""
    _run_scenario(initial_sto=SP_MAX, expect_fault=None)


def test_boundary_push():
    """STO=sp_min=214: STO-2=212 = stack_min, exactly at Zone ② floor — should succeed."""
    _run_scenario(initial_sto=SP_MIN, expect_fault=None)


def test_overflow():
    """STO=213 (< sp_min=214): STACK_OVERFLOW — push would land below Zone ② floor."""
    _run_scenario(initial_sto=SP_MIN - 1, expect_fault=FaultType.STACK_OVERFLOW)


def test_corrupt():
    """STO=244 (> sp_max=243): STACK_CORRUPT — STO above empty-stack sentinel."""
    _run_scenario(initial_sto=SP_MAX + 1, expect_fault=FaultType.STACK_CORRUPT)


def test_sw_parametrized():
    """
    Verify that sp_max and sp_min scale correctly for different sw values.
    For each sw the FSM must:
      - accept  STO = sp_max            (normal/empty)
      - accept  STO = sp_min            (boundary low)
      - fault STACK_OVERFLOW at STO = sp_min - 1
      - fault STACK_CORRUPT  at STO = sp_max + 1
    Uses n_minus_6=2 (256-word thread), cc=12 throughout.
    """
    N6 = 2
    CC = 12
    LSIZ = 1 << (N6 + 6)

    for sw in (8, 16, 32, 64):
        sp_max_t = LSIZ - CC - 1
        sp_min_t = LSIZ - CC - sw + 2

        # Build a test-specific thread header
        thr_hdr_val = _build_lump_hdr(n_minus_6=N6, cc=CC, cw=sw, magic=0x1F)

        errors = []

        # We test all four boundary conditions in one FSM run-loop per sw value.
        for (sto_val, exp_fault) in [
            (sp_max_t,     None),
            (sp_min_t,     None),
            (sp_min_t - 1, FaultType.STACK_OVERFLOW),
            (sp_max_t + 1, FaultType.STACK_CORRUPT),
        ]:
            dut2 = ChurchCall()
            local_errors = []

            callee_cap = _build_cap(slot_id=1, perms=PERM_MASK_E, location=0x2000)
            ns_cap     = _build_cap(slot_id=0, perms=0, location=0x8000)
            code_cap   = _build_cap(slot_id=2, perms=PERM_MASK_E, location=0x9004)
            cr5_cap    = _build_cap(slot_id=5, perms=PERM_MASK_R | PERM_MASK_W, location=SP_STORE_ADDR)
            cr12_cap   = _build_cap(slot_id=12, perms=0, location=THREAD_BASE)
            callee_lump_hdr = _build_lump_hdr(n_minus_6=0, cc=4, cw=8, magic=0x5)

            async def proc(ctx):
                ctx.set(dut2.caller_pc, CALLER_PC)
                ctx.set(dut2.thread_base, THREAD_BASE)
                ctx.set(dut2.cr5_heap.as_value(), cr5_cap)
                ctx.set(dut2.cr12_thread.as_value(), cr12_cap)
                ctx.set(dut2.cr15_namespace.as_value(), ns_cap)
                ctx.set(dut2.cr14_code.as_value(), code_cap)
                ctx.set(dut2.thread_hdr, thr_hdr_val)
                ctx.set(dut2.mask, 0)
                ctx.set(dut2.index, 0)
                ctx.set(dut2.cr_src, 0)
                ctx.set(dut2.mload_done, 0)
                ctx.set(dut2.mload_fault, 0)
                ctx.set(dut2.mload_fault_type, 0)
                ctx.set(dut2.mem_rd_valid, 0)
                ctx.set(dut2.mem_rd_data, 0)
                ctx.set(dut2.cr_rd_data.as_value(), callee_cap)

                ctx.set(dut2.call_start, 1)
                await ctx.tick()
                ctx.set(dut2.call_start, 0)

                phase1_done = False
                mload_ack = False
                callee_served = False
                thr_served = False

                for _ in range(150):
                    comp   = ctx.get(dut2.call_complete)
                    fault  = ctx.get(dut2.call_fault)
                    ftype  = ctx.get(dut2.fault_type)
                    rd_en  = ctx.get(dut2.mem_rd_en)
                    rd_addr= ctx.get(dut2.mem_rd_addr)
                    ml_start = ctx.get(dut2.mload_start)

                    if mload_ack:
                        ctx.set(dut2.mload_done, 0)
                        mload_ack = False
                        if not phase1_done:
                            ctx.set(dut2.cr_rd_data.as_value(), CALLEE_EGT)
                            phase1_done = True
                        else:
                            ctx.set(dut2.cr_rd_data.as_value(), code_cap)

                    if ml_start:
                        ctx.set(dut2.mload_done, 1)
                        mload_ack = True

                    if rd_en:
                        if rd_addr == THREAD_BASE and not thr_served:
                            ctx.set(dut2.mem_rd_data, thr_hdr_val)
                            ctx.set(dut2.mem_rd_valid, 1)
                            thr_served = True
                        elif not callee_served and rd_addr != SP_STORE_ADDR and rd_addr != THREAD_BASE:
                            ctx.set(dut2.mem_rd_data, callee_lump_hdr)
                            ctx.set(dut2.mem_rd_valid, 1)
                            callee_served = True
                        elif rd_addr == SP_STORE_ADDR:
                            ctx.set(dut2.mem_rd_data, sto_val)
                            ctx.set(dut2.mem_rd_valid, 1)
                        else:
                            ctx.set(dut2.mem_rd_valid, 0)
                    else:
                        ctx.set(dut2.mem_rd_valid, 0)

                    if comp or fault:
                        if exp_fault is not None:
                            if not fault or ftype != exp_fault:
                                local_errors.append(
                                    f"sw={sw} STO={sto_val}: expected {exp_fault.name}"
                                    f", got fault={fault} ftype=0x{ftype:x}"
                                )
                        elif fault:
                            local_errors.append(
                                f"sw={sw} STO={sto_val}: unexpected fault 0x{ftype:x}"
                            )
                        break
                    await ctx.tick()
                else:
                    local_errors.append(f"sw={sw} STO={sto_val}: FSM did not complete")

            sim2 = Simulator(dut2)
            sim2.add_clock(1e-6)
            sim2.add_testbench(proc)
            sim2.run()

            errors.extend(local_errors)

        if errors:
            raise AssertionError("\n".join(errors))


if __name__ == "__main__":
    test_normal_push();      print("test_normal_push:      PASS")
    test_boundary_push();    print("test_boundary_push:    PASS")
    test_overflow();         print("test_overflow:         PASS")
    test_corrupt();          print("test_corrupt:          PASS")
    test_sw_parametrized();  print("test_sw_parametrized:  PASS")
