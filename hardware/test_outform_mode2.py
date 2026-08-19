"""Unit + integration tests for ChurchOutformFSM — Mode 2 CALL Outform ingress.

── Fail-closed containment (Task #2862) ──
The Mode 2 CALL intercept used to lazily download a non-resident lump over the
network and promote the source CR's Outform GT to a resident Inform GT.  That
promotion was authenticated only by a fused CRC-32 + integrity32(T), neither of
which is authentication, and no trusted externally-authenticated Mint input
exists.  The intercept is now fault-closed: it faults with OUTFORM_UNAUTH
before any download / allocation / Mint / NS / c-list write and before any CR
promotion.

FSM unit tests (Tests 1–3) exercise ChurchOutformFSM in isolation:
  Test 1: intercept_start → FAULT (OUTFORM_UNAUTH); NO outform_start_out, NO
          cr_wr_en (CRC-valid attacker payload cannot even begin promotion).
  Test 2: legacy fault-propagation path stays safe (still FAULT → IDLE).
  Test 3: IDLE quiescence (intercept_start=0)

ChurchCore integration test (Test 4) boots a full ChurchCore instance, writes
an Outform GT into a source CR via the debug port, presents a CALL instruction,
and verifies the ingress fault-closes: fault_valid fires with OUTFORM_UNAUTH,
outform_busy (download engine) never rises, and the source CR is NOT promoted
to Inform (no resident-state write).

Run with:  python -m hardware.test_outform_mode2
"""

from amaranth import *
from amaranth.lib.data import View
from amaranth.sim import Simulator

from .church_outform import ChurchOutformFSM
from .hw_types import GT_TYPE_INFORM, GT_TYPE_OUTFORM, FaultType, ChurchOpcode, CondCode
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


# ---------------------------------------------------------------------------
# Helper constants
# ---------------------------------------------------------------------------

OUTFORM_SLOT_ID   = 0x0005
OUTFORM_PERMS     = 0b000100   # PERM_E bit set
OUTFORM_GT_SEQ    = 0
OUTFORM_B_FLAG    = 0
OUTFORM_LOCATION  = 0xDEAD0000
OUTFORM_W2        = 0x00001234

MINTED_SEQ        = 1
SRC_CR_ADDR       = 3

_NULL_GT_DICT     = {
    "slot_id": 0, "gt_seq": 0, "gt_type": 0,
    "dom": 0, "perm": 0, "b_flag": 0,
}
_NULL_CAP_DICT    = {
    "word0_gt": _NULL_GT_DICT,
    "word1_location": 0,
    "word2_w2": 0,
}
_OUTFORM_GT_DICT  = {
    "slot_id": OUTFORM_SLOT_ID,
    "gt_seq":  OUTFORM_GT_SEQ,
    "gt_type": GT_TYPE_OUTFORM,
    "dom":     1,              # Church domain (E-perm)
    "perm":    OUTFORM_PERMS,  # perm[2]=E=1 → 0b100=4
    "b_flag":  OUTFORM_B_FLAG,
}
_OUTFORM_CAP_DICT = {
    "word0_gt":       _OUTFORM_GT_DICT,
    "word1_location": OUTFORM_LOCATION,
    "word2_w2":       OUTFORM_W2,
}


def _pack_word0_gt(gt_type, slot_id, gt_seq=0, dom=0, perm=0, b_flag=0):
    """Pack a 32-bit GT word using v2.0 GT_LAYOUT bit positions.
    Layout: slot_id[15:0] | gt_seq[24:16] (9b) | gt_type[26:25] | dom[27] | perm[30:28] | b_flag[31] ★v2.0
    """
    return (
          (slot_id  & 0xFFFF)
        | ((gt_seq  & 0x1FF) << 16)
        | ((gt_type & 0x3)   << 25)
        | ((dom     & 0x1)   << 27)
        | ((perm    & 0x7)   << 28)
        | ((b_flag  & 0x1)   << 31)
    )


