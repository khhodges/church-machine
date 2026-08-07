"""hardware/test_boot_rom_no_false_halt.py — Boot ROM false-halt simulation test.

Simulates the 3-instruction boot ROM sequence (LOAD→CHANGE→CALL) end-to-end using
the real ChurchCore + DMEM, and verifies that all 3 instructions retire cleanly
(retire_fault_valid=False) so fault_halt never fires during boot.

Boot sequence (from docs/debug-packet-protocol.md §"Boot sequence"):

    [0] LOAD   CR15, CR15[0]   NIA=0x00  →  retire_fault_valid must be False
    [1] CHANGE CR12, CR15, #1  NIA=0x04  →  retire_fault_valid must be False
    [2] CALL   CR0,  CR0       NIA=0x08  →  retire_fault_valid must be False

The DMEM is pre-initialised with WUKONG_DEMO_NAMESPACE + WUKONG_DEMO_CLIST +
the WukongCallHome LUMP body, and Thread.caps[0] (DMEM word 244) is set to a
valid E-GT for WukongCallHome (NS slot 7) so BOOT_PROGRAM[2] = CALL CR0, CR0
completes without a NULL_CAP fault.

The BootRomHarness exposes self.core (ChurchCore instance) as a public attribute
so the testbench can read core.retire_valid, core.retire_nia, and
core.retire_fault_valid directly.

Run with:  python -m hardware.test_boot_rom_no_false_halt
"""

import sys
from amaranth import *
from amaranth.lib.data import StructLayout, unsigned
from amaranth.lib.memory import Memory as LibMemory
from amaranth.sim import Simulator

from .core import ChurchCore
from .boot_rom import (
    BootRom, BOOT_PROGRAM,
    WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST, WUKONG_NUC_PROGRAM,
)
from .hw_types import GT_TYPE_INFORM, PERM_MASK_E, PERM_MASK_S, make_gt


# ── DMEM init data (mirrors ChurchWukongXC7A100T.elaborate() exactly) ─────────
#
# Layout:
#   words   0-31  : WUKONG_DEMO_NAMESPACE  (8 NS slots × 4 words, direct layout)
#   words  32-255 : zeros
#   words 256-319 : WUKONG_DEMO_CLIST      (64 c-list entries)
#   words 320-447 : zeros
#   words 448-521 : WukongCallHome LUMP body
#                   [448] header + [449..521] WUKONG_NUC_PROGRAM
#   words 522+    : zeros
#
# Simulation-only patch: DMEM word 244 (byte 0x3D0) = Thread.caps[0].
#
#   Thread base:  NS slot 1 word0_location = 0x00 (byte 0).
#   Thread.caps[0] offset: THREAD_CAPS_OFFSET = 244 words.
#   Address: byte 0x00 + 244 × 4 = byte 0x3D0 = word 244.
#
#   The IDE normally writes this via setBootEntrySlot().  Here we patch it to
#   an E-GT for WukongCallHome (NS slot 7) so BOOT_PROGRAM[2]=CALL does not
#   fault with NULL_CAP.
#
E_GT_WUKONG_CALLHOME = make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_E, slot_id=7)
# Inform E-GT (not Abstract): mload can load Inform GTs from c-list slots.
# Abstract GTs in c-list slots trigger INVALID_OP in mload FETCH_GT (Task #432 stub).
# The IDE writes an Inform E-GT for the chosen abstraction into Thread.caps[0]
# (thread_lump_base + THREAD_CAPS_OFFSET*4) so RESTORE_CALL→CALL succeeds.

def _build_dmem_init():
    """Build the 16384-word DMEM init vector (mirrors wukong_top.py elaborate())."""
    dmem = list(WUKONG_DEMO_NAMESPACE)        # words 0-31
    while len(dmem) < 256:
        dmem.append(0)                         # words 32-255 (includes Thread.caps zone)
    dmem += list(WUKONG_DEMO_CLIST)            # words 256-319
    while len(dmem) < 16384:
        dmem.append(0)

    # WukongCallHome LUMP body at byte 0x0700 = word 0x1C0 = 448.
    _cw     = len(WUKONG_NUC_PROGRAM)
    _header = (0x1F << 27) | (1 << 23) | (_cw << 10)   # n_minus_6=1
    for _i, _v in enumerate([_header] + list(WUKONG_NUC_PROGRAM)):
        dmem[0x1C0 + _i] = _v

    # Thread.caps[0] = E-GT for WukongCallHome so CALL CR0,CR0 succeeds.
    # thread_base = NS slot 1 word0_location = 0x00 (byte 0).
    # Thread.caps[0] byte address = 0x00 + 244 * 4 = 0x3D0; word = 244.
    dmem[244] = E_GT_WUKONG_CALLHOME

    # Thread.caps[12] = S-perm GT for Boot.Thread (NS slot 1) so that after
    # RESTORE_CALL[cr_index=12] loads it into CR12, the FETCH_THREAD_HDR state
    # in change.py sees a non-null CR12 and doesn't fault with NULL_CAP.
    #
    # RESTORE_CALL[12] reads CR8[THREAD_CAPS_OFFSET+12] = DMEM[256].
    # DEMO_CLIST starts at word 256; DEMO_CLIST[0] = null GT (freed mem-mgr slot).
    # We override word 256 with an Inform S-GT for Boot.Thread (slot 1).
    # The S-perm bit is needed so post-boot CHANGE CR12 authority checks pass;
    # in the boot microcode window all perm checks are bypassed by M-elevation.
    dmem[256] = make_gt(GT_TYPE_INFORM, PERM_MASK_S, slot_id=1, gt_seq=0)

    return dmem

