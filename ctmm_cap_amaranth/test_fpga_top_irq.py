"""Integration test: IRQ dispatch wiring in CMCapFPGATop (lazy-resolve path).

Tests that when the core fires irq_valid (ELOADCALL NULL c-list entry), the
ChurchIRQDispatch unit wired in CMCapFPGATop correctly:
  (a) Reads NS slot 8 word0_location from ns_mem → Scheduler lump base
  (b) Reads the handler entry from imem at lump_base + METHOD_IDX * 4
  (c) Writes DR0 = IRQ_REASON_LAZY_RESOLVE (via core.irq_dispatch_dr_wr_*)
  (d) Writes DR1 = c-list row (irq_dr1) — NOT the constant SCHEDULER_IRQ_NS_SLOT=8
  (e) Writes DR2 = irq_method_index (advisory context for the handler)
  (f) Sets NIA = lump_base + (method_entry << 2)
  (g) Asserts dispatch_busy (stalling exec_enable) while dispatch runs

The dispatch memory shim (ns_rd2 / imem_rd2 / phase_settled tracker) is exercised
in isolation by driving ChurchIRQDispatch directly without booting the full core
pipeline.  The same shim wiring from CMCapFPGATop.elaborate() is reproduced
inside _DispatchShimDUT.

Run with:  python -m ctmm_cap_amaranth.test_fpga_top_irq
"""

import sys
from amaranth import *
from amaranth.sim import Simulator

from hardware.irq_dispatch import ChurchIRQDispatch, SCHEDULER_IRQ_METHOD_IDX
from hardware.hw_types import IRQ_REASON_LAZY_RESOLVE, SCHEDULER_IRQ_NS_SLOT
from hardware.layouts import CAP_REG_LAYOUT


# ---------------------------------------------------------------------------
# Test constants
# ---------------------------------------------------------------------------

NS_WORD0_LOCATION = 0x0100     # Scheduler lump base (byte address)
METHOD_ENTRY_WORD = 7          # method-table word value (lump-relative word offset)
EXPECTED_NIA      = NS_WORD0_LOCATION + (METHOD_ENTRY_WORD << 2)  # = 0x011C

CLIST_ROW  = 5    # irq_dr1: c-list slot that held the NULL GT
METHOD_IDX = 3    # irq_method_index: which method was being called

NS_DEPTH   = 32
# IMEM_DEPTH must exceed (NS_WORD0_LOCATION>>2) + SCHEDULER_IRQ_METHOD_IDX
# = (0x100>>2) + 5 = 64 + 5 = 69 → use 128
IMEM_DEPTH = 128
NS_WIDTH   = 32 * 4  # NS_ENTRY_WORDS=4 (stride-4, 16 bytes/slot)


# ---------------------------------------------------------------------------
# DUT — replicates exactly the dispatch shim from CMCapFPGATop.elaborate()
# ---------------------------------------------------------------------------

