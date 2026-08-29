"""
Amaranth testbench for ChurchCall hardware method-table dispatch.

Covers the FETCH_METHOD_ENTRY FSM state and the nia_computed Mux:

  CALL imm15=0  → fast path: NIA = lump_base + 4 (backward-compat single entry).
  CALL imm15=n  → table dispatch: NIA = lump_base + table_entry * 4
                  where table_entry = Mem[lump_base + n*4] (a word offset).
  CALL imm15=n, Mem[lump_base + n*4] = 0  → PRIVATE_METHOD fault (FaultType.PERM_E).

Memory map used in these tests:
  LUMP_BASE     = 0x9000   CR14.word1_location after Phase 2 mLoad (raw lump base)
  SP_STORE_ADDR = 0x3000   Heap[0] — holds the current stack-top offset (STO)
  THREAD_BASE   = 0x4000   Base of the thread lump

FSM states exercised:
  IDLE → CHECK_SRC → READ_SRC → CHECK_PERM → PHASE1 → PHASE1_DONE → PHASE2
  → SET_M_READ → SET_M_WRITE → FETCH_LUMP
    → (imm=0) SET_CR14_LIMIT_WRITE → … → COMPLETE          (test_imm0_fast_path)
    → (imm>0) FETCH_METHOD_ENTRY → SET_CR14_LIMIT_WRITE → … → COMPLETE  (test_imm_table_dispatch)
    → (imm>0, entry=0) FETCH_METHOD_ENTRY → FAULT            (test_private_method_fault)
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.call import ChurchCall
from hardware.hw_types import (
    FaultType, PERM_MASK_E, PERM_MASK_R, PERM_MASK_W,
    GT_TYPE_INFORM,
    PERM_E,
    make_gt,
)
from hardware.layouts import CAP_REG_LAYOUT

LUMP_BASE     = 0x9000
SP_STORE_ADDR = 0x3000
THREAD_BASE   = 0x4000
CALLER_PC     = 10
CALLEE_EGT    = 0x4A000001

CALLEE_N6 = 0
CALLEE_CC = 4
CALLEE_CW = 8

THR_N6 = 2
THR_CC = 12
THR_SW = 32
LUMP_SIZE = 1 << (THR_N6 + 6)
SP_MAX    = LUMP_SIZE - THR_CC - 1
INITIAL_STO = SP_MAX


def _build_gt(slot_id=0, gt_seq=0, gt_type=GT_TYPE_INFORM, perms=0, b_flag=0):
    return make_gt(gt_type=gt_type, perms=perms, slot_id=slot_id,
                   gt_seq=gt_seq, b_flag=b_flag)


def _build_cap(slot_id=0, perms=0, location=0):
    gt = _build_gt(slot_id=slot_id, perms=perms)
    return gt | (location << 32)


def _build_lump_hdr(n_minus_6=0, cc=4, cw=8, magic=0x5):
    h  = (cc        & 0xFF)
    h |= (cw        & 0x1FFF) << 10
    h |= (n_minus_6 & 0x0F)   << 23
    h |= (magic     & 0x1F)   << 27
    return h


def _run_dispatch(call_imm_val, method_entry_word=0,
                  expect_nia=None, expect_fault=None):
    """
    Run a single CALL simulation and assert the expected outcome.

    call_imm_val:       value driven on dut.call_imm before call_start (0..32767).
    method_entry_word:  word returned from the method-table fetch (ignored when
                        call_imm_val=0; 0 → PRIVATE_METHOD fault).
    expect_nia:         expected nia_value when nia_set fires (None = skip / fault case).
    expect_fault:       FaultType to expect; None = expect clean completion.
    """
    dut = ChurchCall()
    errors = []

    callee_cap      = _build_cap(slot_id=1, perms=PERM_MASK_E, location=0x2000)
    ns_cap          = _build_cap(slot_id=0, perms=0, location=0x8000)
    code_cap        = _build_cap(slot_id=2, perms=PERM_MASK_E, location=LUMP_BASE)
    cr5_cap         = _build_cap(slot_id=5, perms=PERM_MASK_R | PERM_MASK_W, location=SP_STORE_ADDR)
    cr12_cap        = _build_cap(slot_id=12, perms=0, location=THREAD_BASE)
    callee_lump_hdr = _build_lump_hdr(n_minus_6=CALLEE_N6, cc=CALLEE_CC, cw=CALLEE_CW, magic=0x5)
    thr_hdr         = _build_lump_hdr(n_minus_6=THR_N6, cc=THR_CC, cw=THR_SW, magic=0x1F)

    method_table_addr = LUMP_BASE + call_imm_val * 4

    nia_captured = [None]

    async def process(ctx):
        ctx.set(dut.caller_pc,           CALLER_PC)
        ctx.set(dut.thread_base,         THREAD_BASE)
        ctx.set(dut.cr5_heap.as_value(), cr5_cap)
        ctx.set(dut.cr12_thread.as_value(), cr12_cap)
        ctx.set(dut.cr15_namespace.as_value(), ns_cap)
        ctx.set(dut.cr14_code.as_value(), code_cap)
        ctx.set(dut.thread_hdr,          thr_hdr)
        ctx.set(dut.mask,                0)
        ctx.set(dut.index,               0)
        ctx.set(dut.cr_src,              0)
        ctx.set(dut.call_imm,            call_imm_val)
        ctx.set(dut.mload_done,          0)
        ctx.set(dut.mload_fault,         0)
        ctx.set(dut.mload_fault_type,    0)
        ctx.set(dut.mem_rd_valid,        0)
        ctx.set(dut.mem_rd_data,         0)
        ctx.set(dut.cr_rd_data.as_value(), callee_cap)

        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)

        phase1_done        = False
        mload_ack_pending  = False
        pending_read = None
        read_ops = []

        MAX_TICKS = 180
        for _ in range(MAX_TICKS):
            comp     = ctx.get(dut.call_complete)
            fault    = ctx.get(dut.call_fault)
            ftype    = ctx.get(dut.fault_type)
            rd_en    = ctx.get(dut.mem_rd_en)
            rd_addr  = ctx.get(dut.mem_rd_addr)
            ml_start = ctx.get(dut.mload_start)
            nia_set  = ctx.get(dut.nia_set)
            nia_val  = ctx.get(dut.nia_value)

            if nia_set:
                nia_captured[0] = nia_val

            if mload_ack_pending:
                ctx.set(dut.mload_done, 0)
                mload_ack_pending = False
                if not phase1_done:
                    ctx.set(dut.cr_rd_data.as_value(), CALLEE_EGT)
                    phase1_done = True
                else:
                    ctx.set(dut.cr_rd_data.as_value(), code_cap)

            if ml_start:
                ctx.set(dut.mload_done, 1)
                mload_ack_pending = True

            # Model synchronous memory explicitly: capture the request now,
            # assert valid/data on the next cycle, and require CALL to keep the
            # request stable until that response is consumed.
            ctx.set(dut.mem_rd_valid, 0)
            if pending_read is not None:
                pending_addr, pending_data = pending_read
                if not rd_en or rd_addr != pending_addr:
                    errors.append(
                        "Memory protocol failure: CALL changed or dropped "
                        f"read 0x{pending_addr:08x} before its response cycle"
                    )
                    break
                ctx.set(dut.mem_rd_data, pending_data)
                ctx.set(dut.mem_rd_valid, 1)
                read_ops.append(pending_addr)
                pending_read = None
            elif rd_en:
                if rd_addr == LUMP_BASE:
                    pending_read = (rd_addr, callee_lump_hdr)
                elif call_imm_val > 0 and rd_addr == method_table_addr:
                    pending_read = (rd_addr, method_entry_word)
                elif rd_addr == SP_STORE_ADDR:
                    pending_read = (rd_addr, INITIAL_STO)
                else:
                    errors.append(
                        "Memory protocol failure: unexpected CALL read address "
                        f"0x{rd_addr:08x}"
                    )
                    break

            if comp or fault:
                if expect_fault is not None:
                    if not fault:
                        errors.append(
                            f"Expected fault {expect_fault!r} but got completion with no fault"
                        )
                    elif ftype != int(expect_fault):
                        errors.append(
                            f"Wrong fault type: expected {expect_fault.name}=0x{int(expect_fault):x},"
                            f" got 0x{ftype:x}"
                        )
                elif fault:
                    errors.append(f"Unexpected fault 0x{ftype:x}")
                break

            await ctx.tick()
        else:
            errors.append(
                f"FSM did not complete within {MAX_TICKS} ticks; "
                f"acknowledged reads={[f'0x{addr:08x}' for addr in read_ops]}, "
                f"pending={pending_read}"
            )

        if expect_fault is None and expect_nia is not None:
            if nia_captured[0] is None:
                errors.append(f"nia_set never fired; expected NIA=0x{expect_nia:08x}")
            elif nia_captured[0] != expect_nia:
                errors.append(
                    f"NIA mismatch: expected 0x{expect_nia:08x},"
                    f" got 0x{nia_captured[0]:08x}"
                )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    sim.run()

    if errors:
        raise AssertionError("\n".join(errors))


def test_imm0_fast_path():
    """
    CALL imm15=0 → NIA = lump_base + 4 (backward-compat single entry point).

    FETCH_METHOD_ENTRY is NOT entered; the FSM jumps directly from FETCH_LUMP
    to SET_CR14_LIMIT_WRITE.  nia_computed selects the imm==0 branch of the Mux:
      NIA = ns_base_from_cr14 + 4 = LUMP_BASE + 4.
    """
    _run_dispatch(
        call_imm_val=0,
        method_entry_word=0,
        expect_nia=LUMP_BASE + 4,
        expect_fault=None,
    )


def test_imm_table_dispatch():
    """
    CALL imm15=2, method table entry=5 → NIA = lump_base + 5*4.

    FETCH_METHOD_ENTRY reads Mem[LUMP_BASE + 2*4] = 5 (word offset).
    nia_computed selects the imm>0 branch:
      NIA = ns_base_from_cr14 + method_entry_reg * 4 = LUMP_BASE + 20.
    """
    METHOD_IDX   = 2
    ENTRY_WORD   = 5
    expected_nia = LUMP_BASE + ENTRY_WORD * 4
    _run_dispatch(
        call_imm_val=METHOD_IDX,
        method_entry_word=ENTRY_WORD,
        expect_nia=expected_nia,
        expect_fault=None,
    )


def test_imm_table_dispatch_index1():
    """
    CALL imm15=1, method table entry=3 → NIA = lump_base + 3*4.

    Exercises the first valid table slot (index 1 = word 1 of the lump,
    which follows the header at word 0).
    """
    METHOD_IDX   = 1
    ENTRY_WORD   = 3
    expected_nia = LUMP_BASE + ENTRY_WORD * 4
    _run_dispatch(
        call_imm_val=METHOD_IDX,
        method_entry_word=ENTRY_WORD,
        expect_nia=expected_nia,
        expect_fault=None,
    )


def test_private_method_fault():
    """
    CALL imm15=2, method table entry=0 → PRIVATE_METHOD fault (FaultType.PERM_E).

    Table entry 0 signals that the method is private (or the index is out of
    range).  FETCH_METHOD_ENTRY transitions to FAULT with FaultType.PERM_E.
    """
    _run_dispatch(
        call_imm_val=2,
        method_entry_word=0,
        expect_nia=None,
        expect_fault=FaultType.PERM_E,
    )


def test_private_method_fault_index1():
    """
    CALL imm15=1, method table entry=0 → PRIVATE_METHOD fault (FaultType.PERM_E).

    Confirms the zero-entry check fires for index 1 as well as higher indices.
    """
    _run_dispatch(
        call_imm_val=1,
        method_entry_word=0,
        expect_nia=None,
        expect_fault=FaultType.PERM_E,
    )


if __name__ == "__main__":
    test_imm0_fast_path();           print("test_imm0_fast_path:           PASS")
    test_imm_table_dispatch();       print("test_imm_table_dispatch:       PASS")
    test_imm_table_dispatch_index1();print("test_imm_table_dispatch_index1:PASS")
    test_private_method_fault();     print("test_private_method_fault:     PASS")
    test_private_method_fault_index1();print("test_private_method_fault_index1:PASS")