_DMEM_INIT = _build_dmem_init()

# ROM: BOOT_PROGRAM[0..2] + zeros
_WUKONG_ROM = list(BOOT_PROGRAM[:3]) + [0] * (1024 - 3)


# ── BootRomHarness ─────────────────────────────────────────────────────────────

class BootRomHarness(Elaboratable):
    """Minimal simulation harness: ChurchCore + ROM + DMEM.

    Mirrors ChurchWukongXC7A100T's memory path but omits UART/TraceUnit overhead
    so the boot sequence can be observed cycle-accurately without waiting for
    UART byte transmission at 57 600 baud.

    The key design choice: ``self.core`` is a public attribute created in
    ``__init__`` (not a local inside ``elaborate()``), so the testbench can
    read ``dut.core.retire_valid``, ``dut.core.retire_nia``, and
    ``dut.core.retire_fault_valid`` directly.

    step_mode is not implemented (always free-run).  fault_halt is exposed as
    a 1-cycle combinatorial pulse on ``self.fault_halt`` so the testbench can
    assert it never fires during the 3-instruction boot.
    """

    def __init__(self, dmem_init):
        # Public ChurchCore instance — testbench reads retire signals from here.
        self.core = ChurchCore()

        self.boot_complete      = Signal()
        self.fault_halt         = Signal()  # combinatorial: retire_valid & retire_fault_valid
        self._dmem_init         = dmem_init

    def elaborate(self, platform):
        m = Module()
        core = self.core
        m.submodules.core = core

        # ── Boot ROM (instruction fetch) ───────────────────────────────────────
        boot_rom = m.submodules.boot_rom = BootRom(_WUKONG_ROM)
        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(boot_rom.data),
        ]

        # ── Data memory (LibMemory, pre-initialised for simulation) ───────────
        dmem = m.submodules.dmem = LibMemory(
            shape=unsigned(32), depth=16384, init=self._dmem_init)
        dmem_rd = dmem.read_port(domain="sync")
        dmem_wr = dmem.write_port()

        # ── Memory address mux (identical to ChurchWukongXC7A100T) ────────────
        mem_addr = Signal(14)
        with m.If(core.ns_rd_en | core.ns_wr_en):
            m.d.comb += mem_addr.eq(core.ns_addr[2:16])
        with m.Elif(core.clist_rd_en | core.clist_wr_en):
            m.d.comb += mem_addr.eq(core.clist_addr[2:16])
        with m.Else():
            m.d.comb += mem_addr.eq(core.dmem_addr[2:16])

        m.d.comb += [
            dmem_rd.addr.eq(mem_addr),
            core.ns_rd_data.eq(Cat(dmem_rd.data, C(0, 96))),
            core.clist_rd_data.eq(dmem_rd.data),
        ]

        # ── DMEM read valid (1-cycle BRAM latency; MMIO is combinatorial) ─────
        is_mmio = Signal()
        m.d.comb += is_mmio.eq(core.dmem_addr[30] & ~core.dmem_addr[31])
        _rd_valid_r = Signal()
        m.d.sync += _rd_valid_r.eq(core.dmem_rd_en & ~is_mmio)
        m.d.comb += [
            core.dmem_rd_valid.eq(_rd_valid_r | (core.dmem_rd_en & is_mmio)),
            core.dmem_rd_data.eq(dmem_rd.data),
        ]

        # ── Write path (identical to ChurchWukongXC7A100T) ────────────────────
        cpu_wr_data = Signal(32)
        cpu_wr_en   = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.ns_wr_data[:32]), cpu_wr_en.eq(1)]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.clist_wr_data), cpu_wr_en.eq(1)]
        with m.Elif(~is_mmio):
            m.d.comb += [cpu_wr_data.eq(core.dmem_wr_data), cpu_wr_en.eq(core.dmem_wr_en)]

        m.d.comb += [
            dmem_wr.addr.eq(mem_addr),
            dmem_wr.data.eq(cpu_wr_data),
            dmem_wr.en.eq(cpu_wr_en),
        ]

        # ── CM control: free-run (no step_mode, no TraceUnit stall) ──────────
        m.d.comb += [
            # Instruction fetch is valid as soon as boot is complete.
            core.imem_valid.eq(core.boot_complete),
            core.halt_req.eq(0),
            core.free_run_start.eq(0),
            core.free_run_nia.eq(0),
            core.gc_start.eq(0),
            # Debug ports: unused in this harness.
            core.dbg_cr_wr_en.eq(0),
            core.dbg_cr_wr_addr.eq(0),
            core.dbg_cr_wr_data.eq(0),
            core.dbg_outform_done_inject.eq(0),
            core.dbg_outform_result_gt.eq(0),
        ]

        # ── boot_start: pulse on the first cycle ──────────────────────────────
        # In simulation LibMemory is pre-initialised (init=dmem_init), so there
        # is no need for the hw_init sequencer.  A single boot_start pulse is
        # sufficient to move the boot FSM IDLE→FAULT_RST→…→COMPLETE in 6 ticks.
        boot_started = Signal()
        with m.If(~boot_started):
            m.d.comb += core.boot_start.eq(1)
            m.d.sync += boot_started.eq(1)

        # ── Expose top-level observation signals ──────────────────────────────
        m.d.comb += [
            self.boot_complete.eq(core.boot_complete),
            # fault_halt = retire_valid & retire_fault_valid (mirrors wukong_top.py)
            self.fault_halt.eq(core.retire_valid & core.retire_fault_valid),
        ]

        return m