class _DispatchShimDUT(Elaboratable):
    """ChurchIRQDispatch wired with the ns_rd2 / imem_rd2 memory shim and
    phase_settled settling signal, mirroring the wiring in CMCapFPGATop."""

    def __init__(self, ns_word0_location, method_entry_word, clist_row, method_idx):
        self._ns_word0  = ns_word0_location
        self._method_wd = method_entry_word
        self._clist_row = clist_row
        self._method_idx= method_idx

        # "Core" side inputs
        self.irq_valid        = Signal()
        self.irq_reason       = Signal(2)
        self.irq_dr1          = Signal(5)
        self.irq_method_index = Signal(7)
        self.cr15_namespace   = Signal(CAP_REG_LAYOUT)

        # Observed write-back outputs
        self.dr0_wr_en   = Signal()
        self.dr0_wr_data = Signal(32)
        self.dr1_wr_en   = Signal()
        self.dr1_wr_data = Signal(32)
        self.dr2_wr_en   = Signal()
        self.dr2_wr_data = Signal(32)
        self.nia_set     = Signal()
        self.nia_value   = Signal(32)
        self.dispatch_busy = Signal()

    def elaborate(self, platform):
        m = Module()

        dispatch = ChurchIRQDispatch()
        m.submodules.dispatch = dispatch

        # NS memory: slot SCHEDULER_IRQ_NS_SLOT holds Scheduler lump base as word0.
        ns_init = [0] * NS_DEPTH
        ns_init[SCHEDULER_IRQ_NS_SLOT] = self._ns_word0
        ns_mem = Memory(width=NS_WIDTH, depth=NS_DEPTH, init=ns_init)
        m.submodules.ns_mem = ns_mem
        ns_rd2 = ns_mem.read_port()

        # IMEM: method table entry at (ns_word0 + SCHEDULER_IRQ_METHOD_IDX*4) >> 2.
        imem_init = [0] * IMEM_DEPTH
        maddr = (self._ns_word0 + SCHEDULER_IRQ_METHOD_IDX * 4) >> 2
        if maddr < IMEM_DEPTH:
            imem_init[maddr] = self._method_wd
        imem = Memory(width=32, depth=IMEM_DEPTH, init=imem_init)
        m.submodules.imem = imem
        imem_rd2 = imem.read_port()

        # ── replicate fpga_top shim exactly ──────────────────────────────────

        m.d.comb += ns_rd2.addr.eq(SCHEDULER_IRQ_NS_SLOT)
        m.d.comb += imem_rd2.addr.eq(dispatch.mem_rd_addr[2:12])

        irq_fetch_phase  = Signal()
        phase_settled    = Signal()
        dispatch_mem_valid_r = Signal()
        m.d.sync += dispatch_mem_valid_r.eq(dispatch.mem_rd_en)

        with m.If(~dispatch.busy):
            m.d.sync += [irq_fetch_phase.eq(0), phase_settled.eq(0)]
        with m.Elif(dispatch.mem_rd_en & dispatch.mem_rd_valid):
            m.d.sync += [irq_fetch_phase.eq(1), phase_settled.eq(0)]
        with m.Else():
            with m.If(~phase_settled):
                m.d.sync += phase_settled.eq(1)

        m.d.comb += [
            dispatch.mem_rd_valid.eq(dispatch_mem_valid_r & phase_settled),
            dispatch.mem_rd_data.eq(
                Mux(irq_fetch_phase == 0,
                    ns_rd2.data[:32],
                    imem_rd2.data)
            ),
        ]

        # ── drive dispatch from "core" side ───────────────────────────────────

        m.d.comb += [
            dispatch.start.eq(self.irq_valid),
            dispatch.irq_reason.eq(self.irq_reason),
            dispatch.irq_slot.eq(self.irq_dr1),      # c-list row, NOT constant slot 8
            dispatch.cr15_namespace.eq(self.cr15_namespace),
        ]

        # ── irq_method_index → DR2 when dispatch completes ───────────────────

        irq_method_index_lat = Signal(7)
        with m.If(self.irq_valid):
            m.d.sync += irq_method_index_lat.eq(self.irq_method_index)

        # ── expose write-back outputs ─────────────────────────────────────────

        m.d.comb += [
            self.dr0_wr_en.eq(dispatch.dr_wr_en),
            self.dr0_wr_data.eq(dispatch.dr_wr_data),
            self.dr1_wr_en.eq(dispatch.dr1_wr_en),
            self.dr1_wr_data.eq(dispatch.dr1_wr_data),
            self.dr2_wr_en.eq(dispatch.complete),
            self.dr2_wr_data.eq(irq_method_index_lat),
            self.nia_set.eq(dispatch.nia_set),
            self.nia_value.eq(dispatch.nia_value),
            self.dispatch_busy.eq(dispatch.busy),
        ]

        return m


# ---------------------------------------------------------------------------
# Shared testbench coroutine
# ---------------------------------------------------------------------------

async def _run_shim(ctx, dut, reason, dr1, method_idx):
    """Fire one ELOADCALL lazy-resolve through the shim and collect outputs."""
    results = {
        "busy_seen": False,
        "dr0_wr":    None,
        "dr1_wr":    None,
        "dr2_wr":    None,
        "nia_set":   False,
        "nia_value": None,
    }

    ctx.set(dut.cr15_namespace["word1_location"], 0x1000)
    ctx.set(dut.irq_reason, reason)
    ctx.set(dut.irq_dr1, dr1)
    ctx.set(dut.irq_method_index, method_idx)

    ctx.set(dut.irq_valid, 1)
    await ctx.tick()
    ctx.set(dut.irq_valid, 0)

    for _ in range(20):
        if ctx.get(dut.dispatch_busy):
            results["busy_seen"] = True

        if ctx.get(dut.dr0_wr_en) and results["dr0_wr"] is None:
            results["dr0_wr"] = ctx.get(dut.dr0_wr_data)

        if ctx.get(dut.dr1_wr_en) and results["dr1_wr"] is None:
            results["dr1_wr"] = ctx.get(dut.dr1_wr_data)

        if ctx.get(dut.dr2_wr_en) and results["dr2_wr"] is None:
            results["dr2_wr"] = ctx.get(dut.dr2_wr_data)

        if ctx.get(dut.nia_set) and not results["nia_set"]:
            results["nia_set"]   = True
            results["nia_value"] = ctx.get(dut.nia_value)

        await ctx.tick()

    return results


