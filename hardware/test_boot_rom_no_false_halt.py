"""hardware/test_boot_rom_no_false_halt.py — Boot ROM false-halt simulation test.

Simulates the 3-instruction boot ROM sequence (LOAD→CHANGE→CALL) end-to-end using
the real ChurchCore + DMEM, and verifies that all 3 instructions retire cleanly
(retire_fault_valid=False) so fault_halt never fires during boot.

Boot sequence (from docs/debug-packet-protocol.md §"Boot sequence"):

    [0] LOAD   CR15, CR15[0]   NIA=0x00  →  retire_fault_valid must be False
    [1] CHANGE CR12, CR15, #1  NIA=0x04  →  retire_fault_valid must be False
    [2] CALL   CR0,  CR0       NIA=0x08  →  retire_fault_valid must be False

The DMEM is pre-initialised with the factory SelfTest LUMP, the selectable
WukongCallHome LUMP, and the relocated Thread lump. Thread.caps[0] carries
the SelfTest E-GT (NS slot 6), so BOOT_PROGRAM[2] enters the default lightning
entry without a NULL_CAP fault.

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
    BootRom, BOOT_PROGRAM, encode_turing,
    WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST, WUKONG_NUC_PROGRAM,
    WUKONG_SELFTEST_WORDS, WUKONG_SELFTEST_BASE_WORD, WUKONG_WCH_BASE_WORD,
    WUKONG_THREAD_BASE_WORD, WUKONG_THREAD_HEADER,
    WUKONG_THREAD_STO_WORD, WUKONG_THREAD_STO_INIT,
    WUKONG_THREAD_CAPS0_WORD, WUKONG_THREAD_CAPS12_WORD,
    WUKONG_WCH_CLIST, WUKONG_WCH_CLIST_WORD, wukong_wch_header,
)
from .hw_types import (
    CondCode, GT_TYPE_INFORM, PERM_MASK_E, PERM_MASK_S,
    TuringOpcode, make_gt,
)


# ── DMEM init data (mirrors ChurchWukongXC7A100T.elaborate() exactly) ─────────
#
# Layout:
#   words   0-31  : WUKONG_DEMO_NAMESPACE  (8 NS slots × 4 words, direct layout)
#   words  32-255 : zeros
#   words 256-319 : WUKONG_DEMO_CLIST      (64 c-list entries)
#   words 320-383 : zeros
#   words 384-895 : canonical SelfTest LUMP
#   words 896-1151: relocated Boot.Thread LUMP
#   words 1152-1279: WukongCallHome LUMP body
#
# The factory image uses SelfTest as the default CALL target.
E_GT_SELFTEST = make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_E, slot_id=6)
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

    for _i, _v in enumerate(WUKONG_SELFTEST_WORDS):
        dmem[WUKONG_SELFTEST_BASE_WORD + _i] = _v

    # WukongCallHome LUMP body at byte 0x1200 = word 1152.
    _cw = len(WUKONG_NUC_PROGRAM)
    for _i, _v in enumerate([wukong_wch_header(_cw)] + list(WUKONG_NUC_PROGRAM)):
        dmem[WUKONG_WCH_BASE_WORD + _i] = _v
    for _i, _v in enumerate(WUKONG_WCH_CLIST):
        dmem[WUKONG_WCH_CLIST_WORD + _i] = _v

    # Boot.Thread lump at byte 0xE00 (word 896) — mirrors wukong_top.py.
    # See boot_rom.py for the relocation rationale (base-0 Thread lump
    # collides with the NS table: protected STO is NS slot 4 word1).
    dmem[WUKONG_THREAD_BASE_WORD]   = WUKONG_THREAD_HEADER
    dmem[WUKONG_THREAD_STO_WORD]    = WUKONG_THREAD_STO_INIT
    dmem[WUKONG_THREAD_CAPS0_WORD]  = E_GT_SELFTEST
    dmem[WUKONG_THREAD_CAPS12_WORD] = make_gt(GT_TYPE_INFORM, PERM_MASK_S, slot_id=1, gt_seq=0)

    return dmem

_DMEM_INIT = _build_dmem_init()

# ROM: BOOT_PROGRAM[0..2] + the post-RETURN BRANCH -1 guard + zeros.
_BRANCH_MINUS_1 = encode_turing(
    TuringOpcode.BRANCH, CondCode.AL, imm=(-1) & 0x7FFF)
_WUKONG_ROM = list(BOOT_PROGRAM[:3]) + [_BRANCH_MINUS_1] + [0] * (1024 - 4)
_WUKONG_BOOT_WINDOW_BYTES = 4 * 4


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
        m.d.comb += boot_rom.addr.eq(core.imem_addr[2:12])
        # imem source mux (mirrors wukong_top.py): NIA 0x0-0xF fetches
        # BOOT_PROGRAM plus the post-RETURN BRANCH -1 guard from ROM; everything
        # else fetches from DMEM. Both sources have 1-cycle latency, so the
        # select is registered to stay aligned with the data.
        imem_from_dmem = Signal()
        m.d.sync += imem_from_dmem.eq(
            core.imem_addr >= _WUKONG_BOOT_WINDOW_BYTES)

        # ── Data memory (LibMemory, pre-initialised for simulation) ───────────
        dmem = m.submodules.dmem = LibMemory(
            shape=unsigned(32), depth=16384, init=self._dmem_init)
        dmem_rd = dmem.read_port(domain="sync")
        dmem_wr = dmem.write_port()

        # Dedicated instruction-fetch read port (mirrors wukong_top.py)
        imem_rd = dmem.read_port(domain="sync")
        m.d.comb += [
            imem_rd.addr.eq(core.imem_addr[2:16]),
            core.imem_data.eq(Mux(imem_from_dmem, imem_rd.data, boot_rom.data)),
        ]

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
        # Fetch-settle bubble: the DMEM/IMEM BRAM is sync-read, so the cycle
        # after imem_addr changes the read data is still the OLD word.  Without
        # this mask the core retires a stale decode right after every NIA jump
        # (observed: instruction stream slid one slot after the boot CALL).
        imem_addr_prev = Signal(32, init=0xFFFFFFFF)
        m.d.sync += imem_addr_prev.eq(core.imem_addr)
        imem_settled = Signal()
        m.d.comb += imem_settled.eq(imem_addr_prev == core.imem_addr)
        m.d.comb += [
            # Instruction fetch is valid as soon as boot is complete AND the
            # BRAM read data corresponds to the current fetch address.
            core.imem_valid.eq(core.boot_complete & imem_settled),
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


# ── Shared retire-collection helper for Tests 4/5 ─────────────────────────────

_SELFTEST_ENTRY_NIA = 0x604
_SELFTEST_CODE_LO   = 0x604
_SELFTEST_CODE_HI   = 0x600 + 512 * 4


async def _collect_retires(ctx, dut, count, max_wait=400):
    """Collect `count` retire pulses as (nia, fault_valid) tuples.

    Returns (retires, timed_out_at).  Assumes boot_complete is already high
    (or will rise within max_wait cycles of the first retire wait).
    """
    retires = []
    for idx in range(count):
        if not ctx.get(dut.core.retire_valid):
            for _ in range(max_wait):
                await ctx.tick()
                if ctx.get(dut.core.retire_valid):
                    break
            else:
                return retires, idx
        retires.append((
            ctx.get(dut.core.retire_nia),
            bool(ctx.get(dut.core.retire_fault_valid)),
        ))
        await ctx.tick()
    return retires, None


async def _wait_boot_complete(ctx, dut, max_cycles=40):
    for _ in range(max_cycles):
        if ctx.get(dut.boot_complete):
            return True
        await ctx.tick()
    return bool(ctx.get(dut.boot_complete))


def _assert_boot_and_selftest(retires, n_selftest, label=""):
    """Assert the boot triple + factory SelfTest retires."""
    expected_boot = [0x0, 0x4, 0x8]
    assert len(retires) >= 3 + n_selftest, (
        f"{label}: only {len(retires)} retires collected: "
        f"{[(hex(n), fv) for n, fv in retires]}"
    )
    for i, exp in enumerate(expected_boot):
        nia, fv = retires[i]
        assert nia == exp and not fv, (
            f"{label}: boot retire[{i}] NIA=0x{nia:08X} fault={fv}, "
            f"expected 0x{exp:08X} clean"
        )
    nia3, fv3 = retires[3]
    assert nia3 == _SELFTEST_ENTRY_NIA, (
        f"{label}: retire[3] NIA=0x{nia3:08X}, expected SelfTest entry "
        f"0x{_SELFTEST_ENTRY_NIA:08X} — boot CALL did not jump into SelfTest"
    )
    for i, (nia, fv) in enumerate(retires[3:3 + n_selftest], start=3):
        assert not fv, (
            f"{label}: retire[{i}] at NIA=0x{nia:08X} faulted — "
            f"SelfTest execution is not clean; factory entry must run without "
            f"an immediate capability fault"
        )
        assert _SELFTEST_CODE_LO <= nia < _SELFTEST_CODE_HI, (
            f"{label}: retire[{i}] NIA=0x{nia:08X} escaped the SelfTest "
            f"code range [0x{_SELFTEST_CODE_LO:X}, 0x{_SELFTEST_CODE_HI:X})"
        )


# ── Test 4: boot CALL enters SelfTest and runs clean ─────────────────────────

def test_boot_call_enters_selftest():
    """Factory image: ROM boot → CALL jumps to NIA=0x604."""
    print("\n=== Test 4: boot CALL enters SelfTest ===")

    dut = BootRomHarness(_DMEM_INIT)
    results = {}

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return
        results["retires"], results["timeout_at"] = \
            await _collect_retires(ctx, dut, 3 + 32)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    assert results.get("timeout_at") is None, (
        f"Timed out waiting for retire {results['timeout_at']}; "
        f"got {[(hex(n), fv) for n, fv in results['retires']]}"
    )
    _assert_boot_and_selftest(results["retires"], 32, label="pass1")
    print(f"  boot triple + 32 SelfTest retires all clean; "
          f"entry NIA=0x{results['retires'][3][0]:X} ✓")
    print("PASS")


def test_selftest_return_reaches_boot_guard():
    """Factory SelfTest RETURN must resume at ROM NIA 0x0C and retire BRANCH -1.

    This covers the physical failure boundary: older coverage stopped four
    SelfTest instructions before RETURN and therefore could not detect either
    a RETURN/cload handoff deadlock or a ROM/DMEM mux regression at NIA 0x0C.
    """
    dut = BootRomHarness(_DMEM_INIT)
    results = {}

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return
        # 3 boot instructions + 35 SelfTest instructions before RETURN
        # + the RETURN at 0x690 + the first post-RETURN guard retire.
        results["retires"], results["timeout_at"] = \
            await _collect_retires(ctx, dut, 3 + 35 + 1 + 1, max_wait=800)
        results["last_fault_code"] = ctx.get(dut.core.retire_fault_code)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    assert results.get("timeout_at") is None, (
        f"Timed out at retire {results.get('timeout_at')}; "
        f"last retires={[(hex(n), fv) for n, fv in results.get('retires', [])[-6:]]}; "
        f"fault_code={results.get('last_fault_code')}"
    )
    retires = results["retires"]
    return_nia, return_fault = retires[-2]
    guard_nia, guard_fault = retires[-1]
    assert (return_nia, return_fault) == (0x690, False), (
        f"Expected clean SelfTest RETURN at 0x690, got "
        f"NIA=0x{return_nia:08X} fault={return_fault}"
    )
    assert (guard_nia, guard_fault) == (0x0C, False), (
        f"Expected clean post-RETURN BRANCH guard at 0x0C, got "
        f"NIA=0x{guard_nia:08X} fault={guard_fault} "
        f"code={results.get('last_fault_code')}"
    )


# ── Test 5: repeated 'f' reboots stay clean (FAULT_RST wipes unit state) ──────

def test_repeated_reboots_stay_clean():
    """Pulse reboot_req mid-run twice; each pass must re-boot cleanly into SelfTest."""
    print("\n=== Test 5: repeated reboots (reboot_req → FAULT_RST) stay clean ===")

    dut = BootRomHarness(_DMEM_INIT)
    results = {"passes": []}

    async def testbench(ctx):
        for pass_idx in range(3):
            ok = await _wait_boot_complete(ctx, dut)
            if not ok:
                results["boot_fail"] = pass_idx
                return
            retires, timeout_at = await _collect_retires(ctx, dut, 3 + 10)
            results["passes"].append((retires, timeout_at))
            if pass_idx < 2:
                # Reboot mid-run — deliberately NOT aligned to instruction
                # boundaries, so in-flight unit state must be wiped by FAULT_RST.
                ctx.set(dut.core.reboot_req, 1)
                await ctx.tick()
                ctx.set(dut.core.reboot_req, 0)
                await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert "boot_fail" not in results, (
        f"boot_complete never re-rose on pass {results['boot_fail']}"
    )
    assert len(results["passes"]) == 3, f"only {len(results['passes'])} passes ran"
    for i, (retires, timeout_at) in enumerate(results["passes"]):
        assert timeout_at is None, (
            f"pass {i}: timed out at retire {timeout_at}; "
            f"got {[(hex(n), fv) for n, fv in retires]}"
        )
        _assert_boot_and_selftest(retires, 10, label=f"pass{i}")
        print(f"  pass {i}: boot triple + 10 SelfTest retires clean ✓")
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
        test_boot_call_enters_wukong_callhome,
        test_repeated_reboots_stay_clean,
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
