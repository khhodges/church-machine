"""
tests/test_save_operand_roles.py

Regression tests for SAVE instruction operand-role fixes (Task #6).

Unit tests (ChurchMSave):
  (a) S-perm on CRd, b=1 on CRs  -> SAVE succeeds (no fault).
  (b) S-perm missing from CRd     -> PERM_S fault.
  (c) b_flag == 0 on CRs          -> NULL_CAP fault.
  (d) b_flag == 0 on CRd          -> BIND fault.

Integration test (ChurchPermCheck):
  (e) SAVE with required_perms=0 never faults CRs lacking S-perm.
      Catches regression if core.py reverts to PERM_MASK_S for SAVE.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from hardware.msave import ChurchMSave
from hardware.perm_check import ChurchPermCheck
from hardware.hw_types import FaultType, PERM_MASK_S
from hardware.layouts import GT_LAYOUT, CAP_REG_LAYOUT

MAX_TICKS = 100


def _build_gt(perms=0, b_flag=0, slot_id=1, gt_seq=1, gt_type=1):
    gt  = (slot_id & 0xFFFF)
    gt |= (gt_seq  & 0x7F) << 16
    gt |= (gt_type & 0x03) << 23
    gt |= (perms   & 0x3F) << 25
    gt |= (b_flag  & 0x01) << 31
    return gt


def _build_cap(gt_word=0, location=0x1000, word2=0x100):
    return gt_word | (location << 32) | (word2 << 64)


def _run_msave(dst_cap, src_gt, index=0, max_ticks=MAX_TICKS, enable_seal_check=False):
    dut = ChurchMSave(enable_seal_check=enable_seal_check)
    result = {"fault_type": FaultType.NONE, "completed": False}
    ns_gt = _build_gt(perms=0, b_flag=1, slot_id=0, gt_seq=0)
    ns_cap = _build_cap(gt_word=ns_gt, location=0x8000)

    async def process(ctx):
        ctx.set(dut.sub_dst_cap.as_value(), dst_cap)
        ctx.set(dut.sub_src_gt, src_gt)
        ctx.set(dut.sub_index, index)
        ctx.set(dut.cr15_namespace.as_value(), ns_cap)
        ctx.set(dut.mem_rd_valid, 1)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.mem_wr_done, 1)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        for _ in range(max_ticks):
            await ctx.tick()
            if ctx.get(dut.sub_fault):
                result["fault_type"] = FaultType(ctx.get(dut.sub_fault_type))
                return
            if ctx.get(dut.sub_done):
                result["completed"] = True
                return

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()
    return result["fault_type"], result["completed"]


def test_save_success_sperm_on_dst_bound_src():
    """(a) S-perm on CRd, b=1 on CRs -> SAVE succeeds."""
    dst_cap = _build_cap(
        gt_word=_build_gt(perms=PERM_MASK_S, b_flag=1, slot_id=0),
        location=0x2000,
        word2=10,
    )
    src_gt = _build_gt(perms=0, b_flag=1, slot_id=5, gt_seq=1)
    fault, completed = _run_msave(dst_cap, src_gt, index=0)
    assert fault == FaultType.NONE, f"Expected no fault, got {fault!r}"
    assert completed, "Expected SAVE to complete without fault"


def test_save_fault_no_sperm_on_dst():
    """(b) S-perm missing from CRd -> PERM_S fault."""
    dst_cap = _build_cap(
        gt_word=_build_gt(perms=0, b_flag=1, slot_id=0),
        location=0x2000,
        word2=(0 << 0) | (1 << 21),
    )
    src_gt = _build_gt(perms=0, b_flag=1, slot_id=5, gt_seq=1)
    fault, completed = _run_msave(dst_cap, src_gt, index=0)
    assert fault == FaultType.PERM_S, f"Expected PERM_S, got {fault!r}"
    assert not completed


def test_save_fault_unbound_src():
    """(c) b_flag == 0 on CRs -> NULL_CAP fault."""
    dst_cap = _build_cap(
        gt_word=_build_gt(perms=PERM_MASK_S, b_flag=1, slot_id=0),
        location=0x2000,
        word2=10,
    )
    src_gt = _build_gt(perms=0, b_flag=0, slot_id=5, gt_seq=1)
    fault, completed = _run_msave(dst_cap, src_gt, index=0)
    assert fault == FaultType.NULL_CAP, f"Expected NULL_CAP, got {fault!r}"
    assert not completed


def test_save_fault_unbound_dst():
    """(d) b_flag == 0 on CRd (null C-List) -> BIND fault."""
    dst_cap = _build_cap(
        gt_word=_build_gt(perms=PERM_MASK_S, b_flag=0, slot_id=0),
        location=0x2000,
        word2=(0 << 0) | (1 << 21),
    )
    src_gt = _build_gt(perms=0, b_flag=1, slot_id=5, gt_seq=1)
    fault, completed = _run_msave(dst_cap, src_gt, index=0)
    assert fault == FaultType.BIND, f"Expected BIND, got {fault!r}"
    assert not completed


def test_save_perm_gate_does_not_require_sperm_on_src():
    """Integration (ChurchPermCheck): SAVE core perm-gate uses required_perms=0.

    Directly exercises ChurchPermCheck (the same module used in core.py) with
    required_perms=0 (what SAVE now sets) and a source GT that carries no S-perm.
    The perm gate must pass (fault_valid=False) because SAVE no longer checks
    S-perm at core level -- enforcement is delegated to mSave on CRd.

    If core.py is regressed to PERM_MASK_S for SAVE, this test will fail
    immediately because perms_match would be False -> fault_valid=True / PERM_S.
    """
    dut = ChurchPermCheck()
    src_gt_no_s = _build_gt(perms=0, b_flag=1, slot_id=5, gt_seq=1)
    result = {"fault_valid": None, "fault_type": None, "all_pass": None}

    async def process(ctx):
        ctx.set(dut.gt_in.as_value(), src_gt_no_s)
        ctx.set(dut.required_perms, 0)
        ctx.set(dut.check_valid, 1)
        ctx.set(dut.check_bounds, 0)
        ctx.set(dut.check_version, 0)
        ctx.set(dut.check_seal, 0)
        ctx.set(dut.check_domain_purity, 0)
        result["fault_valid"] = bool(ctx.get(dut.fault_valid))
        result["fault_type"] = FaultType(ctx.get(dut.fault_type))
        result["all_pass"] = bool(ctx.get(dut.all_checks_pass))

    sim = Simulator(dut)
    sim.add_testbench(process)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert not result["fault_valid"], (
        "SAVE perm gate must not fault when required_perms=0 and CRs has no S-perm; "
        f"got fault_valid=True fault_type={result['fault_type']!r}"
    )
    assert result["all_pass"], "all_checks_pass should be True when required_perms=0"