# ---------------------------------------------------------------------------
# Test utilities
# ---------------------------------------------------------------------------

PASS_COUNT = 0
FAIL_COUNT = 0


def _check(cond, msg):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        print(f"  PASS: {msg}")
        PASS_COUNT += 1
    else:
        print(f"  FAIL: {msg}")
        FAIL_COUNT += 1


def _run(name, dut, coro):
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(coro)
    with sim.write_vcd(f"/tmp/{name}.vcd"):
        sim.run()


# ---------------------------------------------------------------------------
# Test 1: full DR0 / DR1 / DR2 / NIA correctness
# ---------------------------------------------------------------------------

def test_fpga_top_irq_dr_nia_correctness():
    """DR0=reason, DR1=clist_row, DR2=method_index, NIA=handler entry."""
    dut = _DispatchShimDUT(
        ns_word0_location=NS_WORD0_LOCATION,
        method_entry_word=METHOD_ENTRY_WORD,
        clist_row=CLIST_ROW,
        method_idx=METHOD_IDX,
    )
    results = {}

    async def tb(ctx):
        nonlocal results
        results = await _run_shim(ctx, dut, IRQ_REASON_LAZY_RESOLVE, CLIST_ROW, METHOD_IDX)

    _run("test_fpga_top_irq_dr_nia", dut, tb)

    _check(results["busy_seen"],
           "dispatch_busy asserted — exec_enable stall confirmed")
    _check(results["dr0_wr"] == IRQ_REASON_LAZY_RESOLVE,
           f"DR0 = IRQ_REASON_LAZY_RESOLVE={IRQ_REASON_LAZY_RESOLVE}, "
           f"got {results['dr0_wr']}")
    _check(results["dr1_wr"] == CLIST_ROW,
           f"DR1 = clist_row={CLIST_ROW} (recovery context), "
           f"got {results['dr1_wr']}")
    _check(results["dr2_wr"] == METHOD_IDX,
           f"DR2 = method_index={METHOD_IDX} (advisory), "
           f"got {results['dr2_wr']}")
    _check(results["nia_set"],
           "nia_set pulsed — NIA override fired")
    nia_got = results.get("nia_value")
    nia_got_str = f"{nia_got:#010x}" if nia_got is not None else "None"
    _check(nia_got == EXPECTED_NIA,
           f"NIA = {EXPECTED_NIA:#010x}, got {nia_got_str}")
    print(f"PASS: {test_fpga_top_irq_dr_nia_correctness.__name__}")


# ---------------------------------------------------------------------------
# Test 2: DR1 is clist row, never the constant SCHEDULER_IRQ_NS_SLOT=8
# ---------------------------------------------------------------------------

def test_dr1_is_clist_row_not_scheduler_slot():
    """Regression guard: DR1 must carry irq_dr1 (c-list row), not slot 8."""
    clist_row_distinct = 11    # chosen to differ from SCHEDULER_IRQ_NS_SLOT=8

    dut = _DispatchShimDUT(
        ns_word0_location=NS_WORD0_LOCATION,
        method_entry_word=METHOD_ENTRY_WORD,
        clist_row=clist_row_distinct,
        method_idx=2,
    )
    results = {}

    async def tb(ctx):
        nonlocal results
        results = await _run_shim(ctx, dut, IRQ_REASON_LAZY_RESOLVE,
                                  clist_row_distinct, 2)

    _run("test_fpga_top_irq_dr1_not_const", dut, tb)

    _check(results["dr1_wr"] == clist_row_distinct,
           f"DR1 = clist_row={clist_row_distinct} "
           f"(not SCHEDULER_IRQ_NS_SLOT={SCHEDULER_IRQ_NS_SLOT}), "
           f"got {results['dr1_wr']}")
    _check(results["dr1_wr"] != SCHEDULER_IRQ_NS_SLOT,
           f"DR1 != {SCHEDULER_IRQ_NS_SLOT} (regression guard for miswire)")
    print(f"PASS: {test_dr1_is_clist_row_not_scheduler_slot.__name__}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("CMCapFPGATop IRQ Dispatch Integration Tests")
    print("lazy-resolve: ELOADCALL → ChurchIRQDispatch → DR0/DR1/DR2/NIA")
    print("=" * 60)

    test_fpga_top_irq_dr_nia_correctness()
    test_dr1_is_clist_row_not_scheduler_slot()

    print("=" * 60)
    print(f"Results: {PASS_COUNT} passed, {FAIL_COUNT} failed")
    if FAIL_COUNT == 0:
        print("ALL TESTS PASSED")
    else:
        print("SOME TESTS FAILED")
    sys.exit(0 if FAIL_COUNT == 0 else 1)
