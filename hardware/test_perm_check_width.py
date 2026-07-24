"""Regression tests: ChurchPermCheck must not truncate 9-bit gt_seq or 32-bit seal values.

ChurchPermCheck.stored_gt_seq / .gt_seq were widened from Signal(7) to Signal(9)
and calculated_seal / stored_seal from Signal(16) to Signal(32) to match the v2.0
GT format.  These tests confirm that values which require the upper bits are
correctly handled — a narrow-bus truncation bug in a caller would be silent
without explicit coverage of these bit positions.

Coverage
────────
    Test 1  — pure-Python: gt_seq field extraction from a make_gt word uses all 9 bits
    Test 2  — simulation: gt_seq > 127 (bit 8 set) matches correctly (no upper-bit truncation)
    Test 3  — simulation: gt_seq > 127 in stored but NOT in input → version fault fires
                          (would silently pass if both were truncated to 7 bits and became 0)
    Test 4  — simulation: 32-bit seal with bits[31:16] non-zero → seal_valid when equal
    Test 5  — simulation: 32-bit seal differs only in upper 16 bits → seal fault fires
                          (would silently pass if seal were truncated to 16 bits)

Run with:  python -m hardware.test_perm_check_width
"""

import sys
from amaranth.sim import Simulator

from .perm_check import ChurchPermCheck
from .hw_types import (
    make_gt, GT_TYPE_ABSTRACT,
    PERM_MASK_R, FaultType,
)


# ---------------------------------------------------------------------------
# Test 1: pure-Python — gt_seq field in make_gt covers all 9 bits
# ---------------------------------------------------------------------------

def test_gt_seq_field_width():
    """make_gt places gt_seq in bits [24:16] — all 9 bits must survive the round-trip."""
    print("=== Test 1: gt_seq field width in make_gt ===")

    for seq in (0, 1, 127, 128, 255, 256, 511):
        word    = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R, slot_id=1, gt_seq=seq)
        decoded = (word >> 16) & 0x1FF   # 9-bit mask
        assert decoded == seq, (
            f"gt_seq round-trip failed for seq={seq}: "
            f"word={word:#010x}, decoded={decoded}"
        )

    print("  All gt_seq values [0..511] round-trip correctly through bits[24:16].")
    print("PASS")


# ---------------------------------------------------------------------------
# Helper: run a one-shot ChurchPermCheck simulation
# ---------------------------------------------------------------------------

def _run_perm_check(*, gt_word, required_perms,
                    check_version, stored_gt_seq, gt_seq,
                    check_seal, calculated_seal, stored_seal,
                    check_valid=True, check_bounds=False):
    """Instantiate ChurchPermCheck, drive one set of inputs, return output dict."""
    dut     = ChurchPermCheck()
    results = {}

    async def testbench(ctx):
        ctx.set(dut.gt_in.as_value(),  gt_word)
        ctx.set(dut.required_perms,   required_perms)
        ctx.set(dut.check_valid,      int(check_valid))
        ctx.set(dut.check_bounds,     int(check_bounds))
        ctx.set(dut.check_version,    int(check_version))
        ctx.set(dut.stored_gt_seq,    stored_gt_seq)
        ctx.set(dut.gt_seq,           gt_seq)
        ctx.set(dut.check_seal,       int(check_seal))
        ctx.set(dut.calculated_seal,  calculated_seal)
        ctx.set(dut.stored_seal,      stored_seal)
        ctx.set(dut.access_index,     0)
        ctx.set(dut.limit,            0xFFFFFFFF)

        results["perm_granted"]    = ctx.get(dut.perm_granted)
        results["version_ok"]      = ctx.get(dut.version_ok)
        results["seal_valid"]      = ctx.get(dut.seal_valid)
        results["all_checks_pass"] = ctx.get(dut.all_checks_pass)
        results["fault_valid"]     = ctx.get(dut.fault_valid)
        results["fault_type"]      = ctx.get(dut.fault_type)

    sim = Simulator(dut)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    return results


