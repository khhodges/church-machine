"""Hardware simulation test for the boot sequence CR12 initialisation.

Boots a full ChurchCore instance and verifies that the boot state machine

    IDLE → FAULT_RST → LOAD_NS → INIT_THRD → INIT_CLIST → LOAD_NUC → COMPLETE

correctly writes a valid Inform-type Golden Token to CR12 (thread stack
capability) and leaves CR8 as NULL after boot_complete goes high.

This follows the same integration-test pattern as test_outform_mode2.py Test 4:
a real ChurchCore is instantiated, boot is driven end-to-end, and the
hardware register file state (dbg_cr12_gt / dbg_cr8_gt) is read back via the
debug observability ports added to core.py.

Coverage:
    Test 1  — pure-Python formula: expected CR12 GT word from hw_types.make_gt
    Test 2  — ChurchCore simulation: boot_complete rises; CR12 = Inform GT with slot_id=1
    Test 3  — ChurchCore simulation: CR8 stays NULL after boot (wrong-target regression)
    Test 4  — ChurchWukongXC7A100T simulation: hw_init FSM completes; boot_triggered
              latches within 17 + N_INIT cycles (observable via led[1] transition)

Reference: hardware/core.py INIT_THRD case

Run with:  python -m hardware.test_boot_sequence
"""

import sys
from amaranth.sim import Simulator

from .hw_types import GT_TYPE_INFORM, make_gt
from .layouts import CAP_REG_LAYOUT


# ---------------------------------------------------------------------------
# Expected constant — single source so tests and the formula check agree
# ---------------------------------------------------------------------------

# CR12 Golden Token written by INIT_THRD:
#   gt_type = GT_TYPE_INFORM (0b01), slot_id = 1, gt_seq = 0,
#   dom = 0 (Turing, M-only transient), perm = 0, b_flag = 0.
#
# Bit layout (GT_LAYOUT v2.0):
#   [15:0]  slot_id = 1    → 0x0001
#   [24:16] gt_seq  = 0
#   [26:25] gt_type = 0b01 → (1 << 25) = 0x02000000
#   [27]    dom     = 0
#   [30:28] perm    = 0
#   [31]    b_flag  = 0
EXPECTED_CR12_GT = make_gt(gt_type=GT_TYPE_INFORM, perms=0, slot_id=1, gt_seq=0)

# Number of clock ticks to reach COMPLETE after pulsing boot_start:
#   tick 1: IDLE     → FAULT_RST   (boot_start=1 this cycle)
#   tick 2: FAULT_RST → LOAD_NS
#   tick 3: LOAD_NS  → INIT_THRD
#   tick 4: INIT_THRD → INIT_CLIST  (CR12 latched here)
#   tick 5: INIT_CLIST → LOAD_NUC
#   tick 6: LOAD_NUC → COMPLETE     (boot_complete=1 after this)
TICKS_TO_COMPLETE = 6


def _default_inputs(ctx, dut):
    """Set all ChurchCore inputs to safe defaults before boot."""
    ctx.set(dut.boot_start,              0)
    ctx.set(dut.imem_valid,              0)
    ctx.set(dut.imem_data,               0)
    ctx.set(dut.ns_rd_data,              0)
    ctx.set(dut.dbg_cr_wr_en,            0)
    ctx.set(dut.dbg_cr_wr_addr,          0)
    ctx.set(dut.dbg_outform_done_inject, 0)
    ctx.set(dut.dbg_outform_result_gt,   0)


# ---------------------------------------------------------------------------
# Test 1: pure-Python formula — GT word encoding (no simulation required)
# ---------------------------------------------------------------------------