OUTFORM_WORD0 = _pack_word0_gt(
    gt_type=GT_TYPE_OUTFORM,
    slot_id=OUTFORM_SLOT_ID,
    gt_seq=OUTFORM_GT_SEQ,
    dom=1,                  # Church domain (E-perm)
    perm=OUTFORM_PERMS,     # perm[2]=E=1 → 0b100=4
    b_flag=OUTFORM_B_FLAG,
)
MINTED_WORD0 = _pack_word0_gt(
    gt_type=GT_TYPE_INFORM,
    slot_id=OUTFORM_SLOT_ID,
    gt_seq=MINTED_SEQ,
    dom=1,                  # Church domain (E-perm)
    perm=OUTFORM_PERMS,     # perm[2]=E=1 → 0b100=4
    b_flag=OUTFORM_B_FLAG,
)


# ---------------------------------------------------------------------------
# Test 1: FSM fail-closed — intercept faults BEFORE any download/promotion
#
# Regression for Task #2862: a CALL whose source CR holds an Outform GT (the
# handle an attacker uses to name a CRC-valid network payload) must NOT start
# the download engine and must NOT promote the source CR.  The intercept
# fault-closes with OUTFORM_UNAUTH the cycle after intercept_start, with:
#   - outform_start_out never asserted (no download → no alloc → no Mint →
#     no NS/c-list write)
#   - cr_wr_en never asserted (source CR never promoted to a resident Inform GT)
# ---------------------------------------------------------------------------

