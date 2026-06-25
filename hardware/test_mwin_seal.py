"""Hardware simulation tests for M-window seal validation (Task #446).

Exercises the FNV-1a seal check added to the WRITEBACK state of the mwin FSM
in hardware/core.py.  Two levels of coverage:

  Formula tests — verify the Python-level FNV32 helper matches the constants
                  exported from hw_types and that the 25-bit mask is correct.
                  These run without Amaranth simulation.

  FSM unit tests — a minimal Elaboratable (MWinFSMUnit) that re-implements the
                   WRITEBACK check in isolation.  Both the valid-seal path and
                   the invalid-seal path are simulated with Amaranth to verify:
                     - seal_ok=1 + no fault when the stored seal matches
                     - seal_ok=0 + fault when the stored seal is corrupted

Run with:  python -m hardware.test_mwin_seal
"""

import sys
from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from .hw_types import FNV_OFFSET_32, FNV_PRIME_32, FaultType
from .layouts import SEALS_LAYOUT, GT_LAYOUT, WORD2_LAYOUT
from .integrity32 import integrity32_amaranth


# ---------------------------------------------------------------------------
# Python-level helpers (must agree exactly with hardware/core.py formula)
# ---------------------------------------------------------------------------

def _fnv32(w0, w1):
    """One-round FNV-1a: ((FNV_OFFSET_32 ^ w0) * FNV_PRIME_32) ^ w1, 32-bit."""
    return (((FNV_OFFSET_32 ^ w0) * FNV_PRIME_32) ^ w1) & 0xFFFFFFFF


def _seal(w0, w1):
    """Lower 25 bits of the FNV-1a hash — the stored seal value (SEALS_LAYOUT.seal)."""
    return _fnv32(w0, w1) & 0x1FFFFFF


def _integrity32(w0, w1):
    """Python replica of hardware/integrity32.py for test vector generation."""
    def rol32(x, n):
        x = x & 0xFFFFFFFF
        return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF
    w1m = w1 & 0x3FFFFFFF   # mask g_bit[30] and f_flag[31] ★v2.0
    return (rol32(w0, 7) ^ rol32(w1m, 13) ^ 0xDEADBEEF) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Minimal Elaboratable that mirrors the hardware WRITEBACK check
# ---------------------------------------------------------------------------

class MWinFSMUnit(Elaboratable):
    """Single-state check that mirrors the hardware WRITEBACK condition.

    Inputs (set before trigger):
        dr11 — GT word (bits[26:25] must be non-NULL to allow writeback) ★v2.0
        dr12 — NS location word
        dr13 — NS authority word
        dr14 — expected integrity32(dr12, dr13)
        dr15 — seals word: bits[24:0]=seal, bits[31:25]=version

    Input:
        trigger — pulse high for one cycle to latch DR regs and begin check

    Outputs (combinatorial in CHECK state):
        cr_wr_en    — 1 when all checks pass (writeback succeeds)
        fault_valid — 1 when any check fails
    """

    def __init__(self):
        self.dr11 = Signal(32)
        self.dr12 = Signal(32)
        self.dr13 = Signal(32)
        self.dr14 = Signal(32)
        self.dr15 = Signal(32)
        self.trigger    = Signal()
        self.cr_wr_en   = Signal()
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        dr11_lat = Signal(32)
        dr12_lat = Signal(32)
        dr13_lat = Signal(32)
        dr14_lat = Signal(32)
        dr15_lat = Signal(32)

        # Integrity check
        integrity_computed = Signal(32)
        integrity32_amaranth(m, dr12_lat, dr13_lat, integrity_computed)
        integrity_ok = Signal()
        m.d.comb += integrity_ok.eq(integrity_computed == dr14_lat)

        # gt_seq check: DR11[24:16] must equal DR13[29:21] ★v2.0
        dr11_gt_seq = Signal(9)
        dr13_gt_seq = Signal(9)
        gtseq_ok    = Signal()
        m.d.comb += [
            dr11_gt_seq.eq(View(GT_LAYOUT, dr11_lat).gt_seq),
            dr13_gt_seq.eq(View(WORD2_LAYOUT, dr13_lat).gt_seq),
            gtseq_ok.eq(dr11_gt_seq == dr13_gt_seq),
        ]

        # Seal check — mirrors hardware/core.py exactly
        seal_computed = Signal(32)
        seal_masked   = Signal(25)
        seal_ok       = Signal()
        m.d.comb += [
            seal_computed.eq(
                ((FNV_OFFSET_32 ^ dr12_lat) * FNV_PRIME_32) ^ dr13_lat
            ),
            seal_masked.eq(seal_computed[:25]),
            seal_ok.eq(seal_masked == View(SEALS_LAYOUT, dr15_lat).seal),
        ]

        # DR11 validity: bits[26:25] != 0b00 (not NULL) ★v2.0 gt_type at [26:25]
        dr11_valid = Signal()
        m.d.comb += dr11_valid.eq(dr11_lat[25:27] != 0)

        with m.FSM(name="mwin_unit"):
            with m.State("IDLE"):
                m.d.comb += [self.cr_wr_en.eq(0), self.fault_valid.eq(0)]
                with m.If(self.trigger):
                    m.d.sync += [
                        dr11_lat.eq(self.dr11),
                        dr12_lat.eq(self.dr12),
                        dr13_lat.eq(self.dr13),
                        dr14_lat.eq(self.dr14),
                        dr15_lat.eq(self.dr15),
                    ]
                    with m.If(self.dr11[25:27] != 0):
                        m.next = "WRITEBACK"
                    with m.Else():
                        m.next = "FAULT"

            with m.State("WRITEBACK"):
                with m.If(integrity_ok & gtseq_ok & seal_ok):
                    m.d.comb += [self.cr_wr_en.eq(1), self.fault_valid.eq(0)]
                with m.Else():
                    m.d.comb += [self.cr_wr_en.eq(0), self.fault_valid.eq(1)]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += [self.cr_wr_en.eq(0), self.fault_valid.eq(1)]
                m.next = "IDLE"

        return m