def test_boot_gt_formula():
    """Formula: make_gt produces the correct bit pattern for the INIT_THRD GT."""
    print("=== Test 1: INIT_THRD GT word formula ===")

    word     = EXPECTED_CR12_GT
    gt_type  = (word >> 25) & 0x3
    slot_id  = word & 0xFFFF
    gt_seq   = (word >> 16) & 0x1FF
    upper    = (word >> 27) & 0x1F   # dom[27] | perm[30:28] | b_flag[31]

    assert gt_type == GT_TYPE_INFORM, (
        f"gt_type mismatch: expected {GT_TYPE_INFORM} (INFORM), got {gt_type}"
    )
    assert slot_id == 1, (
        f"slot_id mismatch: expected 1, got {slot_id}"
    )
    assert gt_seq == 0, f"gt_seq mismatch: expected 0, got {gt_seq}"
    assert upper == 0, f"dom/perm/b_flag must be 0; bits[31:27]={upper:#07b}"

    print(f"  CR12 GT word = {word:#010x}  (INFORM, slot=1, seq=0, dom=0, perm=0)")
    print("PASS")


# ---------------------------------------------------------------------------
# Test 2: ChurchCore integration — boot_complete rises; CR12 = Inform GT
# ---------------------------------------------------------------------------

def test_boot_cr12_init():
    """ChurchCore simulation: CR12 holds Inform GT with slot_id=1 after boot."""
    from .core import ChurchCore
    dut     = ChurchCore(iot_profile=True)
    results = {}

    async def testbench(ctx):
        _default_inputs(ctx, dut)
        await ctx.tick()

        # Drive boot_start for one cycle while in IDLE
        ctx.set(dut.boot_start, 1)
        await ctx.tick()                            # tick 1: IDLE → FAULT_RST
        ctx.set(dut.boot_start, 0)
        for _ in range(TICKS_TO_COMPLETE - 1):
            await ctx.tick()                        # ticks 2-6: → COMPLETE

        results["boot_complete"] = ctx.get(dut.boot_complete)
        results["boot_state"]    = ctx.get(dut.boot_state)
        results["cr12_gt"]       = ctx.get(dut.dbg_cr12_gt)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    print("\n=== Test 2: ChurchCore boot — CR12 Inform GT ===")

    boot_done = results["boot_complete"]
    cr12_val  = results["cr12_gt"]
    cr12_gt_type = (cr12_val >> 25) & 0x3
    cr12_slot_id = cr12_val & 0xFFFF

    if not boot_done:
        assert False, (
            f"boot_complete not high after {TICKS_TO_COMPLETE} ticks "
            f"(boot_state={results['boot_state']})"
        )
    if cr12_gt_type != GT_TYPE_INFORM:
        assert False, (
            f"CR12 gt_type = {cr12_gt_type} (expected {GT_TYPE_INFORM} = INFORM); "
            f"dbg_cr12_gt = {cr12_val:#010x}"
        )
    if cr12_slot_id != 1:
        assert False, (
            f"CR12 slot_id = {cr12_slot_id} (expected 1); "
            f"dbg_cr12_gt = {cr12_val:#010x}"
        )
    if cr12_val != EXPECTED_CR12_GT:
        assert False, (
            f"CR12 full word mismatch: got {cr12_val:#010x}, "
            f"expected {EXPECTED_CR12_GT:#010x}"
        )

    print(f"  boot_complete = {boot_done}")
    print(f"  dbg_cr12_gt   = {cr12_val:#010x}  (gt_type=INFORM, slot_id={cr12_slot_id})")
    print("PASS")


# ---------------------------------------------------------------------------
# Test 3: ChurchCore integration — CR8 remains NULL after boot
# ---------------------------------------------------------------------------

def test_boot_cr8_null():
    """ChurchCore simulation: CR8 word0 is 0 (NULL GT) after boot.

    CR8 is never written by the boot FSM.  A non-zero value here would mean
    a SWITCH or CHANGE path accidentally targeted the wrong register during boot.
    """
    from .core import ChurchCore
    dut     = ChurchCore(iot_profile=True)
    results = {}

    async def testbench(ctx):
        _default_inputs(ctx, dut)
        await ctx.tick()

        ctx.set(dut.boot_start, 1)
        await ctx.tick()                            # tick 1: IDLE → FAULT_RST
        ctx.set(dut.boot_start, 0)
        for _ in range(TICKS_TO_COMPLETE - 1):
            await ctx.tick()                        # ticks 2-6: → COMPLETE

        results["boot_complete"] = ctx.get(dut.boot_complete)
        results["cr8_gt"]        = ctx.get(dut.dbg_cr8_gt)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    print("\n=== Test 3: ChurchCore boot — CR8 remains NULL ===")

    boot_done = results["boot_complete"]
    cr8_val   = results["cr8_gt"]

    if not boot_done:
        assert False, "boot_complete not high — cannot validate CR8 post-boot state"
    if cr8_val != 0:
        cr8_gt_type = (cr8_val >> 25) & 0x3
        assert False, (
            f"CR8 must be NULL (0x00000000) after boot; "
            f"got {cr8_val:#010x} (gt_type={cr8_gt_type})"
        )

    print(f"  boot_complete = {boot_done}")
    print(f"  dbg_cr8_gt    = {cr8_val:#010x}  (NULL GT — correct)")
    print("PASS")


