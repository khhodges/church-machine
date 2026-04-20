"""
Tests for NS slot word3 Abstract GT tag (Task #322).

Verifies:
  1. ChurchNSGate fetches NS entry W3 (abstract_gt) and latches it in raw_w3.
  2. ChurchMLoad forwards raw_w3 on ns_abstract_gt ONLY when m_elevated=1
     (M-bit gated); ns_abstract_gt is 0 when m_elevated=0.

test_ns_gate_fetches_w3
  Drives ChurchNSGate directly with enable_seal_check=False, supplies a
  fake memory that returns a known W3 value, and checks raw_w3 after DONE.

test_mload_abstract_gt_m_elevated
  Full mLoad transaction with m_elevated=1; verifies ns_abstract_gt carries
  the W3 value after COMPLETE.

test_mload_abstract_gt_user_mode
  Full mLoad transaction with m_elevated=0 (L-perm present so no fault);
  verifies ns_abstract_gt is always 0.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.ns_gate import ChurchNSGate
from hardware.mload import ChurchMLoad
from hardware.hw_types import (
    GT_TYPE_INFORM, GT_TYPE_NULL,
    PERM_MASK_R, PERM_MASK_W, PERM_MASK_L, PERM_MASK_E,
    FaultType,
)
from hardware.layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT
from hardware.integrity32 import integrity32
from hardware.boot_rom import _abstract_gt_word

MAX_TICKS = 200

SLOT_ID     = 6
NS_BASE     = 0x0000
LUMP_BASE   = 0x1000
CLIST_BASE  = 0x2000
INDEX       = 0

GT_SEQ      = 0
LIMIT_WORDS = 63
W1_AUTH     = ((GT_SEQ & 0x7F) << 21) | (LIMIT_WORDS & 0x1FFFFF)
W2_INTEG    = integrity32(LUMP_BASE, W1_AUTH)
ABSTRACT_GT = _abstract_gt_word(PERM_MASK_E)


def _build_gt(slot_id, gt_type=GT_TYPE_INFORM, perms=0, gt_seq=0, b_flag=0):
    w  = (slot_id & 0xFFFF)
    w |= (gt_seq  & 0x7F) << 16
    w |= (gt_type & 0x03) << 23
    w |= (perms   & 0x3F) << 25
    w |= (b_flag  & 0x01) << 31
    return w


def _build_cap(location=0, perms=0, slot_id=0, gt_type=GT_TYPE_INFORM,
               limit=LIMIT_WORDS, gt_seq=0):
    gt  = _build_gt(slot_id, gt_type=gt_type, perms=perms, gt_seq=gt_seq)
    w2  = ((gt_seq & 0x7F) << 21) | (limit & 0x1FFFFF)
    return gt | (location << 32) | (w2 << 64)


def _make_mem(with_w3=True):
    """Build a flat byte-indexed memory dict for the test scenario."""
    mem = {}
    ns_slot_base = NS_BASE + SLOT_ID * 16
    mem[ns_slot_base + 0]  = LUMP_BASE
    mem[ns_slot_base + 4]  = W1_AUTH
    mem[ns_slot_base + 8]  = W2_INTEG
    mem[ns_slot_base + 12] = ABSTRACT_GT if with_w3 else 0
    clist_addr = CLIST_BASE + INDEX * 4
    mem[clist_addr] = _build_gt(SLOT_ID, GT_TYPE_INFORM, perms=PERM_MASK_E)
    return mem


# ─── test_ns_gate_fetches_w3 ─────────────────────────────────────────────────

def test_ns_gate_fetches_w3():
    """ChurchNSGate latches NS W3 into raw_w3 after the gate completes."""
    dut = ChurchNSGate(enable_seal_check=False)

    ns_cap = _build_cap(location=NS_BASE, perms=PERM_MASK_L | PERM_MASK_R | PERM_MASK_W,
                        slot_id=0, limit=127)
    gt_w0  = _build_gt(SLOT_ID, GT_TYPE_INFORM, perms=PERM_MASK_E)

    mem = _make_mem()

    result = {}

    async def process(ctx):
        ctx.set(dut.cr15_namespace.as_value(), ns_cap)
        ctx.set(dut.gt_word0, gt_w0)
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        await ctx.tick()

        ctx.set(dut.ns_gate_start, 1)
        await ctx.tick()
        ctx.set(dut.ns_gate_start, 0)

        for _ in range(MAX_TICKS):
            await ctx.tick()
            addr = ctx.get(dut.mem_addr)
            rd_en = ctx.get(dut.mem_rd_en)
            if rd_en and addr in mem:
                ctx.set(dut.mem_rd_valid, 1)
                ctx.set(dut.mem_rd_data, mem[addr])
            else:
                ctx.set(dut.mem_rd_valid, 0)
                ctx.set(dut.mem_rd_data, 0)
            if ctx.get(dut.ns_gate_done):
                result["raw_w3"] = ctx.get(dut.raw_w3)
                break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert "raw_w3" in result, "ns_gate never reached DONE within MAX_TICKS"
    assert result["raw_w3"] == ABSTRACT_GT, (
        f"raw_w3=0x{result['raw_w3']:08X}  expected ABSTRACT_GT=0x{ABSTRACT_GT:08X}"
    )


# ─── helpers shared by mLoad tests ───────────────────────────────────────────

def _run_mload(m_elevated, max_ticks=MAX_TICKS):
    """Drive one mLoad transaction and return ns_abstract_gt at COMPLETE."""
    dut = ChurchMLoad(enable_seal_check=False)

    src_perms = PERM_MASK_L | PERM_MASK_R | PERM_MASK_W
    src_cap = _build_cap(location=CLIST_BASE, perms=src_perms, slot_id=0,
                         gt_type=GT_TYPE_INFORM, limit=127)
    ns_cap  = _build_cap(location=NS_BASE,    perms=PERM_MASK_L | PERM_MASK_R | PERM_MASK_W,
                         slot_id=0, gt_type=GT_TYPE_INFORM, limit=127)

    mem = _make_mem()

    result = {}

    async def process(ctx):
        ctx.set(dut.cr15_namespace.as_value(), ns_cap)
        ctx.set(dut.cr_rd_data.as_value(), src_cap)
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.outform_done_in, 0)
        ctx.set(dut.outform_fault_in, 0)
        await ctx.tick()

        ctx.set(dut.sub_start, 1)
        ctx.set(dut.sub_cr_src, 6)
        ctx.set(dut.sub_cr_dst, 8)
        ctx.set(dut.sub_index, INDEX)
        ctx.set(dut.sub_direct, 0)
        ctx.set(dut.sub_m_elevated, 1 if m_elevated else 0)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)

        for _ in range(max_ticks):
            await ctx.tick()
            addr = ctx.get(dut.mem_addr)
            rd_en = ctx.get(dut.mem_rd_en)
            if rd_en and addr in mem:
                ctx.set(dut.mem_rd_valid, 1)
                ctx.set(dut.mem_rd_data, mem[addr])
            else:
                ctx.set(dut.mem_rd_valid, 0)
                ctx.set(dut.mem_rd_data, 0)
            if ctx.get(dut.sub_done):
                result["ns_abstract_gt"] = ctx.get(dut.ns_abstract_gt)
                break
            if ctx.get(dut.sub_fault):
                result["fault"] = ctx.get(dut.sub_fault_type)
                break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()

    return result


def test_mload_abstract_gt_m_elevated():
    """With m_elevated=1 ns_abstract_gt carries NS W3 at COMPLETE."""
    result = _run_mload(m_elevated=True)
    assert "fault" not in result, f"unexpected fault 0x{result.get('fault', 0):02X}"
    assert "ns_abstract_gt" in result, "mLoad never reached COMPLETE"
    assert result["ns_abstract_gt"] == ABSTRACT_GT, (
        f"ns_abstract_gt=0x{result['ns_abstract_gt']:08X}  "
        f"expected 0x{ABSTRACT_GT:08X} (m_elevated=1)"
    )


def test_mload_abstract_gt_user_mode():
    """With m_elevated=0 ns_abstract_gt is always 0 (user-mode invisible)."""
    result = _run_mload(m_elevated=False)
    assert "fault" not in result, f"unexpected fault 0x{result.get('fault', 0):02X}"
    assert "ns_abstract_gt" in result, "mLoad never reached COMPLETE"
    assert result["ns_abstract_gt"] == 0, (
        f"ns_abstract_gt=0x{result['ns_abstract_gt']:08X}  "
        f"expected 0x00000000 (user-mode: M-bit gate must block W3)"
    )