# ---------------------------------------------------------------------------
# Test 2: gt_seq > 127 — match (version_ok must be True, no upper-bit loss)
# ---------------------------------------------------------------------------

def test_gt_seq_high_bit_match():
    """ChurchPermCheck: stored_gt_seq == gt_seq == 256 → version_ok=True.

    256 = 0x100 = 0b100000000 — requires bit 8 of the 9-bit field.
    A truncated 7-bit comparison would map 256 → 0 on both sides and still
    report a match, so this test validates the correct path.  Test 3 below
    drives stored=256 vs input=0 to detect the actual truncation failure mode.
    """
    print("\n=== Test 2: gt_seq=256 match — no upper-bit truncation ===")

    GT_SEQ_HIGH = 256   # bit 8 set

    gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                      slot_id=1, gt_seq=GT_SEQ_HIGH)

    r = _run_perm_check(
        gt_word        = gt_word,
        required_perms = PERM_MASK_R,
        check_version  = True,
        stored_gt_seq  = GT_SEQ_HIGH,
        gt_seq         = GT_SEQ_HIGH,
        check_seal     = False,
        calculated_seal= 0,
        stored_seal    = 0,
    )

    assert r["version_ok"], (
        f"version_ok must be True when stored_gt_seq == gt_seq == {GT_SEQ_HIGH}; "
        f"got version_ok=False (upper-bit truncation suspected)"
    )
    assert r["perm_granted"], "perm_granted must be True for matching R-perm ABSTRACT GT"
    assert r["all_checks_pass"], "all_checks_pass must be True when every check succeeds"
    assert not r["fault_valid"], "fault_valid must be False on a clean match"

    print(f"  gt_seq={GT_SEQ_HIGH} ({GT_SEQ_HIGH:#05x}) — stored==input → version_ok=True  ✓")
    print("PASS")


# ---------------------------------------------------------------------------
# Test 3: gt_seq > 127 — mismatch must NOT be silenced by truncation
# ---------------------------------------------------------------------------

def test_gt_seq_high_bit_mismatch():
    """ChurchPermCheck: stored_gt_seq=256, gt_seq=0 → version_ok=False, VERSION fault.

    The dangerous truncation scenario: if both signals were 7-bit,
    stored_gt_seq=256 → 0 and gt_seq=0 → 0, so the comparison would falsely
    report a match.  With correct 9-bit signals the mismatch must be detected.

    Also tests with stored_gt_seq=128 (bit 7) and gt_seq=0 to cover the
    boundary between 7-bit and 8-bit ranges.
    """
    print("\n=== Test 3: gt_seq mismatch with high bits — VERSION fault expected ===")

    for (stored_seq, input_seq) in ((256, 0), (128, 0), (511, 255), (300, 44)):
        gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                          slot_id=1, gt_seq=input_seq)

        r = _run_perm_check(
            gt_word        = gt_word,
            required_perms = PERM_MASK_R,
            check_version  = True,
            stored_gt_seq  = stored_seq,
            gt_seq         = input_seq,
            check_seal     = False,
            calculated_seal= 0,
            stored_seal    = 0,
        )

        assert not r["version_ok"], (
            f"version_ok must be False when stored_gt_seq={stored_seq} != gt_seq={input_seq}; "
            f"got version_ok=True  (truncation bug: {stored_seq} & 0x7F = {stored_seq & 0x7F}, "
            f"{input_seq} & 0x7F = {input_seq & 0x7F})"
        )
        assert r["fault_valid"], (
            f"fault_valid must be True for a version mismatch (stored={stored_seq}, input={input_seq})"
        )
        assert r["fault_type"] == int(FaultType.VERSION), (
            f"fault_type must be VERSION ({int(FaultType.VERSION)}); "
            f"got {r['fault_type']} (stored={stored_seq}, input={input_seq})"
        )
        print(f"  stored_gt_seq={stored_seq}, gt_seq={input_seq} → VERSION fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Test 4: 32-bit seal with bits[31:16] non-zero — seal_valid=True on match
# ---------------------------------------------------------------------------

def test_seal_upper_bits_match():
    """ChurchPermCheck: calculated_seal == stored_seal with bits[31:16] non-zero.

    If seal were truncated to 16 bits, the upper half would be ignored and the
    comparison below would still pass — Test 5 provides the falsification case.
    This test validates the happy path with a distinctive upper-half pattern.
    """
    print("\n=== Test 4: 32-bit seal upper bits — match → seal_valid=True ===")

    SEAL_VALUE = 0xDEAD_BEEF   # bits[31:16] = 0xDEAD (clearly non-zero)

    gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                      slot_id=1, gt_seq=0)

    r = _run_perm_check(
        gt_word        = gt_word,
        required_perms = PERM_MASK_R,
        check_version  = False,
        stored_gt_seq  = 0,
        gt_seq         = 0,
        check_seal     = True,
        calculated_seal= SEAL_VALUE,
        stored_seal    = SEAL_VALUE,
    )

    assert r["seal_valid"], (
        f"seal_valid must be True when calculated_seal == stored_seal == {SEAL_VALUE:#010x}; "
        f"got seal_valid=False"
    )
    assert not r["fault_valid"], "fault_valid must be False on a clean seal match"
    assert r["all_checks_pass"], "all_checks_pass must be True when every enabled check passes"

    print(f"  seal={SEAL_VALUE:#010x} — calculated==stored → seal_valid=True  ✓")
    print("PASS")