# ---------------------------------------------------------------------------
# Test 4: ChurchWukongXC7A100T — hw_init FSM completes; boot_triggered latches
# ---------------------------------------------------------------------------

def test_wukong_boot_triggered():
    """ChurchWukongXC7A100T simulation: boot_triggered latches within expected cycles.

    The Wukong boot FSM has three phases:
      Phase 1: 16 cycles  (boot_delay counts to 0xF)
      Phase 2: N_INIT cycles  (one DMEM write per cycle via init LUTRAM)
      Phase 3: 1 cycle    (boot_start pulse + boot_triggered latch)
    Total: 17 + N_INIT cycles from GSR.

    Observable without an internal debug port: led[1].
      Before boot_triggered: led[1] = hb_blink (starts at 0, toggling every
        50 M cycles — stays 0 for the entire short simulation window).
      After boot_triggered:  led[1] = ~fault_latched = ~0 = 1 (HIGH = LED OFF).
    So led[1] 0→1 transition within the expected window confirms the FSM latched.
    """
    from .wukong_top import ChurchWukongXC7A100T
    from .boot_rom import WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST

    # sim_mode=True: skips port-driven comb clock so sim.add_clock() can drive
    # ClockSignal("sync") directly (no DriverConflict with self.clk port).
    dut = ChurchWukongXC7A100T(sim_mode=True)
    results = {}

    # Mirror the hw_init_pairs computation from elaborate() to get N_INIT.
    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)
    hw_init_pairs = [(addr, val) for addr, val in enumerate(dmem_init) if val != 0]
    N_INIT = len(hw_init_pairs)

    # Phase1=16 + Phase2=N_INIT + Phase3=1 = 17+N_INIT; allow +4 margin.
    expected_cycle = 17 + N_INIT
    max_cycles     = expected_cycle + 4

    async def testbench(ctx):
        boot_cycle = -1
        for i in range(max_cycles):
            led1 = ctx.get(dut.led[1])
            if led1 == 1:
                boot_cycle = i
                break
            await ctx.tick("sync")
        results["boot_cycle"] = boot_cycle

    sim = Simulator(dut)
    sim.add_clock(1e-6, domain="sync")
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    print("\n=== Test 4: ChurchWukongXC7A100T — boot_triggered latches ===")
    print(f"  N_INIT         = {N_INIT} non-zero DMEM words")
    print(f"  Expected cycle = {expected_cycle}  (16 + {N_INIT} + 1)")
    print(f"  Max allowed    = {max_cycles}")

    boot_cycle = results["boot_cycle"]
    if boot_cycle < 0:
        assert False, (
            f"boot_triggered never latched: led[1] stayed 0 for all "
            f"{max_cycles} cycles — hw_init FSM stalled (N_INIT={N_INIT})"
        )
    if boot_cycle > expected_cycle + 4:
        assert False, (
            f"boot_triggered latched too late: cycle {boot_cycle} > "
            f"{expected_cycle + 4} (expected {expected_cycle})"
        )

    print(f"  boot_triggered latched at cycle {boot_cycle}  ✓")
    print("PASS")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    failures = []
    for fn in (
        test_boot_gt_formula,
        test_boot_cr12_init,
        test_boot_cr8_null,
        test_wukong_boot_triggered,
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