# ---------------------------------------------------------------------------
# Test 1: FNV formula vectors (pure Python — no Amaranth sim needed)
# ---------------------------------------------------------------------------

def test_fnv_formula_vectors():
    """Formula: FNV constants match hw_types and the 25-bit mask is applied."""
    print("=== Test 1: FNV seal formula vectors ===")

    assert FNV_OFFSET_32 == 0x811c9dc5, f"FNV_OFFSET_32 mismatch: {FNV_OFFSET_32:#010x}"
    assert FNV_PRIME_32  == 0x01000193, f"FNV_PRIME_32 mismatch:  {FNV_PRIME_32:#010x}"

    VECTORS = [
        (0x00001000, 0x00000010),
        (0xABCDEF01, 0x12345678),
        (0x00000000, 0x00000000),
        (0xFFFFFFFF, 0xFFFFFFFF),
    ]
    for (w12, w13) in VECTORS:
        seal = _seal(w12, w13)
        assert 0 <= seal < (1 << 25), f"seal out of 25-bit range: {seal:#09x}"
        bad = (seal ^ 0x1) & 0x1FFFFFF
        assert bad != seal, "bit-flip must change the seal"
        # Cross-check the formula is consistent with direct computation
        direct = (((FNV_OFFSET_32 ^ w12) * FNV_PRIME_32) ^ w13) & 0x1FFFFFF
        assert seal == direct, f"_seal inconsistency for ({w12:#010x}, {w13:#010x})"

    print("PASS")


# ---------------------------------------------------------------------------
# Test 2: Valid seal → writeback succeeds (Amaranth simulation)
# ---------------------------------------------------------------------------