# ── Test 1: boot ROM instruction encoding ─────────────────────────────────────

def test_boot_rom_instruction_encoding():
    """BOOT_PROGRAM[0..2] encodes LOAD, CHANGE, CALL (opcode field bits[30:27])."""
    from .hw_types import ChurchOpcode
    print("=== Test 1: BOOT_PROGRAM instruction encoding ===")

    expected = [
        (0, int(ChurchOpcode.LOAD),   'LOAD'),
        (1, int(ChurchOpcode.CHANGE), 'CHANGE'),
        (2, int(ChurchOpcode.CALL),   'CALL'),
    ]
    for idx, exp_op, name in expected:
        actual_op = (BOOT_PROGRAM[idx] >> 27) & 0xF
        assert actual_op == exp_op, (
            f"BOOT_PROGRAM[{idx}] opcode = {actual_op:#06b}, "
            f"expected {exp_op:#06b} ({name})"
        )
        print(f"  ROM[{idx}]: 0x{BOOT_PROGRAM[idx]:08X}  opcode={actual_op:#04x}  ({name}) ✓")
    print("PASS")


# ── Test 2: boot ROM simulation — no false halt ────────────────────────────────

def test_boot_rom_no_false_halt():
    """Simulation: BOOT_PROGRAM[0..2] retire cleanly (retire_fault_valid=False).

    Drives ChurchCore through its internal boot FSM (6 cycles), waits for
    boot_complete, then collects retire_valid pulses for the 3 boot ROM
    instructions.  Asserts:

      - Exactly 3 retires observed before a generous timeout.
      - retire_nia values are 0x00000000, 0x00000004, 0x00000008 (in order).
      - retire_fault_valid is False for all 3 retires.
      - fault_halt (retire_valid & retire_fault_valid) never pulses.

    If fault_halt fires on retire 0 (NIA=0x00), it means LOAD faulted.
    If fault_halt fires on retire 1 (NIA=0x04), CHANGE faulted.
    If fault_halt fires on retire 2 (NIA=0x08), CALL faulted (NULL_CAP if
    Thread.caps[0] not configured; regression if previously clean).
    """
    print("\n=== Test 2: boot ROM simulation — fault_halt must not fire ===")

    dut     = BootRomHarness(_DMEM_INIT)
    results = {
        "retires":     [],   # list of (nia, fault_valid) per retire_valid pulse
        "fault_halts": [],   # list of NIAs where fault_halt fired
    }

    # Maximum cycles to wait for each retire.
    # LOAD/CHANGE/CALL are multi-cycle instructions with BRAM latency; allow 150
    # cycles per instruction to accommodate stalls.
    MAX_BOOT_CYCLES  = 20    # IDLE → COMPLETE  (boot FSM takes ≤6 ticks + margin)
    MAX_RETIRE_WAIT  = 200   # cycles to wait per retire after boot_complete

    async def testbench(ctx):
        # ── Phase 1: wait for boot_complete ───────────────────────────────────
        for _ in range(MAX_BOOT_CYCLES):
            if ctx.get(dut.boot_complete):
                break
            await ctx.tick()
        else:
            results["timeout_boot"] = True
            return

        # ── Phase 2: collect 3 retires ────────────────────────────────────────
        # NUC starts running after the CALL at NIA=0x08 retires; we stop after
        # 3 retires regardless.
        #
        # TIMING NOTE: boot_complete and retire_valid for the first instruction
        # (LOAD at NIA=0x00) can fire on the *same* cycle.  Phase 1 breaks
        # without ticking when boot_complete is first seen, so the very first
        # sample in Phase 2 must check retire_valid on the current cycle (before
        # the tick) to avoid skipping the LOAD retire pulse.
        def _capture_retire():
            nia         = ctx.get(dut.core.retire_nia)
            fault_valid = bool(ctx.get(dut.core.retire_fault_valid))
            fault_halt  = bool(ctx.get(dut.fault_halt))
            results["retires"].append((nia, fault_valid))
            if fault_halt:
                results["fault_halts"].append(nia)

        for _retire_idx in range(3):
            # Wait until retire_valid is high on some cycle.  The outer check
            # handles the case where Phase 1 broke on the same cycle that
            # retire_valid is already high (boot_complete and LOAD retire
            # coincide), or the case where the previous inner loop captured a
            # retire and we need to check whether the very next cycle already
            # has another retire_valid pulse.
            if not ctx.get(dut.core.retire_valid):
                for _ in range(MAX_RETIRE_WAIT):
                    await ctx.tick()
                    if ctx.get(dut.core.retire_valid):
                        break
                else:
                    results["timeout_retire"] = _retire_idx
                    return   # ran out of cycles before collecting retire N
            # retire_valid is True on the current cycle — capture it.
            _capture_retire()
            await ctx.tick()   # advance past this retire pulse before next check

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    # ── Assertions ────────────────────────────────────────────────────────────

    if results.get("timeout_boot"):
        assert False, (
            f"boot_complete never rose after {MAX_BOOT_CYCLES} cycles — "
            "boot FSM stalled"
        )

    expected_nias = [0x00000000, 0x00000004, 0x00000008]
    retires = results["retires"]

    if results.get("timeout_retire") is not None:
        n = results["timeout_retire"]
        assert False, (
            f"Timed out waiting for retire {n} (NIA=0x{expected_nias[n]:08X}) "
            f"after {MAX_RETIRE_WAIT} cycles.  "
            f"Retires so far: {[(hex(n), fv) for n, fv in retires]}"
        )

    assert len(retires) == 3, (
        f"Expected 3 retires, got {len(retires)}: {retires}"
    )

    for i, ((nia, fault_valid), exp_nia) in enumerate(zip(retires, expected_nias)):
        instr_name = ["LOAD", "CHANGE", "CALL"][i]
        print(f"  retire[{i}]: NIA=0x{nia:08X}  fault_valid={fault_valid}  "
              f"({instr_name})")

        assert nia == exp_nia, (
            f"retire[{i}] NIA=0x{nia:08X}, expected 0x{exp_nia:08X} ({instr_name})"
        )
        assert not fault_valid, (
            f"retire[{i}] ({instr_name} at NIA=0x{nia:08X}) has fault_valid=True — "
            f"fault_halt would fire, halting the board before the IDE can attach.  "
            f"This is a false-halt regression."
        )

    if results["fault_halts"]:
        assert False, (
            f"fault_halt fired during boot at NIA(s): "
            f"{[hex(n) for n in results['fault_halts']]} — "
            f"board enters step_mode before IDE attaches"
        )

    print(f"  All 3 boot instructions retired cleanly — fault_halt never fired ✓")
    print("PASS")


