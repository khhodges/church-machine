"""Unit tests for ChurchPermCheck.elaborate() — seal and version check wiring.

check_seal and check_version are declared and elaborated in perm_check.py but
currently driven to 0 (unused) in core.py.  These tests confirm that the
combinational logic is correctly wired so that a future developer who connects
those inputs to real seal/version logic will not silently get always-passing or
always-failing checks with no test signal.

Coverage
────────
    Test 1  — check_seal=1, calculated_seal==stored_seal  → seal_valid=1, no fault
    Test 2  — check_seal=1, calculated_seal!=stored_seal  → seal_valid=0, fault_type=SEAL
    Test 3  — check_version=1, gt_seq==stored_gt_seq      → version_ok=1, no fault
    Test 4  — check_version=1, gt_seq!=stored_gt_seq      → version_ok=0, fault_type=VERSION

Each test is run via Amaranth sim.Simulator with a combinational testbench.
No clock is required — ChurchPermCheck is pure combinational logic.

Run with:  python -m hardware.test_perm_check
"""

import sys
from amaranth.sim import Simulator

from .perm_check import ChurchPermCheck
from .hw_types import make_gt, GT_TYPE_ABSTRACT, PERM_MASK_R, FaultType


# ---------------------------------------------------------------------------
# Helper: run one ChurchPermCheck simulation and return output signals
# ---------------------------------------------------------------------------

def _run_perm_check(
    *,
    gt_word,
    required_perms,
    check_seal,
    calculated_seal,
    stored_seal,
    check_version,
    gt_seq,
    stored_gt_seq,
    check_valid=True,
    check_bounds=False,
):
    """Drive ChurchPermCheck with one set of inputs; return dict of outputs."""
    dut = ChurchPermCheck()
    results = {}

    async def testbench(ctx):
        ctx.set(dut.gt_in.as_value(), gt_word)
        ctx.set(dut.required_perms,   required_perms)
        ctx.set(dut.check_valid,      int(check_valid))
        ctx.set(dut.check_bounds,     int(check_bounds))
        ctx.set(dut.access_index,     0)
        ctx.set(dut.limit,            0xFFFFFFFF)

        ctx.set(dut.check_seal,       int(check_seal))
        ctx.set(dut.calculated_seal,  calculated_seal)
        ctx.set(dut.stored_seal,      stored_seal)

        ctx.set(dut.check_version,    int(check_version))
        ctx.set(dut.gt_seq,           gt_seq)
        ctx.set(dut.stored_gt_seq,    stored_gt_seq)

        results["seal_valid"]      = ctx.get(dut.seal_valid)
        results["version_ok"]      = ctx.get(dut.version_ok)
        results["perm_granted"]    = ctx.get(dut.perm_granted)
        results["all_checks_pass"] = ctx.get(dut.all_checks_pass)
        results["fault_valid"]     = ctx.get(dut.fault_valid)
        results["fault_type"]      = ctx.get(dut.fault_type)

    sim = Simulator(dut)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    return results


# Canonical GT word used across all tests: ABSTRACT, R-perm, gt_seq=0
_ABSTRACT_R_GT = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                          slot_id=1, gt_seq=0)


# ---------------------------------------------------------------------------
# Test 1: check_seal=1, calculated_seal == stored_seal → seal_valid=1
# ---------------------------------------------------------------------------

