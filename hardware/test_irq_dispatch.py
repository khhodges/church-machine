"""Hardware cross-check test for ChurchIRQDispatch (Task #1523).

Three sub-tests — one per trigger condition — each confirming:
  (a) ChurchIRQDispatch is started with the correct irq_reason
  (b) The unit fetches NS slot 8 to locate Scheduler.IRQ lump base
  (c) The unit fetches the method-table entry at lump_base + METHOD_IDX*4
  (d) DR0 receives the correct reason code (0=TIMER, 1=LAZY_LOAD, 2=LAZY_RESOLVE)
  (e) DR1 receives the correct slot index
  (f) nia_set pulses with nia_value = ns_base + (method_entry << 2)

The unit is exercised in isolation (not via ChurchCore) so memory responses can
be injected directly through the unit's mem_rd_data / mem_rd_valid ports.

Run with:  python -m hardware.test_irq_dispatch
"""

import sys
from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from .irq_dispatch import ChurchIRQDispatch, SCHEDULER_IRQ_METHOD_IDX
from .hw_types import (
    IRQ_REASON_TIMER, IRQ_REASON_LAZY_LOAD, IRQ_REASON_LAZY_RESOLVE,
    SCHEDULER_IRQ_NS_SLOT,
)
from .layouts import CAP_REG_LAYOUT


# ---------------------------------------------------------------------------
# Test configuration constants
# ---------------------------------------------------------------------------

NS_TABLE_BASE  = 0x1000          # word1_location of the fake CR15
SCHED_LUMP_BASE = 0x2000         # ns_base returned from FETCH_NS
METHOD_ENTRY    = 3              # lump-base-relative word offset of IRQ entry
EXPECTED_NIA    = SCHED_LUMP_BASE + (METHOD_ENTRY << 2)   # 0x200C

# NS[SCHEDULER_IRQ_NS_SLOT].word0_location byte address:
#   irq_ns_addr = NS_TABLE_BASE + SCHEDULER_IRQ_NS_SLOT * 16
IRQ_NS_ADDR = NS_TABLE_BASE + SCHEDULER_IRQ_NS_SLOT * 16   # 0x1080

# Method-table entry byte address:
#   SCHED_LUMP_BASE + SCHEDULER_IRQ_METHOD_IDX * 4
METHOD_ADDR = SCHED_LUMP_BASE + SCHEDULER_IRQ_METHOD_IDX * 4   # 0x2014


# ---------------------------------------------------------------------------
# Shared testbench helper
# ---------------------------------------------------------------------------

async def _run_dispatch(ctx, dut, reason: int, slot: int):
    """Drive ChurchIRQDispatch for one complete dispatch sequence.

    Memory model:
      FETCH_NS reads IRQ_NS_ADDR → returns SCHED_LUMP_BASE
      FETCH_METHOD reads METHOD_ADDR → returns METHOD_ENTRY

    Asserts:
      - dr_wr_en pulses with dr_wr_data == reason  (DR0 write in WRITE_DR0)
      - dr1_wr_en pulses with dr1_wr_data == slot  (DR1 write in WRITE_DR1)
      - nia_set pulses with nia_value == EXPECTED_NIA  (COMPLETE)

    Returns (dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val).
    """
    ctx.set(dut.mem_rd_valid, 0)
    ctx.set(dut.mem_rd_data, 0)
    ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

    ctx.set(dut.irq_reason, reason)
    ctx.set(dut.irq_slot, slot)
    ctx.set(dut.start, 1)
    await ctx.tick()
    ctx.set(dut.start, 0)

    assert ctx.get(dut.busy) == 1, "busy should be 1 after start"

    # --- FETCH_NS: unit drives mem_rd_addr; respond with SCHED_LUMP_BASE ---
    assert ctx.get(dut.mem_rd_en) == 1, "FETCH_NS: mem_rd_en not asserted"
    addr_ns = ctx.get(dut.mem_rd_addr)
    assert addr_ns == IRQ_NS_ADDR, (
        f"FETCH_NS: expected mem_rd_addr={IRQ_NS_ADDR:#x}, got {addr_ns:#x}"
    )
    ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
    ctx.set(dut.mem_rd_valid, 1)
    await ctx.tick()

    ctx.set(dut.mem_rd_valid, 0)

    # --- FETCH_METHOD: unit latched ns_base; now reads method table entry ---
    assert ctx.get(dut.mem_rd_en) == 1, "FETCH_METHOD: mem_rd_en not asserted"
    addr_method = ctx.get(dut.mem_rd_addr)
    assert addr_method == METHOD_ADDR, (
        f"FETCH_METHOD: expected mem_rd_addr={METHOD_ADDR:#x}, got {addr_method:#x}"
    )
    ctx.set(dut.mem_rd_data, METHOD_ENTRY)
    ctx.set(dut.mem_rd_valid, 1)
    await ctx.tick()

    ctx.set(dut.mem_rd_valid, 0)
    ctx.set(dut.mem_rd_data, 0)

    # --- WRITE_DR0: check dr_wr_en + dr_wr_data ---
    dr_en   = ctx.get(dut.dr_wr_en)
    dr0_val = ctx.get(dut.dr_wr_data)
    dr0_ok  = (dr_en == 1) and (dr0_val == reason)
    await ctx.tick()

    # --- WRITE_DR1: check dr1_wr_en + dr1_wr_data ---
    dr1_en  = ctx.get(dut.dr1_wr_en)
    dr1_val = ctx.get(dut.dr1_wr_data)
    dr1_ok  = (dr1_en == 1) and (dr1_val == slot)
    await ctx.tick()

    # --- COMPLETE: nia_set should pulse ---
    nia_set_val = ctx.get(dut.nia_set)
    nia_val     = ctx.get(dut.nia_value)
    nia_ok      = (nia_set_val == 1) and (nia_val == EXPECTED_NIA)
    await ctx.tick()

    assert ctx.get(dut.busy) == 0, "busy should clear after COMPLETE→IDLE"

    return dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val


