"""Hardware simulation tests for M-window writeback authorization (Task #2862).

Task #2862 REMOVED the FNV-1a / DR15 "seal" check that previously gated the
WRITEBACK state of the mwin FSM in hardware/core.py.  The authoritative gate is
now exactly three checks (fail-closed):

    non-NULL GT        (DR11 gt_type[26:25] != 0b00)
    integrity32        (integrity32(DR12, DR13) == DR14)
    9-bit gt_seq match (DR11[24:16] == DR13[29:21])

DR15 now carries the resident Inform W3 (cache_token32) — a NON-authoritative,
diagnostic-only value.  A random or tampered W3 must NEVER authorise a writeback
and must NEVER deny one either.

This module re-implements the updated WRITEBACK check in isolation
(MWinFSMUnit, no seal) and proves:

  * valid checks + ANY DR15 (0, random, tampered) → writeback succeeds
      → random/tampered W3 cannot DENY.
  * bad integrity / bad gt_seq / NULL GT + ANY DR15 → fault (fail closed)
      → random/tampered W3 cannot AUTHORISE.

Run with:  python -m hardware.test_mwin_seal
"""

import sys
from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from .hw_types import FaultType
from .layouts import GT_LAYOUT, WORD2_LAYOUT
from .integrity32 import integrity32_amaranth


# ---------------------------------------------------------------------------
# Python-level helpers (must agree exactly with hardware/core.py)
# ---------------------------------------------------------------------------

def _integrity32(w0, w1):
    """Python replica of hardware/integrity32.py for test vector generation."""
    def rol32(x, n):
        x = x & 0xFFFFFFFF
        return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF
    w1m = w1 & 0x3FFFFFFF   # mask g_bit[30] and f_flag[31] ★v2.0
    return (rol32(w0, 7) ^ rol32(w1m, 13) ^ 0xDEADBEEF) & 0xFFFFFFFF


# A spread of "adversarial" W3 (DR15) values to prove W3 is inert.
_W3_VALUES = [
    0x00000000,   # zeroed (Mint default)
    0xFFFFFFFF,   # all ones
    0xDEADBEEF,   # arbitrary garbage
    0x13579BDF,   # random-ish
    0xA5A5A5A5,   # tampered pattern
]


# ---------------------------------------------------------------------------
# Minimal Elaboratable that mirrors the UPDATED hardware WRITEBACK check
# ---------------------------------------------------------------------------

class MWinFSMUnit(Elaboratable):
    """Single-state check mirroring the post-Task-#2862 WRITEBACK condition.

    Inputs (set before trigger):
        dr11 — GT word (bits[26:25] must be non-NULL to allow writeback) ★v2.0
        dr12 — NS location word
        dr13 — NS authority word
        dr14 — expected integrity32(dr12, dr13)
        dr15 — resident Inform W3 (cache_token32) — NON-authoritative; ignored

    Input:
        trigger — pulse high for one cycle to latch DR regs and begin check

    Outputs (combinatorial in CHECK state):
        cr_wr_en    — 1 when all authoritative checks pass (writeback succeeds)
        fault_valid — 1 when any authoritative check fails (fail closed)
    """

    def __init__(self):
        self.dr11 = Signal(32)
        self.dr12 = Signal(32)
        self.dr13 = Signal(32)
        self.dr14 = Signal(32)
        self.dr15 = Signal(32)   # cache_token32 — latched but never consulted
        self.trigger    = Signal()
        self.cr_wr_en   = Signal()
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        dr11_lat = Signal(32)
        dr12_lat = Signal(32)
        dr13_lat = Signal(32)
        dr14_lat = Signal(32)
        dr15_lat = Signal(32)   # cache_token32 shadow (diagnostic only)

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

        # DR11 validity: bits[26:25] != 0b00 (not NULL) ★v2.0 gt_type at [26:25]
        dr11_valid = Signal()
        m.d.comb += dr11_valid.eq(dr11_lat[25:27] != 0)

        # NOTE (Task #2862): NO seal / DR15 check.  dr15_lat is latched purely
        # so the shadow layout matches hardware, but it is NEVER read below.

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
                # Only the three authoritative checks; DR15/W3 is not consulted.
                with m.If(integrity_ok & gtseq_ok):
                    m.d.comb += [self.cr_wr_en.eq(1), self.fault_valid.eq(0)]
                with m.Else():
                    m.d.comb += [self.cr_wr_en.eq(0), self.fault_valid.eq(1)]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += [self.cr_wr_en.eq(0), self.fault_valid.eq(1)]
                m.next = "IDLE"

        return m


# ---------------------------------------------------------------------------
# Simulation driver
# ---------------------------------------------------------------------------

def _run_case(dr11, dr12, dr13, dr14, dr15):
    """Drive one WRITEBACK transaction; return (cr_wr_en, fault_valid)."""
    dut = MWinFSMUnit()
    out = {}

    async def testbench(ctx):
        ctx.set(dut.dr11, dr11)
        ctx.set(dut.dr12, dr12)
        ctx.set(dut.dr13, dr13)
        ctx.set(dut.dr14, dr14)
        ctx.set(dut.dr15, dr15)
        ctx.set(dut.trigger, 1)
        await ctx.tick()   # IDLE: latch → WRITEBACK or FAULT
        ctx.set(dut.trigger, 0)
        out["cr_wr_en"]   = ctx.get(dut.cr_wr_en)
        out["fault_valid"] = ctx.get(dut.fault_valid)
        await ctx.tick()   # → IDLE

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    return out["cr_wr_en"], out["fault_valid"]


