"""
Focused simulation test for ChurchCall stack push states.

Scenarios:
  1. Normal push  — sp+2 well within limit → correct frame writes + SP update
  2. Boundary     — sp+2 == limit exactly  → should succeed
  3. Overflow     — sp+2 > limit           → FaultType.STACK_OVERFLOW

Uses an event-driven helper loop that auto-responds to mload_start and
mem_rd_en so the test is not fragile to exact tick counts.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator, Tick

from hardware.call import ChurchCall
from hardware.hw_types import (
    FaultType, PERM_MASK_E, PERM_MASK_X, GT_TYPE_REAL,
    PERM_E,
)
from hardware.layouts import GT_LAYOUT, CAP_REG_LAYOUT


# Fixed test constants
THREAD_BASE   = 0x4000   # u_call.thread_base (byte base of thread stack zone)
SP_STORE_ADDR = 0x3000   # CR5.word1_location (where SP word-offset is stored)
LAMBDA_FRAME  = 0x11223344   # u_call.lambda_frame_reg value
CALLEE_EGT    = 0x40800001   # E-GT deposited into CR6 by Phase 1 mLoad


def _build_gt(slot_id=0, gt_seq=0, gt_type=GT_TYPE_REAL, perms=0, b_flag=0):
    """Build a 32-bit GT word matching GT_LAYOUT bit positions.

    GT_LAYOUT (layouts.py):
        slot_id  unsigned(16)  [15:0]
        gt_seq   unsigned(7)   [22:16]
        gt_type  unsigned(2)   [24:23]
        perms    unsigned(6)   [30:25]
        b_flag   unsigned(1)   [31]
    """
    gt  = (slot_id & 0xFFFF)
    gt |= (gt_seq  & 0x7F) << 16
    gt |= (gt_type & 0x03) << 23
    gt |= (perms   & 0x3F) << 25
    gt |= (b_flag  & 0x01) << 31
    return gt


def _build_cap(slot_id=0, perms=0, location=0):
    """128-bit CAP_REG_LAYOUT value: word0_gt | word1_location<<32."""
    gt = _build_gt(slot_id=slot_id, perms=perms)
    return gt | (location << 32)


def _build_lump(n_minus_6=0, cc=4, cw=8, magic=0x5):
    """LUMP_HEADER_LAYOUT: cc[7:0] | typ[9:8] | cw[22:10] | n_minus_6[26:23] | magic[31:27]"""
    h  = (cc         & 0xFF)
    h |= (cw         & 0x1FFF) << 10
    h |= (n_minus_6  & 0x0F)   << 23
    h |= (magic      & 0x1F)   << 27
    return h


def _run_scenario(initial_sp, stack_limit, expect_overflow):
    dut = ChurchCall()
    errors = []

    # Stimuli chosen once per scenario
    callee_cap  = _build_cap(slot_id=1, perms=PERM_MASK_E, location=0x2000)
    cr6_cap     = CALLEE_EGT           # low 32 bits = E-GT, upper 96 bits = 0
    ns_cap      = _build_cap(slot_id=0, perms=0, location=0x8000)
    # code cap: location = NS_base + 4 (i.e. NS_base = 0x9000)
    code_cap    = _build_cap(slot_id=2, perms=PERM_MASK_E, location=0x9004)
    cr5_cap     = _build_cap(slot_id=5, perms=0, location=SP_STORE_ADDR)
    lump_hdr    = _build_lump(n_minus_6=0, cc=4, cw=8)

    # Collected memory write ops: list of (addr, data)
    wr_ops = []

    def process():
        # ── static inputs ──────────────────────────────────────────────────────
        yield dut.stack_limit.eq(stack_limit)
        yield dut.lambda_frame_reg.eq(LAMBDA_FRAME)
        yield dut.thread_base.eq(THREAD_BASE)
        yield dut.cr5_heap.eq(cr5_cap)
        yield dut.cr15_namespace.eq(ns_cap)
        yield dut.cr14_code.eq(code_cap)
        yield dut.mask.eq(0)       # no null-GT writes
        yield dut.index.eq(0)
        yield dut.cr_src.eq(0)
        yield dut.mload_done.eq(0)
        yield dut.mload_fault.eq(0)
        yield dut.mload_fault_type.eq(0)
        yield dut.mem_rd_valid.eq(0)
        yield dut.mem_rd_data.eq(0)
        yield dut.cr_rd_data.eq(callee_cap)   # READ_SRC latches this

        # ── start CALL ─────────────────────────────────────────────────────────
        yield dut.call_start.eq(1)
        yield Tick()
        yield dut.call_start.eq(0)

        # ── event-driven loop ──────────────────────────────────────────────────
        # Track simulation state to serve correct responses.
        phase1_done = False
        phase2_done = False
        mload_ack_pending = False   # True after mload_start seen, pulse done next cycle
        lump_served = False

        MAX_TICKS = 120
        for t in range(MAX_TICKS):
            busy   = yield dut.call_busy
            comp   = yield dut.call_complete
            fault  = yield dut.call_fault
            ftype  = yield dut.fault_type
            rd_en  = yield dut.mem_rd_en
            rd_addr= yield dut.mem_rd_addr
            wr_en  = yield dut.mem_wr_en
            wr_addr= yield dut.mem_wr_addr
            wr_data= yield dut.mem_wr_data
            ml_start = yield dut.mload_start

            # ── collect memory writes ──────────────────────────────────────────
            if wr_en:
                wr_ops.append((wr_addr, wr_data))

            # ── auto-respond to mLoad ──────────────────────────────────────────
            if mload_ack_pending:
                yield dut.mload_done.eq(0)
                mload_ack_pending = False
                if not phase1_done:
                    # PHASE1 just completed — next cycle is PHASE1_DONE which
                    # combinatorially reads CR6; supply the callee E-GT there.
                    yield dut.cr_rd_data.eq(cr6_cap)
                    phase1_done = True
                else:
                    # PHASE2 just completed — SET_M_READ will read CR14.
                    yield dut.cr_rd_data.eq(code_cap)
                    phase2_done = True

            if ml_start:
                # Acknowledge mLoad one cycle later
                yield dut.mload_done.eq(1)
                mload_ack_pending = True

            # ── auto-respond to memory reads ──────────────────────────────────
            if rd_en and not lump_served and rd_addr != SP_STORE_ADDR:
                # FETCH_LUMP read (not the SP read)
                yield dut.mem_rd_data.eq(lump_hdr)
                yield dut.mem_rd_valid.eq(1)
                lump_served = True
            elif rd_en and rd_addr == SP_STORE_ADDR:
                # STACK_READ_SP read
                yield dut.mem_rd_data.eq(initial_sp)
                yield dut.mem_rd_valid.eq(1)
            else:
                yield dut.mem_rd_valid.eq(0)

            if comp or fault:
                # Verify outcomes
                if expect_overflow:
                    if not fault:
                        errors.append(
                            f"Expected STACK_OVERFLOW fault, got comp=1 with no fault"
                        )
                    elif ftype != FaultType.STACK_OVERFLOW:
                        errors.append(
                            f"Wrong fault type: expected STACK_OVERFLOW=0x{FaultType.STACK_OVERFLOW:x},"
                            f" got 0x{ftype:x}"
                        )
                break

            yield Tick()
        else:
            errors.append(f"FSM did not complete within {MAX_TICKS} ticks")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_process(process)
    sim.run()

    if errors:
        raise AssertionError("\n".join(errors))

    # ── verify write sequence for non-overflow cases ───────────────────────────
    if not expect_overflow:
        # Filter to only the three stack writes (last 3 entries).
        # Other writes go to CR registers (addr 0..15), so filter by addr > 15.
        stack_writes = [(a, d) for a, d in wr_ops if a > 15]

        if len(stack_writes) < 3:
            raise AssertionError(
                f"Expected ≥3 stack memory writes, got {len(stack_writes)}: {stack_writes}"
            )

        # Frame word 0: callee E-GT at thread_base + sp*4
        exp0_addr = THREAD_BASE + initial_sp * 4
        a0, d0 = stack_writes[0]
        assert a0 == exp0_addr, (
            f"STACK_WRITE_EGT addr: expected 0x{exp0_addr:08x}, got 0x{a0:08x}"
        )
        assert d0 == CALLEE_EGT, (
            f"STACK_WRITE_EGT data: expected 0x{CALLEE_EGT:08x}, got 0x{d0:08x}"
        )

        # Frame word 1: LAMBDA frame reg at thread_base + (sp+1)*4
        exp1_addr = THREAD_BASE + (initial_sp + 1) * 4
        a1, d1 = stack_writes[1]
        assert a1 == exp1_addr, (
            f"STACK_WRITE_FRAME addr: expected 0x{exp1_addr:08x}, got 0x{a1:08x}"
        )
        assert d1 == LAMBDA_FRAME, (
            f"STACK_WRITE_FRAME data: expected 0x{LAMBDA_FRAME:08x}, got 0x{d1:08x}"
        )

        # SP update: sp+2 written back to SP_STORE_ADDR
        a2, d2 = stack_writes[2]
        assert a2 == SP_STORE_ADDR, (
            f"STACK_WRITE_SP addr: expected 0x{SP_STORE_ADDR:08x}, got 0x{a2:08x}"
        )
        assert d2 == initial_sp + 2, (
            f"STACK_WRITE_SP data: expected {initial_sp + 2}, got {d2}"
        )


def test_normal_push():
    """SP=10, limit=256: frame at correct addresses, SP incremented by 2."""
    _run_scenario(initial_sp=10, stack_limit=256, expect_overflow=False)


def test_boundary_push():
    """SP=254, limit=256: sp+2==limit is valid (condition is strictly >)."""
    _run_scenario(initial_sp=254, stack_limit=256, expect_overflow=False)


def test_overflow():
    """SP=255, limit=256: sp+2=257>256 => STACK_OVERFLOW fault."""
    _run_scenario(initial_sp=255, stack_limit=256, expect_overflow=True)


if __name__ == "__main__":
    test_normal_push();   print("test_normal_push:   PASS")
    test_boundary_push(); print("test_boundary_push: PASS")
    test_overflow();      print("test_overflow:      PASS")
