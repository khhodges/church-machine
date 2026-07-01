"""Hardware cross-check test for ChurchIRQDispatch.

Sub-tests — one per trigger condition — each confirming:
  (a) ChurchIRQDispatch is started with the correct irq_reason
  (b) The unit fetches NS slot 8 to locate Scheduler.IRQ lump base
  (c) The unit fetches the method-table entry at lump_base + METHOD_IDX*4
  (d) DR0 receives the correct reason code (0=TIMER, 1=LAZY_LOAD, 2=LAZY_RESOLVE)
  (e) DR1 receives the correct slot index
  (f) nia_set pulses with nia_value = ns_base + (method_entry << 2)

Also covers:
  - Simultaneous-trigger stall (busy blocks re-entry, latched values preserved)
  - Null-base guard (ns_base==0 → null_base_fault, nia_set never fires)
  - XLOADLAMBDA NULL-body path (same dispatch as ELOADCALL LAZY_RESOLVE)
  - Pending-trigger hold-and-replay (second trigger captured while busy, auto-
    replayed after in-flight dispatch completes, no external re-pulse needed)

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
    SCHEDULER_IRQ_NS_SLOT, FaultType,
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
# Helper: service one complete dispatch starting from FETCH_NS
#
# Used by the pending-replay tests where the second dispatch auto-starts
# (no external start pulse) and memory must be serviced manually.
# ---------------------------------------------------------------------------

async def _service_pending_dispatch(ctx, dut, expected_reason: int, expected_slot: int):
    """Service memory reads for a dispatch that is already in FETCH_NS.

    Asserts that DR0/DR1/NIA carry the expected values from the *second*
    (pending-replayed) dispatch.  Returns (dr0_val, dr1_val, nia_val).
    """
    # FETCH_NS
    assert ctx.get(dut.mem_rd_en) == 1, "pending FETCH_NS: mem_rd_en not asserted"
    addr_ns = ctx.get(dut.mem_rd_addr)
    assert addr_ns == IRQ_NS_ADDR, (
        f"pending FETCH_NS: expected {IRQ_NS_ADDR:#x}, got {addr_ns:#x}"
    )
    ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
    ctx.set(dut.mem_rd_valid, 1)
    await ctx.tick()
    ctx.set(dut.mem_rd_valid, 0)

    # FETCH_METHOD
    assert ctx.get(dut.mem_rd_en) == 1, "pending FETCH_METHOD: mem_rd_en not asserted"
    addr_method = ctx.get(dut.mem_rd_addr)
    assert addr_method == METHOD_ADDR, (
        f"pending FETCH_METHOD: expected {METHOD_ADDR:#x}, got {addr_method:#x}"
    )
    ctx.set(dut.mem_rd_data, METHOD_ENTRY)
    ctx.set(dut.mem_rd_valid, 1)
    await ctx.tick()
    ctx.set(dut.mem_rd_valid, 0)
    ctx.set(dut.mem_rd_data, 0)

    # WRITE_DR0
    dr_en   = ctx.get(dut.dr_wr_en)
    dr0_val = ctx.get(dut.dr_wr_data)
    assert dr_en == 1, "pending WRITE_DR0: dr_wr_en not asserted"
    assert dr0_val == expected_reason, (
        f"pending DR0 wrong — expected {expected_reason}, got {dr0_val}"
    )
    await ctx.tick()

    # WRITE_DR1
    dr1_en  = ctx.get(dut.dr1_wr_en)
    dr1_val = ctx.get(dut.dr1_wr_data)
    assert dr1_en == 1, "pending WRITE_DR1: dr1_wr_en not asserted"
    assert dr1_val == expected_slot, (
        f"pending DR1 wrong — expected {expected_slot}, got {dr1_val}"
    )
    await ctx.tick()

    # COMPLETE
    nia_set_val = ctx.get(dut.nia_set)
    nia_val     = ctx.get(dut.nia_value)
    assert nia_set_val == 1, "pending COMPLETE: nia_set not asserted"
    assert nia_val == EXPECTED_NIA, (
        f"pending NIA wrong — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
    )
    await ctx.tick()

    assert ctx.get(dut.busy) == 0, "pending dispatch: busy must clear after COMPLETE→IDLE"
    return dr0_val, dr1_val, nia_val


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
# Sub-test 4: Simultaneous trigger during FETCH_NS stall
#
# Scenario: TIMER dispatch is already in FETCH_NS (waiting for mem_rd_valid).
# A second start pulse arrives with LAZY_LOAD reason.  The FSM is not in IDLE
# so the second trigger must be silently ignored — no DR/NIA corruption.
# ---------------------------------------------------------------------------

def test_irq_dispatch_simultaneous_fetch_ns():
    """Second IRQ fires during FETCH_NS stall → held off, first dispatch intact."""
    dut = ChurchIRQDispatch()
    INTRUDING_SLOT = 7   # slot carried by the second (spurious) start

    async def testbench(ctx):
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

        # --- Start first dispatch: TIMER, slot=0 ---
        ctx.set(dut.irq_reason, IRQ_REASON_TIMER)
        ctx.set(dut.irq_slot, 0)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)

        assert ctx.get(dut.busy) == 1, "busy must be 1 after first start"

        # FSM is now in FETCH_NS, waiting for mem_rd_valid.
        # Assert mem_rd_en and correct NS address before injecting second trigger.
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_NS: mem_rd_en not asserted"
        addr_ns = ctx.get(dut.mem_rd_addr)
        assert addr_ns == IRQ_NS_ADDR, (
            f"FETCH_NS: expected {IRQ_NS_ADDR:#x}, got {addr_ns:#x}"
        )

        # --- Inject second start (LAZY_LOAD) while still in FETCH_NS stall ---
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_LOAD)
        ctx.set(dut.irq_slot, INTRUDING_SLOT)
        ctx.set(dut.start, 1)
        # busy must still be asserted — re-entry is blocked
        assert ctx.get(dut.busy) == 1, (
            "busy must remain 1 during second start pulse (re-entry prevention)"
        )
        await ctx.tick()
        ctx.set(dut.start, 0)
        # Restore inputs to first dispatch values to confirm latch is not overwritten
        ctx.set(dut.irq_reason, IRQ_REASON_TIMER)
        ctx.set(dut.irq_slot, 0)

        # --- Service FETCH_NS for the original dispatch ---
        ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()
        ctx.set(dut.mem_rd_valid, 0)

        # --- Service FETCH_METHOD ---
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_METHOD: mem_rd_en not asserted"
        addr_method = ctx.get(dut.mem_rd_addr)
        assert addr_method == METHOD_ADDR, (
            f"FETCH_METHOD: expected {METHOD_ADDR:#x}, got {addr_method:#x}"
        )
        ctx.set(dut.mem_rd_data, METHOD_ENTRY)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)

        # --- WRITE_DR0: must carry TIMER reason (not LAZY_LOAD from second pulse) ---
        dr_en   = ctx.get(dut.dr_wr_en)
        dr0_val = ctx.get(dut.dr_wr_data)
        assert dr_en == 1, "WRITE_DR0: dr_wr_en not asserted"
        assert dr0_val == IRQ_REASON_TIMER, (
            f"DR0 corrupted by second IRQ — expected {IRQ_REASON_TIMER} "
            f"(TIMER), got {dr0_val}"
        )
        await ctx.tick()

        # --- WRITE_DR1: must carry slot=0 (not INTRUDING_SLOT) ---
        dr1_en  = ctx.get(dut.dr1_wr_en)
        dr1_val = ctx.get(dut.dr1_wr_data)
        assert dr1_en == 1, "WRITE_DR1: dr1_wr_en not asserted"
        assert dr1_val == 0, (
            f"DR1 corrupted by second IRQ — expected slot=0, got {dr1_val}"
        )
        await ctx.tick()

        # --- COMPLETE: NIA must be from first dispatch ---
        nia_set_val = ctx.get(dut.nia_set)
        nia_val     = ctx.get(dut.nia_value)
        assert nia_set_val == 1, "nia_set not asserted in COMPLETE"
        assert nia_val == EXPECTED_NIA, (
            f"NIA corrupted — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        await ctx.tick()

        # Note: the second start pulse was captured into pending, so busy may not
        # drop to 0 here.  Skip the busy==0 check; this test only validates the
        # first dispatch's DR/NIA integrity under simultaneous pressure.
        print(f"  PASS: busy held during FETCH_NS second-start; "
              f"DR0={dr0_val} (TIMER), DR1={dr1_val} (slot=0), "
              f"NIA={nia_val:#x} — no corruption")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_simultaneous_fetch_ns")


# ---------------------------------------------------------------------------
# Sub-test 5: Simultaneous trigger during FETCH_METHOD stall
#
# Scenario: TIMER dispatch has already passed FETCH_NS and is now waiting in
# FETCH_METHOD.  A second start pulse (LAZY_RESOLVE) arrives.  Same
# expectation: busy prevents re-entry, first dispatch values preserved.
# ---------------------------------------------------------------------------

def test_irq_dispatch_simultaneous_fetch_method():
    """Second IRQ fires during FETCH_METHOD stall → held off, first dispatch intact."""
    dut = ChurchIRQDispatch()
    INTRUDING_SLOT = 3   # c-list slot index carried by the second (spurious) start

    async def testbench(ctx):
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

        # --- Start first dispatch: LAZY_LOAD, slot=9 ---
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_LOAD)
        ctx.set(dut.irq_slot, 9)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)

        assert ctx.get(dut.busy) == 1, "busy must be 1 after first start"

        # --- Service FETCH_NS ---
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_NS: mem_rd_en not asserted"
        ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()
        ctx.set(dut.mem_rd_valid, 0)

        # FSM is now in FETCH_METHOD, waiting for mem_rd_valid.
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_METHOD: mem_rd_en not asserted"
        addr_method = ctx.get(dut.mem_rd_addr)
        assert addr_method == METHOD_ADDR, (
            f"FETCH_METHOD: expected {METHOD_ADDR:#x}, got {addr_method:#x}"
        )

        # --- Inject second start (LAZY_RESOLVE) during FETCH_METHOD stall ---
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_RESOLVE)
        ctx.set(dut.irq_slot, INTRUDING_SLOT)
        ctx.set(dut.start, 1)
        assert ctx.get(dut.busy) == 1, (
            "busy must remain 1 during second start in FETCH_METHOD (re-entry prevention)"
        )
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_LOAD)
        ctx.set(dut.irq_slot, 9)

        # --- Service FETCH_METHOD for the original dispatch ---
        ctx.set(dut.mem_rd_data, METHOD_ENTRY)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)

        # --- WRITE_DR0: must be LAZY_LOAD (not LAZY_RESOLVE from second pulse) ---
        dr_en   = ctx.get(dut.dr_wr_en)
        dr0_val = ctx.get(dut.dr_wr_data)
        assert dr_en == 1, "WRITE_DR0: dr_wr_en not asserted"
        assert dr0_val == IRQ_REASON_LAZY_LOAD, (
            f"DR0 corrupted by second IRQ — expected {IRQ_REASON_LAZY_LOAD} "
            f"(LAZY_LOAD), got {dr0_val}"
        )
        await ctx.tick()

        # --- WRITE_DR1: must carry slot=9 (not INTRUDING_SLOT=3) ---
        dr1_en  = ctx.get(dut.dr1_wr_en)
        dr1_val = ctx.get(dut.dr1_wr_data)
        assert dr1_en == 1, "WRITE_DR1: dr1_wr_en not asserted"
        assert dr1_val == 9, (
            f"DR1 corrupted by second IRQ — expected slot=9, got {dr1_val}"
        )
        await ctx.tick()

        # --- COMPLETE: NIA must be correct ---
        nia_set_val = ctx.get(dut.nia_set)
        nia_val     = ctx.get(dut.nia_value)
        assert nia_set_val == 1, "nia_set not asserted in COMPLETE"
        assert nia_val == EXPECTED_NIA, (
            f"NIA corrupted — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        await ctx.tick()

        # Note: the second start pulse was captured into pending; skip busy==0 check.
        print(f"  PASS: busy held during FETCH_METHOD second-start; "
              f"DR0={dr0_val} (LAZY_LOAD), DR1={dr1_val} (slot=9), "
              f"NIA={nia_val:#x} — no corruption")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_simultaneous_fetch_method")


# ---------------------------------------------------------------------------
# Sub-test 6: null ns_base guard — ns_base=0 must not corrupt NIA
# ---------------------------------------------------------------------------

def test_irq_dispatch_null_base():
    """NS slot 8 lump base == 0 → null_base_fault asserted, nia_set never fires."""
    dut = ChurchIRQDispatch()

    async def testbench(ctx):
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

        ctx.set(dut.irq_reason, IRQ_REASON_TIMER)
        ctx.set(dut.irq_slot, 0)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)

        assert ctx.get(dut.busy) == 1, "busy should be 1 after start"

        # --- FETCH_NS: unit drives mem_rd_addr; respond with 0 (unbooted slot) ---
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_NS: mem_rd_en not asserted"
        addr_ns = ctx.get(dut.mem_rd_addr)
        assert addr_ns == IRQ_NS_ADDR, (
            f"FETCH_NS: expected mem_rd_addr={IRQ_NS_ADDR:#x}, got {addr_ns:#x}"
        )
        ctx.set(dut.mem_rd_data, 0)   # lump base is zero — Scheduler.IRQ not booted
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()
        ctx.set(dut.mem_rd_valid, 0)

        # --- NULL_BASE_FAULT state: fault fires, nia_set must NOT fire ---
        null_fault = ctx.get(dut.null_base_fault)
        nia_set    = ctx.get(dut.nia_set)
        nia_val    = ctx.get(dut.nia_value)
        fault_type = ctx.get(dut.null_base_fault_type)

        assert null_fault == 1, (
            f"NULL_BASE: null_base_fault not asserted (got {null_fault})"
        )
        assert nia_set == 0, (
            f"NULL_BASE: nia_set fired when ns_base=0 — NIA corruption! "
            f"nia_value={nia_val:#x}"
        )
        assert fault_type == int(FaultType.IRQ_NULL_BASE), (
            f"NULL_BASE: fault_type mismatch — expected "
            f"{int(FaultType.IRQ_NULL_BASE):#x}, got {fault_type:#x}"
        )
        await ctx.tick()

        # Back to IDLE — busy must be clear, fault must be deasserted
        assert ctx.get(dut.busy) == 0, "busy should clear after NULL_BASE_FAULT→IDLE"
        assert ctx.get(dut.null_base_fault) == 0, (
            "null_base_fault should be 0 one cycle after NULL_BASE_FAULT state"
        )
        print(f"  PASS: null_base_fault asserted, nia_set={nia_set} (no NIA write), "
              f"fault_type={fault_type:#x} (IRQ_NULL_BASE)")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_null_base")


# ---------------------------------------------------------------------------
# Sub-test 7: XLOADLAMBDA NULL-body condition  (DR0 = IRQ_REASON_LAZY_RESOLVE = 2)
# ---------------------------------------------------------------------------

def test_irq_dispatch_xloadlambda():
    """XLOADLAMBDA NULL-body → same dispatch path as ELOADCALL.

    Confirms that the symmetric XLOADLAMBDA case (cap_index as irq_slot)
    recovers correctly via ChurchIRQDispatch:
      DR0 = IRQ_REASON_LAZY_RESOLVE (2) — same reason code as ELOADCALL
      DR1 = cap_index (lambda body offset supplied as irq_slot)
      NIA = Scheduler.IRQ lump entry
    """
    dut = ChurchIRQDispatch()
    LAMBDA_CAP_INDEX = 11   # fake cap_index from an XLOADLAMBDA instruction

    async def testbench(ctx):
        dr0_ok, dr1_ok, nia_ok, dr0_val, dr1_val, nia_val = (
            await _run_dispatch(ctx, dut, IRQ_REASON_LAZY_RESOLVE, LAMBDA_CAP_INDEX)
        )
        assert dr0_ok, (
            f"XLOADLAMBDA: DR0 write failed — expected reason={IRQ_REASON_LAZY_RESOLVE}, "
            f"got dr_wr_data={dr0_val}"
        )
        assert dr1_ok, (
            f"XLOADLAMBDA: DR1 write failed — expected cap_index={LAMBDA_CAP_INDEX}, "
            f"got {dr1_val}"
        )
        assert nia_ok, (
            f"XLOADLAMBDA: NIA wrong — expected {EXPECTED_NIA:#x}, got {nia_val:#x}"
        )
        print(f"  PASS: XLOADLAMBDA → DR0={dr0_val} (IRQ_REASON_LAZY_RESOLVE), "
              f"DR1={dr1_val} (cap_index={LAMBDA_CAP_INDEX}), NIA={nia_val:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_xloadlambda")


# ---------------------------------------------------------------------------
# Sub-test 8: Pending trigger captured during FETCH_NS stall, replayed after
#             first dispatch completes.
#
# Scenario: TIMER dispatch is in FETCH_NS (waiting for mem_rd_valid).
# A LAZY_LOAD trigger (slot=7) arrives — captured into pend registers.
# First dispatch finishes normally.  On COMPLETE→IDLE the FSM sees
# pend_valid=1 and immediately begins the LAZY_LOAD dispatch without an
# external re-pulse.  DR0/DR1/NIA of the replayed dispatch are verified.
# ---------------------------------------------------------------------------

def test_irq_dispatch_pending_captured_and_replayed():
    """Pending trigger captured during FETCH_NS stall → auto-replayed after first dispatch."""
    dut = ChurchIRQDispatch()
    PENDING_SLOT = 7

    async def testbench(ctx):
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

        # --- Start first dispatch: TIMER, slot=0 ---
        ctx.set(dut.irq_reason, IRQ_REASON_TIMER)
        ctx.set(dut.irq_slot, 0)
        ctx.set(dut.start, 1)
        await ctx.tick()               # IDLE → FETCH_NS
        ctx.set(dut.start, 0)

        assert ctx.get(dut.busy) == 1, "busy must be 1 after first start"
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_NS: mem_rd_en not asserted"
        assert ctx.get(dut.mem_rd_addr) == IRQ_NS_ADDR, (
            f"FETCH_NS: expected {IRQ_NS_ADDR:#x}, got {ctx.get(dut.mem_rd_addr):#x}"
        )

        # --- Inject second trigger (LAZY_LOAD, slot=7) into FETCH_NS stall ---
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_LOAD)
        ctx.set(dut.irq_slot, PENDING_SLOT)
        ctx.set(dut.start, 1)
        await ctx.tick()               # FETCH_NS stays (no mem_rd_valid); pending captured
        ctx.set(dut.start, 0)

        # --- Service FETCH_NS for the first dispatch ---
        ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()               # FETCH_NS → FETCH_METHOD
        ctx.set(dut.mem_rd_valid, 0)

        # --- Service FETCH_METHOD for the first dispatch ---
        assert ctx.get(dut.mem_rd_en) == 1, "FETCH_METHOD: mem_rd_en not asserted"
        assert ctx.get(dut.mem_rd_addr) == METHOD_ADDR, (
            f"FETCH_METHOD: expected {METHOD_ADDR:#x}, got {ctx.get(dut.mem_rd_addr):#x}"
        )
        ctx.set(dut.mem_rd_data, METHOD_ENTRY)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()               # FETCH_METHOD → WRITE_DR0
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)

        # --- WRITE_DR0: must carry TIMER reason (first dispatch) ---
        dr0_val = ctx.get(dut.dr_wr_data)
        assert ctx.get(dut.dr_wr_en) == 1, "WRITE_DR0: dr_wr_en not asserted"
        assert dr0_val == IRQ_REASON_TIMER, (
            f"First DR0 corrupted — expected TIMER={IRQ_REASON_TIMER}, got {dr0_val}"
        )
        await ctx.tick()               # WRITE_DR0 → WRITE_DR1

        # --- WRITE_DR1: must carry slot=0 (first dispatch) ---
        dr1_val = ctx.get(dut.dr1_wr_data)
        assert ctx.get(dut.dr1_wr_en) == 1, "WRITE_DR1: dr1_wr_en not asserted"
        assert dr1_val == 0, (
            f"First DR1 corrupted — expected slot=0, got {dr1_val}"
        )
        await ctx.tick()               # WRITE_DR1 → COMPLETE

        # --- COMPLETE: NIA for first dispatch ---
        assert ctx.get(dut.nia_set) == 1, "COMPLETE: nia_set not asserted"
        assert ctx.get(dut.nia_value) == EXPECTED_NIA, (
            f"First NIA wrong — expected {EXPECTED_NIA:#x}, got {ctx.get(dut.nia_value):#x}"
        )
        await ctx.tick()               # COMPLETE → IDLE

        # Momentarily IDLE — pend_valid is still set.
        assert ctx.get(dut.busy) == 0, "busy must drop to 0 in IDLE between dispatches"

        # --- One more tick: IDLE (with pend_valid=1) → FETCH_NS ---
        await ctx.tick()               # auto-starts pending dispatch (no external start)

        assert ctx.get(dut.busy) == 1, (
            "busy must be 1: pending dispatch should have auto-started"
        )

        # --- Service and verify the replayed LAZY_LOAD dispatch ---
        p_dr0, p_dr1, p_nia = await _service_pending_dispatch(
            ctx, dut, IRQ_REASON_LAZY_LOAD, PENDING_SLOT
        )
        print(f"  PASS: pending LAZY_LOAD replayed → "
              f"DR0={p_dr0} (LAZY_LOAD), DR1={p_dr1} (slot={PENDING_SLOT}), "
              f"NIA={p_nia:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_pending_captured_and_replayed")


# ---------------------------------------------------------------------------
# Sub-test 9: Pending trigger captured during WRITE_DR1, replayed after
#             first dispatch completes.
#
# Scenario: A LAZY_LOAD dispatch (slot=5) is in its WRITE_DR1 state when a
# LAZY_RESOLVE trigger (slot=3) arrives.  The pending register captures it.
# After COMPLETE→IDLE the FSM auto-starts the LAZY_RESOLVE dispatch.
# ---------------------------------------------------------------------------

def test_irq_dispatch_pending_captured_during_write_dr1():
    """Pending trigger captured during WRITE_DR1 → auto-replayed after first dispatch."""
    dut = ChurchIRQDispatch()
    FIRST_SLOT   = 5
    PENDING_SLOT = 3

    async def testbench(ctx):
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)
        ctx.set(dut.cr15_namespace["word1_location"], NS_TABLE_BASE)

        # --- Start first dispatch: LAZY_LOAD, slot=5 ---
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_LOAD)
        ctx.set(dut.irq_slot, FIRST_SLOT)
        ctx.set(dut.start, 1)
        await ctx.tick()               # IDLE → FETCH_NS
        ctx.set(dut.start, 0)

        assert ctx.get(dut.busy) == 1

        # --- Service FETCH_NS ---
        assert ctx.get(dut.mem_rd_en) == 1
        ctx.set(dut.mem_rd_data, SCHED_LUMP_BASE)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()               # FETCH_NS → FETCH_METHOD
        ctx.set(dut.mem_rd_valid, 0)

        # --- Service FETCH_METHOD ---
        assert ctx.get(dut.mem_rd_en) == 1
        assert ctx.get(dut.mem_rd_addr) == METHOD_ADDR
        ctx.set(dut.mem_rd_data, METHOD_ENTRY)
        ctx.set(dut.mem_rd_valid, 1)
        await ctx.tick()               # FETCH_METHOD → WRITE_DR0
        ctx.set(dut.mem_rd_valid, 0)
        ctx.set(dut.mem_rd_data, 0)

        # --- WRITE_DR0: verify first dispatch reason ---
        assert ctx.get(dut.dr_wr_en) == 1
        assert ctx.get(dut.dr_wr_data) == IRQ_REASON_LAZY_LOAD, (
            f"First DR0 wrong — expected LAZY_LOAD, got {ctx.get(dut.dr_wr_data)}"
        )
        await ctx.tick()               # WRITE_DR0 → WRITE_DR1

        # --- WRITE_DR1: inject second trigger (LAZY_RESOLVE, slot=3) here ---
        assert ctx.get(dut.dr1_wr_en) == 1
        assert ctx.get(dut.dr1_wr_data) == FIRST_SLOT, (
            f"First DR1 wrong — expected slot={FIRST_SLOT}, got {ctx.get(dut.dr1_wr_data)}"
        )
        ctx.set(dut.irq_reason, IRQ_REASON_LAZY_RESOLVE)
        ctx.set(dut.irq_slot, PENDING_SLOT)
        ctx.set(dut.start, 1)
        await ctx.tick()               # WRITE_DR1 → COMPLETE; pending captured
        ctx.set(dut.start, 0)

        # --- COMPLETE: NIA for first dispatch ---
        assert ctx.get(dut.nia_set) == 1, "COMPLETE: nia_set not asserted"
        assert ctx.get(dut.nia_value) == EXPECTED_NIA, (
            f"First NIA wrong — expected {EXPECTED_NIA:#x}, got {ctx.get(dut.nia_value):#x}"
        )
        await ctx.tick()               # COMPLETE → IDLE

        assert ctx.get(dut.busy) == 0, "busy must drop to 0 in IDLE between dispatches"

        # --- One more tick: IDLE (with pend_valid=1) → FETCH_NS ---
        await ctx.tick()               # auto-starts pending dispatch

        assert ctx.get(dut.busy) == 1, (
            "busy must be 1: pending LAZY_RESOLVE dispatch should have auto-started"
        )

        # --- Service and verify the replayed LAZY_RESOLVE dispatch ---
        p_dr0, p_dr1, p_nia = await _service_pending_dispatch(
            ctx, dut, IRQ_REASON_LAZY_RESOLVE, PENDING_SLOT
        )
        print(f"  PASS: pending LAZY_RESOLVE replayed → "
              f"DR0={p_dr0} (LAZY_RESOLVE), DR1={p_dr1} (slot={PENDING_SLOT}), "
              f"NIA={p_nia:#x}")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_irq_dispatch_pending_captured_during_write_dr1")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("ChurchIRQDispatch Cross-Check Tests")
    print("Three trigger conditions + simultaneous-trigger stall")
    print("+ null-base guard + XLOADLAMBDA + pending-trigger replay")
    print("→ dispatch to Scheduler.IRQ (NS slot 8)")
    print("=" * 60)

    tests = [
        test_irq_dispatch_timer,
        test_irq_dispatch_lazy_load,
        test_irq_dispatch_lazy_resolve,
        test_irq_dispatch_simultaneous_fetch_ns,
        test_irq_dispatch_simultaneous_fetch_method,
        test_irq_dispatch_null_base,
        test_irq_dispatch_xloadlambda,
        test_irq_dispatch_pending_captured_and_replayed,
        test_irq_dispatch_pending_captured_during_write_dr1,
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