# ---------------------------------------------------------------------------
# Sub-test 1: TIMER condition  (DR0 = IRQ_REASON_TIMER = 0)
# ---------------------------------------------------------------------------

def test_irq_dispatch_timer():
    """TIMER alarm → DR0=0, DR1=0, NIA=Scheduler.IRQ entry."""
    dut = ChurchIRQDispatch()

    async def testbench(ctx):
        dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val = (
            await _run_dispatch(ctx, dut, IRQ_REASON_TIMER, 0)
        )
        assert dr0_ok, (
            f"TIMER: DR0 write failed — expected reason={IRQ_REASON_TIMER}, "
            f"got dr_wr_data={dr0_val}"
        )
        assert dr1_ok, f"TIMER: DR1 write failed — expected slot=0, got {dr1_val}"
        assert nia_ok, (
            f"TIMER: NIA wrong — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        print(f"  PASS: TIMER → DR0={dr0_val} (IRQ_REASON_TIMER), "
              f"DR1={dr1_val}, NIA={nia_val:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_timer")


# ---------------------------------------------------------------------------
# Sub-test 2: LAZY_LOAD condition  (DR0 = IRQ_REASON_LAZY_LOAD = 1)
# ---------------------------------------------------------------------------

def test_irq_dispatch_lazy_load():
    """CALL pipeline detected cw=0 → DR0=1, DR1=evicted NS slot, NIA correct."""
    dut = ChurchIRQDispatch()
    EVICTED_SLOT = 7   # fake NS slot of the evicted lump

    async def testbench(ctx):
        dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val = (
            await _run_dispatch(ctx, dut, IRQ_REASON_LAZY_LOAD, EVICTED_SLOT)
        )
        assert dr0_ok, (
            f"LAZY_LOAD: DR0 write failed — expected reason={IRQ_REASON_LAZY_LOAD}, "
            f"got dr_wr_data={dr0_val}"
        )
        assert dr1_ok, (
            f"LAZY_LOAD: DR1 write failed — expected slot={EVICTED_SLOT}, "
            f"got {dr1_val}"
        )
        assert nia_ok, (
            f"LAZY_LOAD: NIA wrong — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        print(f"  PASS: LAZY_LOAD → DR0={dr0_val} (IRQ_REASON_LAZY_LOAD), "
              f"DR1={dr1_val} (evicted_slot={EVICTED_SLOT}), NIA={nia_val:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_lazy_load")


# ---------------------------------------------------------------------------
# Sub-test 3: LAZY_RESOLVE condition  (DR0 = IRQ_REASON_LAZY_RESOLVE = 2)
# ---------------------------------------------------------------------------

def test_irq_dispatch_lazy_resolve():
    """NULL GT in c-list slot → DR0=2, DR1=c-list slot index, NIA correct."""
    dut = ChurchIRQDispatch()
    CLIST_SLOT = 3   # fake c-list slot index of the NULL GT

    async def testbench(ctx):
        dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val = (
            await _run_dispatch(ctx, dut, IRQ_REASON_LAZY_RESOLVE, CLIST_SLOT)
        )
        assert dr0_ok, (
            f"LAZY_RESOLVE: DR0 write failed — expected reason={IRQ_REASON_LAZY_RESOLVE}, "
            f"got dr_wr_data={dr0_val}"
        )
        assert dr1_ok, (
            f"LAZY_RESOLVE: DR1 write failed — expected slot={CLIST_SLOT}, "
            f"got {dr1_val}"
        )
        assert nia_ok, (
            f"LAZY_RESOLVE: NIA wrong — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        print(f"  PASS: LAZY_RESOLVE → DR0={dr0_val} (IRQ_REASON_LAZY_RESOLVE), "
              f"DR1={dr1_val} (clist_slot={CLIST_SLOT}), NIA={nia_val:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_lazy_resolve")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("ChurchIRQDispatch Cross-Check Tests (Task #1523)")
    print("Three conditions → ELOADCALL to Scheduler.IRQ (NS slot 8)")
    print("=" * 60)

    tests = [
        test_irq_dispatch_timer,
        test_irq_dispatch_lazy_load,
        test_irq_dispatch_lazy_resolve,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as exc:
            print(f"FAIL: {t.__name__}: {exc}")
            failed += 1

    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    if failed:
        print("SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