def test_check_seal_match():
    """check_seal=1 and seals match → seal_valid=1, no fault.

    Verifies that check_seal=1 does NOT unconditionally assert a fault — the
    happy path (equal seals) must produce seal_valid=1 and fault_valid=0.
    """
    print("=== Test 1: check_seal=1, calculated_seal==stored_seal → seal_valid=1 ===")

    SEAL_VECTORS = (
        0x00000001,   # minimal non-zero value
        0x1FFFFFFF,   # all 25-bit seal bits set
        0xDEAD_BEEF,  # arbitrary 32-bit value with upper bits set
        0x00000000,   # zero — both sides zero is a valid match
    )

    for seal in SEAL_VECTORS:
        r = _run_perm_check(
            gt_word         = _ABSTRACT_R_GT,
            required_perms  = PERM_MASK_R,
            check_seal      = True,
            calculated_seal = seal,
            stored_seal     = seal,
            check_version   = False,
            gt_seq          = 0,
            stored_gt_seq   = 0,
        )

        assert r["seal_valid"], (
            f"seal_valid must be 1 when calculated_seal == stored_seal == {seal:#010x}; "
            f"got seal_valid=0  (check_seal=1 unconditionally blocking?)"
        )
        assert not r["fault_valid"], (
            f"fault_valid must be 0 when seals match ({seal:#010x}); "
            f"got fault_valid=1 (fault_type={r['fault_type']})"
        )
        assert r["all_checks_pass"], (
            f"all_checks_pass must be 1 on a full seal match; "
            f"got 0 for seal={seal:#010x}"
        )
        print(f"  seal={seal:#010x} — calculated==stored → seal_valid=1, no fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Test 2: check_seal=1, calculated_seal != stored_seal → seal_valid=0, SEAL fault
# ---------------------------------------------------------------------------

def test_check_seal_mismatch():
    """check_seal=1 and seals differ → seal_valid=0, fault_type=SEAL.

    Verifies that a seal mismatch is detected and surfaces the correct fault type.
    An always-passing implementation would let this through silently.
    """
    print("\n=== Test 2: check_seal=1, calculated_seal!=stored_seal → SEAL fault ===")

    SEAL_PAIRS = (
        (0x00000001, 0x00000002),   # differ by 1
        (0x1FFFFFFF, 0x00000000),   # full vs zero
        (0xDEAD_BEEF, 0xDEAD_CAFE), # differ only in lower half
        (0x0001_0000, 0x0002_0000), # differ only in upper half
    )

    for (calc, stored) in SEAL_PAIRS:
        r = _run_perm_check(
            gt_word         = _ABSTRACT_R_GT,
            required_perms  = PERM_MASK_R,
            check_seal      = True,
            calculated_seal = calc,
            stored_seal     = stored,
            check_version   = False,
            gt_seq          = 0,
            stored_gt_seq   = 0,
        )

        assert not r["seal_valid"], (
            f"seal_valid must be 0 when calculated={calc:#010x} != stored={stored:#010x}; "
            f"got seal_valid=1  (always-passing bug?)"
        )
        assert r["fault_valid"], (
            f"fault_valid must be 1 for a seal mismatch "
            f"(calc={calc:#010x}, stored={stored:#010x})"
        )
        assert r["fault_type"] == int(FaultType.SEAL), (
            f"fault_type must be SEAL ({int(FaultType.SEAL)}); "
            f"got {r['fault_type']}  (calc={calc:#010x}, stored={stored:#010x})"
        )
        assert not r["all_checks_pass"], (
            f"all_checks_pass must be 0 when seal check fails; "
            f"got 1 for calc={calc:#010x}, stored={stored:#010x}"
        )
        print(f"  calc={calc:#010x} vs stored={stored:#010x} → SEAL fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Test 3: check_version=1, gt_seq == stored_gt_seq → version_ok=1
# ---------------------------------------------------------------------------

def test_check_version_match():
    """check_version=1 and sequences match → version_ok=1, no fault.

    Verifies that check_version=1 does NOT unconditionally assert a fault — the
    happy path (equal sequences) must produce version_ok=1 and fault_valid=0.
    """
    print("\n=== Test 3: check_version=1, gt_seq==stored_gt_seq → version_ok=1 ===")

    SEQ_VECTORS = (0, 1, 127, 128, 255, 511)   # covers all 9-bit range boundaries

    for seq in SEQ_VECTORS:
        gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                          slot_id=1, gt_seq=seq)

        r = _run_perm_check(
            gt_word         = gt_word,
            required_perms  = PERM_MASK_R,
            check_seal      = False,
            calculated_seal = 0,
            stored_seal     = 0,
            check_version   = True,
            gt_seq          = seq,
            stored_gt_seq   = seq,
        )

        assert r["version_ok"], (
            f"version_ok must be 1 when gt_seq == stored_gt_seq == {seq}; "
            f"got version_ok=0  (check_version=1 unconditionally blocking?)"
        )
        assert not r["fault_valid"], (
            f"fault_valid must be 0 when sequences match (seq={seq}); "
            f"got fault_valid=1 (fault_type={r['fault_type']})"
        )
        assert r["all_checks_pass"], (
            f"all_checks_pass must be 1 on a full version match; "
            f"got 0 for seq={seq}"
        )
        print(f"  gt_seq={seq} — input==stored → version_ok=1, no fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Test 4: check_version=1, gt_seq != stored_gt_seq → version_ok=0, VERSION fault
# ---------------------------------------------------------------------------

def test_check_version_mismatch():
    """check_version=1 and sequences differ → version_ok=0, fault_type=VERSION.

    Verifies that a version mismatch is detected and surfaces the correct fault type.
    An always-passing implementation would let revoked capabilities through silently.
    """
    print("\n=== Test 4: check_version=1, gt_seq!=stored_gt_seq → VERSION fault ===")

    SEQ_PAIRS = (
        (0, 1),       # stored=0 (initial), input=1 (revoked one step)
        (1, 0),       # stored=1, stale input=0
        (128, 0),     # stored has high bit set; would silently match if truncated to 7-bit
        (511, 255),   # near-max: differ in bit 8
        (300, 44),    # arbitrary mismatch
    )

    for (stored_seq, input_seq) in SEQ_PAIRS:
        gt_word = make_gt(gt_type=GT_TYPE_ABSTRACT, perms=PERM_MASK_R,
                          slot_id=1, gt_seq=input_seq)

        r = _run_perm_check(
            gt_word         = gt_word,
            required_perms  = PERM_MASK_R,
            check_seal      = False,
            calculated_seal = 0,
            stored_seal     = 0,
            check_version   = True,
            gt_seq          = input_seq,
            stored_gt_seq   = stored_seq,
        )

        assert not r["version_ok"], (
            f"version_ok must be 0 when stored_gt_seq={stored_seq} != gt_seq={input_seq}; "
            f"got version_ok=1  (always-passing bug?)"
        )
        assert r["fault_valid"], (
            f"fault_valid must be 1 for a version mismatch "
            f"(stored={stored_seq}, input={input_seq})"
        )
        assert r["fault_type"] == int(FaultType.VERSION), (
            f"fault_type must be VERSION ({int(FaultType.VERSION)}); "
            f"got {r['fault_type']}  (stored={stored_seq}, input={input_seq})"
        )
        assert not r["all_checks_pass"], (
            f"all_checks_pass must be 0 when version check fails; "
            f"got 1 for stored={stored_seq}, input={input_seq}"
        )
        print(f"  stored_gt_seq={stored_seq}, gt_seq={input_seq} → VERSION fault  ✓")

    print("PASS")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_check_seal_match,
        test_check_seal_mismatch,
        test_check_version_match,
        test_check_version_mismatch,
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