def test_mwin_valid_seal():
    """FSM unit: correct FNV seal → cr_wr_en=1, fault_valid=0 in WRITEBACK."""
    dut = MWinFSMUnit()
    results = {}

    # w13 must have DR13[29:21]=0 to match DR11.gt_seq=0 (gtseq_ok=True) ★v2.0.
    # bits[29:21] of the test w13 values are zeroed by ANDing out those bits.
    _GTSEQ_MASK = ~(0x1FF << 21) & 0xFFFFFFFF   # zero out bits[29:21] ★v2.0
    VECTORS = [
        (0x00001000, 0x00000010 & _GTSEQ_MASK),   # typical NS entry
        (0xABCDEF01, 0x12345678 & _GTSEQ_MASK),   # arbitrary (gtseq bits zeroed)
        (0xDEADBEEF, 0xCAFE0000 & _GTSEQ_MASK),   # another arbitrary
    ]

    async def testbench(ctx):
        all_ok = True
        for (w12, w13) in VECTORS:
            # GT word: Inform type (bits[26:25]=0b01), gt_seq in bits[24:16]=0
            # DR13[29:21]=0 must match DR11[24:16]=0 (gtseq_ok=True) ★v2.0
            gt_word  = (0b01 << 25)    # gt_type=INFORM, gt_seq=0, slot=0
            integ    = _integrity32(w12, w13)
            seal_val = _seal(w12, w13)
            # Pack seal into DR15[24:0], version=0 in bits[31:25]
            dr15_val = seal_val & 0x1FFFFFF

            ctx.set(dut.dr11, gt_word)
            ctx.set(dut.dr12, w12)
            ctx.set(dut.dr13, w13)
            ctx.set(dut.dr14, integ)
            ctx.set(dut.dr15, dr15_val)
            ctx.set(dut.trigger, 1)
            await ctx.tick()   # IDLE: latch, valid DR11 → WRITEBACK
            ctx.set(dut.trigger, 0)
            # In WRITEBACK state: combinatorial outputs valid this cycle
            cr_wr    = ctx.get(dut.cr_wr_en)
            fault_v  = ctx.get(dut.fault_valid)
            await ctx.tick()   # → IDLE
            if cr_wr != 1 or fault_v != 0:
                print(f"  FAIL valid ({w12:#010x},{w13:#010x}): "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v} "
                      f"seal={seal_val:#09x}")
                all_ok = False
        results["ok"] = all_ok

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    print("\n=== Test 2: FSM unit — valid seal → writeback succeeds ===")
    if not results.get("ok"):
        assert False, "Test 2 (valid seal) had failures"
    print("PASS")


# ---------------------------------------------------------------------------
# Test 3: Corrupted seal → WRITEBACK faults (Amaranth simulation)
# ---------------------------------------------------------------------------

def test_mwin_invalid_seal():
    """FSM unit: flipped seal bit → fault_valid=1, cr_wr_en=0 in WRITEBACK."""
    dut = MWinFSMUnit()
    results = {}

    _GTSEQ_MASK = ~(0x1FF << 21) & 0xFFFFFFFF   # zero out bits[29:21] ★v2.0
    VECTORS = [
        (0x00001000, 0x00000010 & _GTSEQ_MASK),
        (0xABCDEF01, 0x12345678 & _GTSEQ_MASK),
        (0xCAFEBABE, 0x00000000),
    ]

    async def testbench(ctx):
        all_ok = True
        for (w12, w13) in VECTORS:
            gt_word   = (0b01 << 25)   # INFORM type, gt_seq=0, DR13[29:21]=0 ★v2.0
            integ     = _integrity32(w12, w13)
            good_seal = _seal(w12, w13)
            bad_seal  = (good_seal ^ 0x1) & 0x1FFFFFF   # flip LSB

            ctx.set(dut.dr11, gt_word)
            ctx.set(dut.dr12, w12)
            ctx.set(dut.dr13, w13)
            ctx.set(dut.dr14, integ)
            ctx.set(dut.dr15, bad_seal)
            ctx.set(dut.trigger, 1)
            await ctx.tick()   # IDLE → WRITEBACK
            ctx.set(dut.trigger, 0)
            cr_wr   = ctx.get(dut.cr_wr_en)
            fault_v = ctx.get(dut.fault_valid)
            await ctx.tick()   # → IDLE
            if cr_wr != 0 or fault_v != 1:
                print(f"  FAIL invalid ({w12:#010x},{w13:#010x}): "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v} "
                      f"good_seal={good_seal:#09x} bad_seal={bad_seal:#09x}")
                all_ok = False
        results["ok"] = all_ok

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    print("\n=== Test 3: FSM unit — corrupted seal → WRITEBACK fault ===")
    if not results.get("ok"):
        assert False, "Test 3 (invalid seal) had failures"
    print("PASS")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_fnv_formula_vectors,
        test_mwin_valid_seal,
        test_mwin_invalid_seal,
    ):
        try:
            fn()
        except Exception as e:
            import traceback
            failures.append(f"{fn.__name__}: {e}")
            traceback.print_exc()

    if failures:
        print("\n=== SUMMARY: FAILURES ===")
        for f in failures:
            print(f"  FAIL: {f}")
        sys.exit(1)
    else:
        print("\n=== SUMMARY: ALL TESTS PASSED ===")
        sys.exit(0)