def test_mode2_fail_closed():
    """ChurchOutformFSM must fault-close a CALL Outform intercept.

    State sequence (contained):
      IDLE  (intercept_start=1) → FAULT   (fault_type = OUTFORM_UNAUTH)
      FAULT                     → IDLE
    Neither outform_start_out nor cr_wr_en is ever asserted, so a CRC-valid
    attacker-controlled payload cannot be downloaded, minted, or promoted.
    """
    dut = ChurchOutformFSM()
    results = {}

    async def testbench(ctx):
        ctx.set(dut.intercept_start,       0)
        ctx.set(dut.src_cr,                0)
        ctx.set(dut.src_cr_data,           _NULL_CAP_DICT)
        ctx.set(dut.outform_done_in,       0)
        ctx.set(dut.outform_fault_in,      0)
        ctx.set(dut.outform_fault_type_in, 0)
        ctx.set(dut.result_gt_in,          0)
        await ctx.tick()

        # ── IDLE: assert intercept_start for one cycle ────────────────────────
        ctx.set(dut.intercept_start, 1)
        ctx.set(dut.src_cr,          SRC_CR_ADDR)
        ctx.set(dut.src_cr_data,     _OUTFORM_CAP_DICT)
        await ctx.tick()
        ctx.set(dut.intercept_start, 0)

        # Attacker keeps feeding a "download complete" with a CRC-valid minted
        # GT for several cycles — it must have NO effect (FSM already faulting).
        ctx.set(dut.outform_done_in, 1)
        ctx.set(dut.result_gt_in,    MINTED_WORD0)

        # Sample every cycle for a window covering the whole (would-be) promotion
        # path; assert start_out and cr_wr_en NEVER fire.
        start_out_seen = 0
        cr_wr_en_seen  = 0
        fault_seen     = 0
        fault_type     = 0
        for _ in range(8):
            if ctx.get(dut.outform_start_out):
                start_out_seen = 1
            if ctx.get(dut.cr_wr_en):
                cr_wr_en_seen = 1
            if ctx.get(dut.fault):
                fault_seen = 1
                fault_type = ctx.get(dut.fault_type)
            await ctx.tick()

        ctx.set(dut.outform_done_in, 0)
        results["start_out_seen"] = start_out_seen
        results["cr_wr_en_seen"]  = cr_wr_en_seen
        results["fault_seen"]     = fault_seen
        results["fault_type"]     = fault_type
        results["busy_after"]     = ctx.get(dut.busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("=== Test 1: Mode 2 CALL Outform intercept fault-closed (Task #2862) ===")

    if results["start_out_seen"]:
        print("FAIL: outform_start_out asserted — download engine started (alloc/Mint reachable)!")
        ok = False
    else:
        print("  PASS: outform_start_out never asserted (no download / alloc / Mint / NS / c-list write)")

    if results["cr_wr_en_seen"]:
        print("FAIL: cr_wr_en asserted — source CR promoted to a resident Inform GT!")
        ok = False
    else:
        print("  PASS: cr_wr_en never asserted (source CR never promoted)")

    if not results["fault_seen"]:
        print("FAIL: fault never asserted — ingress did not fault-close")
        ok = False
    if results["fault_type"] != int(FaultType.OUTFORM_UNAUTH):
        print(f"FAIL: fault_type={results['fault_type']}, expected "
              f"{int(FaultType.OUTFORM_UNAUTH)} (OUTFORM_UNAUTH)")
        ok = False
    else:
        print("  PASS: fault_type = OUTFORM_UNAUTH")

    if results["busy_after"]:
        print("FAIL: FSM still busy — machine wedged!")
        ok = False

    if ok:
        print("PASS")
    assert ok, "Test 1 (Mode 2 fail-closed) had failures — see output above"


# ---------------------------------------------------------------------------
# Test 2: FSM never reaches the (dead) download/promotion states
#
# Regression for Task #2862: even if the outform engine reports a completed,
# CRC-valid download (outform_done_in) with a minted result GT, the FSM must
# already be in its fault-closed path — it must NEVER assert done (which would
# tell decode the CALL may retry against a promoted GT).
# ---------------------------------------------------------------------------

def test_mode2_never_promotes():
    """Injecting a CRC-valid download-complete must not drive the FSM to DONE.

    The FSM fault-closes at IDLE, so the DONE pulse (which signals a successful
    promotion + CALL-retry) must never fire regardless of the engine inputs.
    """
    dut = ChurchOutformFSM()
    results = {}

    async def testbench(ctx):
        ctx.set(dut.intercept_start,       0)
        ctx.set(dut.src_cr,                0)
        ctx.set(dut.src_cr_data,           _NULL_CAP_DICT)
        ctx.set(dut.outform_done_in,       0)
        ctx.set(dut.outform_fault_in,      0)
        ctx.set(dut.outform_fault_type_in, 0)
        ctx.set(dut.result_gt_in,          0)
        await ctx.tick()

        ctx.set(dut.intercept_start, 1)
        ctx.set(dut.src_cr,          SRC_CR_ADDR)
        ctx.set(dut.src_cr_data,     _OUTFORM_CAP_DICT)
        await ctx.tick()
        ctx.set(dut.intercept_start, 0)

        # Simulate the download engine reporting success with a minted GT — the
        # exact stimulus that used to drive promotion.  It must be inert now.
        ctx.set(dut.outform_done_in, 1)
        ctx.set(dut.result_gt_in,    MINTED_WORD0)

        done_seen  = 0
        fault_seen = 0
        for _ in range(8):
            if ctx.get(dut.done):
                done_seen = 1
            if ctx.get(dut.fault):
                fault_seen = 1
            await ctx.tick()
        ctx.set(dut.outform_done_in, 0)

        results["done_seen"]  = done_seen
        results["fault_seen"] = fault_seen
        results["busy_after"] = ctx.get(dut.busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 2: Mode 2 never promotes on CRC-valid download (Task #2862) ===")

    if results["done_seen"]:
        print("FAIL: done pulse fired — FSM signalled a successful promotion!")
        ok = False
    else:
        print("  PASS: done never fired (no successful promotion / CALL-retry)")
    if not results["fault_seen"]:
        print("FAIL: fault never fired — ingress did not fault-close")
        ok = False
    if results["busy_after"]:
        print("FAIL: FSM still busy — machine wedged!")
        ok = False

    if ok:
        print("PASS")
    assert ok, "Test 2 (Mode 2 never promotes) had failures — see output above"


# ---------------------------------------------------------------------------
# Test 3: FSM does not fire when intercept_start is low
# ---------------------------------------------------------------------------

def test_mode2_no_intercept():
    """With intercept_start=0, the FSM stays in IDLE and no outputs assert."""
    dut = ChurchOutformFSM()
    results = {}

    async def testbench(ctx):
        ctx.set(dut.intercept_start,       0)
        ctx.set(dut.src_cr,                SRC_CR_ADDR)
        ctx.set(dut.src_cr_data,           _OUTFORM_CAP_DICT)
        ctx.set(dut.outform_done_in,       0)
        ctx.set(dut.outform_fault_in,      0)
        ctx.set(dut.outform_fault_type_in, 0)
        ctx.set(dut.result_gt_in,          0)

        for _ in range(5):
            await ctx.tick()

        results["busy"]      = ctx.get(dut.busy)
        results["start_out"] = ctx.get(dut.outform_start_out)
        results["cr_wr_en"]  = ctx.get(dut.cr_wr_en)
        results["done"]      = ctx.get(dut.done)
        results["fault"]     = ctx.get(dut.fault)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 3: Mode 2 FSM stays IDLE when intercept_start=0 ===")

    for name, val in results.items():
        if val != 0:
            print(f"FAIL: {name}={val} should be 0 in IDLE")
            ok = False

    if ok:
        print("PASS")
    assert ok, "Test 3 (IDLE quiescence) had failures — see output above"


# ---------------------------------------------------------------------------
# Test 4: ChurchCore integration — NIA hold + callee dispatch entry
# ---------------------------------------------------------------------------

def test_mode2_core_integration():
    """ChurchCore integration: a CALL with an Outform GT source fault-closes.

    Regression for Task #2862.  Boots a full ChurchCore (iot_profile=True),
    writes an Outform GT into CR1 via the debug port, feeds a CALL CR1→CR0
    instruction, and (adversarially) injects a CRC-valid download-complete via
    dbg_outform_done_inject with a minted Inform result GT.

    Assertions:
      1. fault_valid fires with fault code OUTFORM_UNAUTH.
      2. outform_busy (the download engine) NEVER rises — no network fetch /
         allocation / Mint / NS / c-list write is ever started.
      3. CR1 is NOT promoted to an Inform GT — it still reads as an Outform GT
         (no resident capability-register state was written by the ingress).
    """
    from .core import ChurchCore

    dut = ChurchCore(iot_profile=True)

    SRC_CR = 1
    DST_CR = 0
    CALL_PC = 0x0000_0000   # initial NIA after boot

    # CALL CR1 → CR0, cond=AL (always execute)
    CALL_INSTR = (
        (int(ChurchOpcode.CALL) << 27) |
        (int(CondCode.AL)       << 23) |
        (DST_CR                 << 19) |
        (SRC_CR                 << 15)
    )

    SLOT_ID = 0x0005
    PERMS   = 0b000100  # PERM_E bit

    OUTFORM_WORD0 = _pack_word0_gt(
        gt_type=GT_TYPE_OUTFORM, slot_id=SLOT_ID, dom=1, perm=PERMS
    )
    MINTED_WORD0 = _pack_word0_gt(
        gt_type=GT_TYPE_INFORM, slot_id=SLOT_ID, gt_seq=1, dom=1, perm=PERMS
    )

    # Outform CAP: 96-bit integer (word0 | word1<<32 | word2<<64)
    OUTFORM_CAP = OUTFORM_WORD0 | (0xDEAD_0000 << 32) | (0 << 64)

    _NULL_CR = {"word0_gt": _NULL_GT_DICT, "word1_location": 0, "word2_w2": 0}
    _OUTFORM_CR = {
        "word0_gt":       {"slot_id": SLOT_ID, "gt_seq": 0, "gt_type": GT_TYPE_OUTFORM,
                           "dom": 1, "perm": PERMS, "b_flag": 0},
        "word1_location": 0xDEAD_0000,
        "word2_w2":       0,
    }

    results = {}

    async def testbench(ctx):
        # ── 0. Default inputs ────────────────────────────────────────────────
        ctx.set(dut.boot_start,              0)
        ctx.set(dut.imem_valid,              0)
        ctx.set(dut.imem_data,               0)
        ctx.set(dut.ns_rd_data,              0)
        ctx.set(dut.dbg_cr_wr_en,            0)
        ctx.set(dut.dbg_cr_wr_addr,          0)
        ctx.set(dut.dbg_cr_wr_data,          _NULL_CR)
        ctx.set(dut.dbg_outform_done_inject, 0)
        ctx.set(dut.dbg_outform_result_gt,   0)

        # ── 1. Boot — takes 6 clock edges after boot_start ──────────────────
        # IDLE →(boot_start=1)→ FAULT_RST → LOAD_NS → INIT_THRD →
        # INIT_CLIST → LOAD_NUC → COMPLETE
        ctx.set(dut.boot_start, 1)
        await ctx.tick()   # IDLE → FAULT_RST
        ctx.set(dut.boot_start, 0)
        for _ in range(5):
            await ctx.tick()   # remaining 5 transitions → COMPLETE

        results["boot_complete"] = ctx.get(dut.boot_complete)

        # ── 2. Write Outform GT into CR1 via debug port ──────────────────────
        # Keep imem_valid=0 this cycle to prevent decoding before CR1 is ready.
        ctx.set(dut.dbg_cr_wr_en,   1)
        ctx.set(dut.dbg_cr_wr_addr, SRC_CR)
        ctx.set(dut.dbg_cr_wr_data, _OUTFORM_CR)
        await ctx.tick()   # CR1 written at end of tick
        ctx.set(dut.dbg_cr_wr_en, 0)

        # ── 3. Present CALL instruction → decode fires → ingress fault-closes ──
        # The attacker also holds dbg_outform_done_inject high with a CRC-valid
        # minted GT for the whole window, mimicking a completed network download.
        ctx.set(dut.dbg_outform_done_inject, 1)
        ctx.set(dut.dbg_outform_result_gt,   MINTED_WORD0)
        ctx.set(dut.imem_valid, 1)
        ctx.set(dut.imem_data, CALL_INSTR)

        # Sample every cycle: outform_busy (download engine) must never rise, and
        # the OUTFORM_UNAUTH fault must be raised.
        # CR1 must NEVER be observed holding an Inform GT — the ingress must
        # never promote it.  (A post-fault reboot subsequently clears CR1 to a
        # NULL GT, which is likewise not a promotion; the invariant we assert is
        # "never Inform" across the entire window.)
        busy_ever          = 0
        fault_seen         = 0
        fault_code         = 0
        cr1_ever_inform    = 0
        for _ in range(10):
            if ctx.get(dut.outform_busy):
                busy_ever = 1
            if ctx.get(dut.fault_valid):
                fault_seen = 1
                fault_code = ctx.get(dut.fault)
            cr1_gt_type = (ctx.get(dut.debug_cr_words[SRC_CR][0]) >> 25) & 0x3
            if cr1_gt_type == GT_TYPE_INFORM:
                cr1_ever_inform = 1
            await ctx.tick()

        ctx.set(dut.dbg_outform_done_inject, 0)
        ctx.set(dut.dbg_outform_result_gt,   0)

        results["outform_busy_ever"] = busy_ever
        results["fault_seen"]        = fault_seen
        results["fault_code"]        = fault_code
        results["cr1_ever_inform"]   = cr1_ever_inform

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 4: ChurchCore integration — Mode 2 CALL ingress fault-closed (Task #2862) ===")

    if not results["boot_complete"]:
        print("FAIL: ChurchCore boot did not complete")
        ok = False

    if results["outform_busy_ever"]:
        print("FAIL: outform_busy rose — the network download engine was started!")
        ok = False
    else:
        print("  PASS: outform_busy never rose (no network fetch / alloc / Mint / NS / c-list write)")

    if not results["fault_seen"]:
        print("FAIL: no fault raised — CALL Outform ingress did not fault-close")
        ok = False
    elif results["fault_code"] != int(FaultType.OUTFORM_UNAUTH):
        print(f"FAIL: fault code={results['fault_code']}, expected "
              f"{int(FaultType.OUTFORM_UNAUTH)} (OUTFORM_UNAUTH)")
        ok = False
    else:
        print("  PASS: fault raised with OUTFORM_UNAUTH")

    if results["cr1_ever_inform"]:
        print("FAIL: CR1 promoted to an Inform GT — resident CR state was written!")
        ok = False
    else:
        print("  PASS: CR1 never became an Inform GT (never promoted — no resident state written)")

    if ok:
        print("PASS")
    assert ok, "Test 4 (ChurchCore integration fail-closed) had failures — see above"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_mode2_fail_closed,
        test_mode2_never_promotes,
        test_mode2_no_intercept,
        test_mode2_core_integration,
    ):
        try:
            fn()
        except AssertionError as e:
            failures.append(str(e))

    print()
    if failures:
        print("=== SUMMARY: FAILURES ===")
        for f in failures:
            print(" -", f)
        raise SystemExit(1)
    else:
        print("=== SUMMARY: ALL TESTS PASSED ===")