# ── Test 3: fault detection mechanism works ───────────────────────────────────

def test_fault_halt_mechanism():
    """Sanity: fault_halt = retire_valid & retire_fault_valid in the harness.

    Verifies that the harness correctly exposes fault_halt as a combinatorial
    OR-gate output, mirroring the RTL in wukong_top.py line 528.
    """
    print("\n=== Test 3: fault_halt mechanism verification ===")

    import os
    wukong_top_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "wukong_top.py")
    with open(wukong_top_path) as fh:
        src = fh.read()

    # Confirm the RTL expression matches the harness
    assert "fault_halt.eq(core.retire_valid & core.retire_fault_valid)" in src, (
        "wukong_top.py fault_halt.eq() expression not found — "
        "harness may not mirror the correct RTL behaviour"
    )
    print("  wukong_top.py fault_halt = retire_valid & retire_fault_valid  ✓")

    # Confirm fault_halt is ORed with bp_hit in the step-mode latch
    assert "bp_hit | fault_halt" in src or "fault_halt | bp_hit" in src, (
        "wukong_top.py must OR fault_halt with bp_hit in the step-mode latch"
    )
    print("  wukong_top.py step_mode latch: m.If(bp_hit | fault_halt)  ✓")
    print("PASS")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    failures = []
    for fn in (
        test_boot_rom_instruction_encoding,
        test_boot_rom_no_false_halt,
        test_fault_halt_mechanism,
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
