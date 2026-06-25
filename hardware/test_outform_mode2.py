"""Unit + integration tests for ChurchOutformFSM — Mode 2 lazy load CALL intercept.

FSM unit tests (Tests 1–3) exercise ChurchOutformFSM in isolation:
  IDLE → TRIGGER_OUTFORM → WAIT_OUTFORM → PROMOTE_WRITE → DONE
  IDLE → TRIGGER_OUTFORM → WAIT_OUTFORM → FAULT → IDLE
  IDLE quiescence (intercept_start=0)

ChurchCore integration test (Test 4) boots a full ChurchCore instance,
writes an Outform GT into a source CR via the debug port, presents a CALL
instruction, and verifies:
  1. NIA is held at CALL_PC during the Mode 2 intercept.
  2. outform_busy rises when the intercept fires.
  3. After dbg_outform_done_inject, the FSM completes and outform_busy drops.
  4. Decode retries the CALL with the promoted Inform GT — no second intercept,
     meaning the callee dispatch path has been entered.

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
# Test 1: FSM success path — intercept → download → GT promotion
# ---------------------------------------------------------------------------

def test_mode2_success():
    """ChurchOutformFSM should intercept the CALL, trigger outform, wait for
    done, then write the promoted Inform GT to the source CR.

    State sequence:
      IDLE  (intercept_start=1) → TRIGGER_OUTFORM
      TRIGGER_OUTFORM           → WAIT_OUTFORM  (outform_start_out=1 for 1 cycle)
      WAIT_OUTFORM (outform_done_in=1) → PROMOTE_WRITE
      PROMOTE_WRITE             → DONE          (cr_wr_en=1, promoted GT written)
      DONE                      → IDLE          (done=1)
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
        # After tick: FSM = TRIGGER_OUTFORM; src context latched.
        ctx.set(dut.intercept_start, 0)

        results["busy_trigger"] = ctx.get(dut.busy)
        results["start_out"]    = ctx.get(dut.outform_start_out)
        results["gt_raw_out"]   = ctx.get(dut.outform_gt_raw_out)
        results["slot_id_out"]  = ctx.get(dut.outform_slot_id_out)

        await ctx.tick()
        # After tick: FSM = WAIT_OUTFORM.
        results["busy_wait"] = ctx.get(dut.busy)

        # ── WAIT_OUTFORM: assert outform_done_in ─────────────────────────────
        ctx.set(dut.outform_done_in, 1)
        ctx.set(dut.result_gt_in,    MINTED_WORD0)
        await ctx.tick()
        # After tick: FSM = PROMOTE_WRITE.
        ctx.set(dut.outform_done_in, 0)

        results["cr_wr_en"]   = ctx.get(dut.cr_wr_en)
        results["cr_wr_addr"] = ctx.get(dut.cr_wr_addr)
        results["busy_promo"] = ctx.get(dut.busy)
        # Read promoted cap as raw integer via .as_value()
        results["cr_wr_data_raw"] = ctx.get(dut.cr_wr_data.as_value())

        await ctx.tick()
        # After tick: FSM = DONE.
        results["done_pulse"] = ctx.get(dut.done)
        results["fault_none"] = ctx.get(dut.fault)

        await ctx.tick()
        # After tick: FSM = IDLE.
        results["busy_after"] = ctx.get(dut.busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("=== Test 1: Mode 2 FSM success path ===")

    # TRIGGER_OUTFORM: busy=1 + outform_start_out=1 + correct GT raw/slot
    if not results["busy_trigger"]:
        print("FAIL: busy not asserted in TRIGGER_OUTFORM")
        ok = False
    if not results["start_out"]:
        print("FAIL: outform_start_out not asserted in TRIGGER_OUTFORM")
        ok = False
    if results["gt_raw_out"] != OUTFORM_WORD0:
        print(f"FAIL: gt_raw_out={results['gt_raw_out']:#010x}, expected {OUTFORM_WORD0:#010x}")
        ok = False
    if results["slot_id_out"] != OUTFORM_SLOT_ID:
        print(f"FAIL: slot_id_out={results['slot_id_out']}, expected {OUTFORM_SLOT_ID}")
        ok = False

    # WAIT_OUTFORM: busy=1
    if not results["busy_wait"]:
        print("FAIL: busy not asserted in WAIT_OUTFORM")
        ok = False

    # PROMOTE_WRITE: cr_wr_en=1, cr_wr_addr=src_cr, busy=1
    if not results["cr_wr_en"]:
        print("FAIL: cr_wr_en not asserted in PROMOTE_WRITE")
        ok = False
    if results["cr_wr_addr"] != SRC_CR_ADDR:
        print(f"FAIL: cr_wr_addr={results['cr_wr_addr']}, expected {SRC_CR_ADDR}")
        ok = False
    if not results["busy_promo"]:
        print("FAIL: busy not asserted in PROMOTE_WRITE")
        ok = False

    # Verify promoted GT fields inside cr_wr_data
    cr_wr_val = results["cr_wr_data_raw"]
    prom_word0    = cr_wr_val & 0xFFFFFFFF
    prom_gt_type  = (prom_word0 >> 25) & 0x3   # gt_type at [26:25] ★v2.0
    prom_slot_id  = prom_word0 & 0xFFFF
    prom_gt_seq   = (prom_word0 >> 16) & 0x1FF  # gt_seq 9b at [24:16] ★v2.0
    # v2.0 GT layout: gt_seq[24:16], gt_type[26:25], dom[27], perm[30:28]
    prom_dom      = (prom_word0 >> 27) & 0x1
    prom_perm     = (prom_word0 >> 28) & 0x7
    prom_b_flag   = (prom_word0 >> 31) & 0x1
    prom_word1    = (cr_wr_val >> 32) & 0xFFFFFFFF
    prom_word2    = (cr_wr_val >> 64) & 0xFFFFFFFF

    if prom_gt_type != GT_TYPE_INFORM:
        print(f"FAIL: promoted gt_type={prom_gt_type:#04b}, expected Inform ({GT_TYPE_INFORM:#04b})")
        ok = False
    if prom_slot_id != OUTFORM_SLOT_ID:
        print(f"FAIL: promoted slot_id={prom_slot_id}, expected {OUTFORM_SLOT_ID}")
        ok = False
    if prom_gt_seq != MINTED_SEQ:
        print(f"FAIL: promoted gt_seq={prom_gt_seq}, expected {MINTED_SEQ}")
        ok = False
    if prom_dom != 1 or prom_perm != OUTFORM_PERMS:
        print(f"FAIL: promoted dom={prom_dom}, perm={prom_perm:#05b}, expected dom=1, perm={OUTFORM_PERMS:#05b}")
        ok = False
    if prom_b_flag != OUTFORM_B_FLAG:
        print(f"FAIL: promoted b_flag={prom_b_flag}, expected {OUTFORM_B_FLAG}")
        ok = False
    if prom_word1 != OUTFORM_LOCATION:
        print(f"FAIL: promoted word1_location={prom_word1:#010x}, expected {OUTFORM_LOCATION:#010x}")
        ok = False
    if prom_word2 != OUTFORM_W2:
        print(f"FAIL: promoted word2_w2={prom_word2:#010x}, expected {OUTFORM_W2:#010x}")
        ok = False

    # DONE: done=1, fault=0
    if not results["done_pulse"]:
        print("FAIL: done not asserted in DONE state")
        ok = False
    if results["fault_none"]:
        print("FAIL: fault spuriously asserted in DONE state")
        ok = False

    # IDLE: busy=0
    if results["busy_after"]:
        print("FAIL: FSM still busy after DONE — machine wedged!")
        ok = False

    if ok:
        print("PASS")
    assert ok, "Test 1 (Mode 2 success path) had failures — see output above"


# ---------------------------------------------------------------------------
# Test 2: FSM fault path — outform fault during WAIT_OUTFORM
# ---------------------------------------------------------------------------

def test_mode2_fault():
    """When outform_fault_in fires in WAIT_OUTFORM, the FSM should:
    1. Transition to FAULT and assert fault=1 / fault_type = the given code.
    2. Return to IDLE (busy=0) — no permanent wedge.
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
        # FSM = TRIGGER_OUTFORM

        await ctx.tick()
        # FSM = WAIT_OUTFORM

        ctx.set(dut.outform_fault_in,      1)
        ctx.set(dut.outform_fault_type_in, int(FaultType.OUTFORM_MINT))
        await ctx.tick()
        ctx.set(dut.outform_fault_in,      0)
        ctx.set(dut.outform_fault_type_in, 0)
        # FSM = FAULT

        results["fault"]      = ctx.get(dut.fault)
        results["fault_type"] = ctx.get(dut.fault_type)
        results["done_none"]  = ctx.get(dut.done)

        await ctx.tick()
        # FSM = IDLE
        results["busy_after"] = ctx.get(dut.busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 2: Mode 2 FSM fault path ===")

    if not results["fault"]:
        print("FAIL: fault not asserted in FAULT state")
        ok = False
    if results["fault_type"] != int(FaultType.OUTFORM_MINT):
        print(
            f"FAIL: fault_type={results['fault_type']}, "
            f"expected {int(FaultType.OUTFORM_MINT)} (OUTFORM_MINT)"
        )
        ok = False
    if results["done_none"]:
        print("FAIL: done spuriously asserted in FAULT state")
        ok = False
    if results["busy_after"]:
        print("FAIL: FSM still busy after FAULT — machine wedged!")
        ok = False

    if ok:
        print("PASS")
    assert ok, "Test 2 (Mode 2 fault path) had failures — see output above"


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
    """ChurchCore integration: CALL with Outform GT source triggers Mode 2 intercept.

    Boots a full ChurchCore (iot_profile=True), writes an Outform GT into CR1
    via the debug port, feeds a CALL CR1→CR0 instruction, then injects a
    simulated download-complete via dbg_outform_done_inject.

    Assertions:
      1. NIA is held at CALL_PC (0) during the intercept — not advanced to +4.
      2. outform_busy=1 when the intercept fires.
      3. outform_busy drops to 0 after done injection + GT promotion.
      4. No second Mode 2 intercept fires after promotion (CR1 now Inform GT).
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

        # ── 3. Present CALL instruction → decode fires → intercept triggers ──
        ctx.set(dut.imem_valid, 1)
        ctx.set(dut.imem_data, CALL_INSTR)
        await ctx.tick()
        # After this tick: intercept_start fired, FSM→TRIGGER_OUTFORM.
        # NIA advance was blocked by ~intercept_start, so nia_reg is still 0.
        # outform_fsm_busy is combinatorial from the TRIGGER_OUTFORM state.
        results["nia_held"]  = ctx.get(dut.nia)
        results["busy_rise"] = ctx.get(dut.outform_fsm_busy)

        # ── 4. TRIGGER_OUTFORM cycle — FSM→WAIT_OUTFORM; outform_mode2_active=1 ──
        await ctx.tick()

        # ── 5. Inject outform done — keep result_gt valid through PROMOTE_WRITE
        # (result_gt_in is read combinatorially in PROMOTE_WRITE; hold the inject
        # for 2 cycles: WAIT_OUTFORM + PROMOTE_WRITE)
        ctx.set(dut.dbg_outform_done_inject, 1)
        ctx.set(dut.dbg_outform_result_gt,   MINTED_WORD0)
        await ctx.tick()   # WAIT_OUTFORM → PROMOTE_WRITE
        await ctx.tick()   # PROMOTE_WRITE → DONE  (CR1 written with Inform GT)
        ctx.set(dut.dbg_outform_done_inject, 0)
        ctx.set(dut.dbg_outform_result_gt,   0)
        await ctx.tick()   # DONE → IDLE (outform_fsm_busy drops to 0)

        results["busy_drop"] = ctx.get(dut.outform_fsm_busy)

        # ── 6. CALL replayed with Inform GT — no second Mode 2 intercept ─────
        # Run 4 more cycles; outform_fsm_busy must remain 0 (Inform GT does not
        # trigger Mode 2 — callee dispatch path entered).
        for _ in range(4):
            await ctx.tick()

        results["no_second_intercept"] = ctx.get(dut.outform_fsm_busy)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    ok = True
    print("\n=== Test 4: ChurchCore integration — Mode 2 NIA hold + callee dispatch ===")

    if not results["boot_complete"]:
        print("FAIL: ChurchCore boot did not complete")
        ok = False

    if results["nia_held"] != CALL_PC:
        print(
            f"FAIL: NIA advanced during Mode 2 intercept "
            f"(got {results['nia_held']:#010x}, expected {CALL_PC:#010x})"
        )
        ok = False
    else:
        print(f"  PASS: NIA held at CALL_PC={CALL_PC:#010x} during intercept")

    if not results["busy_rise"]:
        print("FAIL: outform_fsm_busy did not rise when Mode 2 intercept fired")
        ok = False
    else:
        print("  PASS: outform_fsm_busy=1 when intercept fires (FSM in TRIGGER_OUTFORM)")

    if results["busy_drop"]:
        print("FAIL: outform_fsm_busy still high after FSM completion + GT promotion")
        ok = False
    else:
        print("  PASS: outform_fsm_busy=0 after done injection + GT promotion (FSM IDLE)")

    if results["no_second_intercept"]:
        print("FAIL: second Mode 2 intercept fired — CR1 not promoted to Inform?")
        ok = False
    else:
        print("  PASS: no second intercept after promotion (Inform GT in CR1 — callee dispatch entered)")

    if ok:
        print("PASS")
    assert ok, "Test 4 (ChurchCore integration) had failures — see above"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_mode2_success,
        test_mode2_fault,
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