_GTSEQ_MASK = ~(0x1FF << 21) & 0xFFFFFFFF   # zero out W2 bits[29:21]


def _good_vectors():
    """(w12, w13) pairs whose W2 gt_seq[29:21]=0 so gtseq matches GT.gt_seq=0."""
    return [
        (0x00001000, 0x00000010 & _GTSEQ_MASK),
        (0xABCDEF01, 0x12345678 & _GTSEQ_MASK),
        (0xDEADBEEF, 0xCAFE0000 & _GTSEQ_MASK),
    ]


# ---------------------------------------------------------------------------
# Test 1: valid checks + ANY W3 → writeback succeeds (W3 cannot DENY)
# ---------------------------------------------------------------------------

def test_random_w3_cannot_deny():
    """Random/tampered DR15 (W3) never denies a valid writeback."""
    print("=== Test 1: random/tampered W3 cannot DENY writeback ===")
    gt_word = (0b01 << 25)   # gt_type=INFORM, gt_seq=0, slot=0
    all_ok = True
    for (w12, w13) in _good_vectors():
        integ = _integrity32(w12, w13)
        for w3 in _W3_VALUES:
            cr_wr, fault_v = _run_case(gt_word, w12, w13, integ, w3)
            if cr_wr != 1 or fault_v != 0:
                print(f"  FAIL ({w12:#010x},{w13:#010x}) W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False
    assert all_ok, "Test 1 had failures (W3 wrongly denied a valid writeback)"
    print("PASS")


# ---------------------------------------------------------------------------
# Test 2: invalid checks + ANY W3 → fault (W3 cannot AUTHORISE)
# ---------------------------------------------------------------------------

def test_random_w3_cannot_authorize():
    """Random/tampered DR15 (W3) never authorises when W1/W2/seq/GT are bad."""
    print("\n=== Test 2: random/tampered W3 cannot AUTHORISE writeback ===")
    gt_word_inform = (0b01 << 25)   # INFORM, gt_seq=0
    all_ok = True

    for (w12, w13) in _good_vectors():
        good_integ = _integrity32(w12, w13)

        # (a) bad W2/integrity: DR14 does not match integrity32(DR12, DR13)
        for w3 in _W3_VALUES:
            bad_integ = good_integ ^ 0x1
            cr_wr, fault_v = _run_case(gt_word_inform, w12, w13, bad_integ, w3)
            if cr_wr != 0 or fault_v != 1:
                print(f"  FAIL bad-integrity ({w12:#010x}) W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False

        # (b) tampered W1 (DR12): integrity no longer matches the stored DR14
        for w3 in _W3_VALUES:
            tampered_w12 = w12 ^ 0x00000100
            cr_wr, fault_v = _run_case(gt_word_inform, tampered_w12, w13,
                                       good_integ, w3)
            if cr_wr != 0 or fault_v != 1:
                print(f"  FAIL tampered-W1 ({w12:#010x}) W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False

        # (c) bad gt_seq: GT.gt_seq (DR11[24:16]) != W2.gt_seq (DR13[29:21])
        for w3 in _W3_VALUES:
            gt_seq5 = (5 << 16)                         # GT.gt_seq = 5
            gt_word_seq = gt_word_inform | gt_seq5
            # W2.gt_seq left at 0 → mismatch; recompute integrity for this W2.
            cr_wr, fault_v = _run_case(gt_word_seq, w12, w13, good_integ, w3)
            if cr_wr != 0 or fault_v != 1:
                print(f"  FAIL bad-gtseq ({w12:#010x}) W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False

        # (d) NULL GT: DR11 gt_type == 0b00 → FAULT regardless of everything
        for w3 in _W3_VALUES:
            cr_wr, fault_v = _run_case(0x00000000, w12, w13, good_integ, w3)
            if cr_wr != 0 or fault_v != 1:
                print(f"  FAIL null-GT ({w12:#010x}) W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False

    assert all_ok, "Test 2 had failures (W3 wrongly authorised / did not fail closed)"
    print("PASS")


# ---------------------------------------------------------------------------
# Test 3: a matching gt_seq on BOTH sides still passes (positive control)
# ---------------------------------------------------------------------------

def test_matching_gtseq_passes():
    """When GT.gt_seq matches W2.gt_seq, a valid entry still writes back."""
    print("\n=== Test 3: matching gt_seq still authorises (positive control) ===")
    all_ok = True
    for seq in (0, 1, 7, 0x1FF):
        w12 = 0x00004000
        # W2 with gt_seq[29:21]=seq, limit in low bits
        w13 = ((seq & 0x1FF) << 21) | 0x000000FF
        integ = _integrity32(w12, w13)
        gt_word = (0b01 << 25) | ((seq & 0x1FF) << 16)   # INFORM, GT.gt_seq=seq
        for w3 in _W3_VALUES:
            cr_wr, fault_v = _run_case(gt_word, w12, w13, integ, w3)
            if cr_wr != 1 or fault_v != 0:
                print(f"  FAIL matching-seq seq={seq} W3={w3:#010x}: "
                      f"cr_wr_en={cr_wr} fault_valid={fault_v}")
                all_ok = False
    assert all_ok, "Test 3 had failures (valid matching-seq entry did not authorise)"
    print("PASS")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_random_w3_cannot_deny,
        test_random_w3_cannot_authorize,
        test_matching_gtseq_passes,
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