# ---------------------------------------------------------------------------
# Test 5: 32-bit seal differing only in bits[31:16] — SEAL fault must fire
# ---------------------------------------------------------------------------

def test_seal_upper_bits_mismatch():
    """ChurchPermCheck: seals differ only in bits[31:16] → seal_valid=False, SEAL fault.

    If seal were truncated to 16 bits, the upper halves would be discarded and
    the comparison would falsely succeed.  With correct 32-bit signals the
    mismatch must produce a SEAL fault.
    """
    print("\n=== Test 5: 32-bit seal upper bits mismatch — SEAL fault expected ===")

    for (calc_seal, stored_seal) in (
        (0xDEAD_0000, 0xBEEF_0000),   # differ only in bits[31:16], lower half identical
        (0xFFFF_0000, 0x0000_0000),   # extreme: upper all-1s vs upper all-0s
        (0x0001_ABCD, 0x0002_ABCD),   # low upper byte differs, lower half same
    ):
        gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                          slot_id=1, gt_seq=0)

        r = _run_perm_check(
            gt_word        = gt_word,
            required_perms = PERM_MASK_R,
            check_version  = False,
            stored_gt_seq  = 0,
            gt_seq         = 0,
            check_seal     = True,
            calculated_seal= calc_seal,
            stored_seal    = stored_seal,
        )

        assert not r["seal_valid"], (
            f"seal_valid must be False when calculated_seal={calc_seal:#010x} != "
            f"stored_seal={stored_seal:#010x}; got seal_valid=True  "
            f"(16-bit truncation would make lower halves match: "
            f"{calc_seal & 0xFFFF:#06x} == {stored_seal & 0xFFFF:#06x})"
        )
        assert r["fault_valid"], (
            f"fault_valid must be True for seal mismatch "
            f"(calc={calc_seal:#010x}, stored={stored_seal:#010x})"
        )
        assert r["fault_type"] == int(FaultType.SEAL), (
            f"fault_type must be SEAL ({int(FaultType.SEAL)}); "
            f"got {r['fault_type']}  (calc={calc_seal:#010x}, stored={stored_seal:#010x})"
        )
        print(f"  calc={calc_seal:#010x}, stored={stored_seal:#010x} → SEAL fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_gt_seq_field_width,
        test_gt_seq_high_bit_match,
        test_gt_seq_high_bit_mismatch,
        test_seal_upper_bits_match,
        test_seal_upper_bits_mismatch,
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
