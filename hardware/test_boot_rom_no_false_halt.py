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
import pytest
from amaranth import *
from amaranth.lib.data import StructLayout, unsigned
from amaranth.lib.memory import Memory as LibMemory
from amaranth.sim import Simulator

from .core import ChurchCore
from .boot_rom import (
    BootRom, BOOT_PROGRAM, encode_church, encode_turing,
    WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST, WUKONG_NUC_PROGRAM,
    WUKONG_SELFTEST_WORDS, WUKONG_SELFTEST_BASE_WORD, WUKONG_WCH_BASE_WORD,
    WUKONG_THREAD_BASE_WORD, WUKONG_THREAD_HEADER,
    WUKONG_THREAD_STO_WORD, WUKONG_THREAD_STO_INIT,
    WUKONG_THREAD_CAPS0_WORD, WUKONG_THREAD_CAPS12_WORD,
    WUKONG_WCH_CLIST, WUKONG_WCH_CLIST_WORD, wukong_wch_header,
)
from .hw_types import (
    ChurchOpcode, CondCode, FaultType, GT_TYPE_INFORM, PERM_MASK_E, PERM_MASK_R,
    PERM_MASK_L, PERM_MASK_S, PERM_MASK_X, SWITCH_TGT_CR12, SWITCH_TGT_CR13,
    TpermPreset, TuringOpcode, make_gt,
)
from .integrity32 import integrity32


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


def _lump_header(*, n_minus_6, cw, cc):
    return (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc


def _build_nested_call_dmem():
    """Factory Thread plus three ordinary namespace-backed call domains."""
    dmem = list(_DMEM_INIT)

    caller_gt = E_GT_SELFTEST
    middle_slot = 4
    leaf_slot = 5
    middle_gt = make_gt(
        gt_type=GT_TYPE_INFORM, perms=PERM_MASK_E, slot_id=middle_slot)
    leaf_gt = make_gt(
        gt_type=GT_TYPE_INFORM, perms=PERM_MASK_E, slot_id=leaf_slot)

    middle_base = 0x2000
    leaf_base = 0x2200
    alloc_words = 64
    ns_word1 = alloc_words - 1
    for slot, base in ((middle_slot, middle_base), (leaf_slot, leaf_base)):
        ns_word = slot * 4
        dmem[ns_word + 0] = base
        dmem[ns_word + 1] = ns_word1
        dmem[ns_word + 2] = integrity32(base, ns_word1)
        dmem[ns_word + 3] = 0

    # The boot CALL enters SelfTest directly. Its first normal instruction
    # CALLs through c-list row 0 into the middle domain; after the matching
    # RETURN, a self-branch provides a stable post-return fetch target.
    caller_word = WUKONG_SELFTEST_BASE_WORD
    dmem[caller_word + 0] = _lump_header(n_minus_6=3, cw=3, cc=2)
    dmem[caller_word + 1] = encode_church(
        ChurchOpcode.LOAD, CondCode.AL, cr_dst=1, cr_src=6, imm=0)
    dmem[caller_word + 2] = encode_church(
        ChurchOpcode.CALL, CondCode.AL, cr_src=1)
    dmem[caller_word + 3] = encode_turing(
        TuringOpcode.BRANCH, CondCode.AL, imm=0)
    caller_clist = caller_word + 512 - 2
    dmem[caller_clist + 0] = middle_gt
    dmem[caller_clist + 1] = 0

    # Middle domain immediately CALLs the leaf, then RETURNs to the caller.
    middle_word = middle_base // 4
    dmem[middle_word + 0] = _lump_header(n_minus_6=0, cw=4, cc=2)
    dmem[middle_word + 1] = encode_church(
        ChurchOpcode.LOAD, CondCode.AL, cr_dst=2, cr_src=6, imm=1)
    dmem[middle_word + 2] = encode_church(
        ChurchOpcode.LOAD, CondCode.AL, cr_dst=1, cr_src=6, imm=0)
    dmem[middle_word + 3] = encode_church(
        ChurchOpcode.CALL, CondCode.AL, cr_src=1)
    dmem[middle_word + 4] = encode_church(
        ChurchOpcode.RETURN, CondCode.AL, cr_src=2)
    middle_clist = middle_word + alloc_words - 2
    dmem[middle_clist + 0] = leaf_gt
    dmem[middle_clist + 1] = middle_gt

    # Leaf domain terminates the nesting with an ordinary cross-domain RETURN.
    leaf_word = leaf_base // 4
    dmem[leaf_word + 0] = _lump_header(n_minus_6=0, cw=2, cc=2)
    dmem[leaf_word + 1] = encode_church(
        ChurchOpcode.LOAD, CondCode.AL, cr_dst=2, cr_src=6, imm=0)
    dmem[leaf_word + 2] = encode_church(
        ChurchOpcode.RETURN, CondCode.AL, cr_src=2)
    leaf_clist = leaf_word + alloc_words - 2
    dmem[leaf_clist + 0] = leaf_gt
    dmem[leaf_clist + 1] = 0

    return dmem, {
        "caller_gt": caller_gt,
        "middle_gt": middle_gt,
        "leaf_gt": leaf_gt,
        "middle_base": middle_base,
        "leaf_base": leaf_base,
    }

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


def test_consecutive_switch_fault_stays_on_first_issuer():
    """A missing-M SWITCH faults atomically without exposing its successor."""
    dmem = list(_DMEM_INIT)
    first_nia = _SELFTEST_ENTRY_NIA
    first_instr = encode_church(
        ChurchOpcode.SWITCH, CondCode.AL,
        cr_dst=SWITCH_TGT_CR12, cr_src=6, imm=0)
    second_instr = encode_church(
        ChurchOpcode.SWITCH, CondCode.AL,
        cr_dst=SWITCH_TGT_CR13, cr_src=6, imm=0)
    dmem[first_nia // 4] = first_instr
    dmem[first_nia // 4 + 1] = second_instr

    dut = BootRomHarness(dmem)
    observed = {"retires": [], "fault_instr": None}

    async def testbench(ctx):
        initial_cr12 = None
        cleared_boot_m = False
        for _ in range(700):
            if (ctx.get(dut.core.imem_addr) == first_nia and
                    not cleared_boot_m):
                # The boot microcode deliberately seeds CR12.M. Clear the
                # device-owned M word during the synchronous-fetch settle
                # bubble so both consecutive SWITCH destinations lack M.
                ctx.set(dut.core.dbg_m_bit_wr_en, 1)
                ctx.set(dut.core.dbg_m_bit_word, 0)
                cleared_boot_m = True
            else:
                ctx.set(dut.core.dbg_m_bit_wr_en, 0)
            if ctx.get(dut.boot_complete) and initial_cr12 is None:
                initial_cr12 = ctx.get(dut.core.dbg_cr12_gt)
            if ctx.get(dut.core.retire_valid):
                observed["retires"].append((
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                    ctx.get(dut.core.retire_fault_code),
                ))
                if ctx.get(dut.core.retire_fault_valid):
                    observed["cr12_before"] = initial_cr12
                    observed["cr12_after"] = ctx.get(dut.core.dbg_cr12_gt)
                    observed["m_after"] = ctx.get(dut.core.dbg_isolated_m_flags)
                    await ctx.tick()
                    observed["fault_instr"] = ctx.get(dut.core.fault_instr)
                    return
            await ctx.tick()
        observed["timeout"] = True

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert not observed.get("timeout")
    faults = [retire for retire in observed["retires"] if retire[2]]
    assert faults == [(first_nia, first_instr, True, FaultType.PERM_L)]
    assert not any(nia == first_nia + 4 for nia, _, _, _ in observed["retires"])
    assert observed["fault_instr"] == first_instr
    assert observed["cr12_after"] == observed["cr12_before"]
    assert observed["m_after"] == 0


def test_successful_switch_retires_once_then_advances():
    """A successful SWITCH commits once before its following instruction."""
    dmem = list(_DMEM_INIT)
    first_nia = _SELFTEST_ENTRY_NIA
    first_instr = encode_church(
        ChurchOpcode.SWITCH, CondCode.AL,
        cr_dst=SWITCH_TGT_CR12, cr_src=6, imm=0)
    second_instr = encode_church(
        ChurchOpcode.SWITCH, CondCode.AL,
        cr_dst=SWITCH_TGT_CR13, cr_src=6, imm=0)
    dmem[first_nia // 4] = first_instr
    dmem[first_nia // 4 + 1] = second_instr

    # Install a minimal c-list source and valid destination Namespace entry.
    source_addr = 0x3400
    destination_base = 0x3600
    destination_slot = 4
    loaded_gt = make_gt(
        gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=destination_slot)
    source_cap = (
        make_gt(gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=1)
        | (source_addr << 32)
    )
    dmem[source_addr // 4] = loaded_gt
    ns_word = destination_slot * 4
    ns_word1 = 63
    dmem[ns_word + 0] = destination_base
    dmem[ns_word + 1] = ns_word1
    dmem[ns_word + 2] = integrity32(destination_base, ns_word1)
    dmem[ns_word + 3] = 0

    dut = BootRomHarness(dmem)
    observed = {"retires": []}

    async def testbench(ctx):
        installed_source = False
        for _ in range(700):
            if (ctx.get(dut.core.imem_addr) == first_nia and
                    not installed_source):
                # Install CR6 while instruction fetch settles. CR12.M remains
                # set by boot, while CR13.M remains clear for the successor.
                ctx.set(dut.core.dbg_cr_wr_en, 1)
                ctx.set(dut.core.dbg_cr_wr_addr, 6)
                ctx.set(dut.core.dbg_cr_wr_data.as_value(), source_cap)
                installed_source = True
            else:
                ctx.set(dut.core.dbg_cr_wr_en, 0)
            if ctx.get(dut.core.retire_valid):
                observed["retires"].append((
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                    ctx.get(dut.core.retire_fault_code),
                ))
                if (ctx.get(dut.core.retire_fault_valid) and
                        ctx.get(dut.core.retire_nia) == first_nia + 4):
                    observed["cr12_after"] = ctx.get(dut.core.dbg_cr12_gt)
                    observed["m_after"] = ctx.get(
                        dut.core.dbg_isolated_m_flags)
                    return
            await ctx.tick()
        observed["timeout"] = True

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert not observed.get("timeout")
    first_retires = [
        retire for retire in observed["retires"] if retire[0] == first_nia]
    assert first_retires == [(first_nia, first_instr, False, FaultType.NONE)]
    assert observed["retires"][-1] == (
        first_nia + 4, second_instr, True, FaultType.PERM_L)
    assert observed["cr12_after"] == loaded_gt
    assert observed["m_after"] == 0


_DELAYED_FAULT_CASES = [
    pytest.param(
        "CALL",
        encode_church(
            ChurchOpcode.CALL, CondCode.AL,
            cr_src=1),
        FaultType.PERM_E,
        make_gt(GT_TYPE_INFORM, 0, slot_id=1),
        False,
        id="call-permission",
    ),
    pytest.param(
        "RETURN",
        encode_church(
            ChurchOpcode.RETURN, CondCode.AL,
            cr_src=1),
        FaultType.PERM_E,
        make_gt(GT_TYPE_INFORM, 0, slot_id=1),
        False,
        id="return-permission",
    ),
    pytest.param(
        "SWITCH",
        encode_church(
            ChurchOpcode.SWITCH, CondCode.AL,
            cr_dst=SWITCH_TGT_CR12, cr_src=6, imm=0),
        FaultType.PERM_L,
        None,
        True,
        id="switch-missing-m",
    ),
    pytest.param(
        "LOAD",
        encode_church(
            ChurchOpcode.LOAD, CondCode.AL,
            cr_dst=2, cr_src=6, imm=0x7FFF),
        FaultType.BOUNDS,
        None,
        False,
        id="load-bounds",
    ),
    pytest.param(
        "SAVE",
        encode_church(
            ChurchOpcode.SAVE, CondCode.AL,
            cr_dst=12, cr_src=1, imm=0),
        FaultType.PERM_L,
        make_gt(GT_TYPE_INFORM, PERM_MASK_R, slot_id=4),
        True,
        id="save-missing-m",
    ),
    pytest.param(
        "TPERM",
        encode_church(
            ChurchOpcode.TPERM, CondCode.AL,
            cr_dst=1, cr_src=1, imm=TpermPreset.R),
        FaultType.DOMAIN_PURITY,
        make_gt(GT_TYPE_INFORM, PERM_MASK_L, slot_id=4),
        False,
        id="tperm-domain-purity",
    ),
    pytest.param(
        "CHANGE",
        encode_church(
            ChurchOpcode.CHANGE, CondCode.AL,
            cr_dst=14, cr_src=1, imm=0),
        FaultType.PERM_L,
        make_gt(GT_TYPE_INFORM, PERM_MASK_R, slot_id=4),
        False,
        id="change-permission",
    ),
    pytest.param(
        "ELOADCALL",
        encode_church(
            ChurchOpcode.ELOADCALL, CondCode.AL,
            cr_dst=2, cr_src=6, imm=0),
        FaultType.PERM_L,
        None,
        False,
        id="eloadcall-structural-source",
    ),
    pytest.param(
        "XLOADLAMBDA",
        encode_church(
            ChurchOpcode.XLOADLAMBDA, CondCode.AL,
            cr_dst=2, cr_src=6, imm=4),
        FaultType.NULL_CAP,
        None,
        False,
        id="xloadlambda-null-cap",
    ),
    pytest.param(
        "DREAD",
        encode_turing(
            TuringOpcode.DREAD, CondCode.AL,
            dr_dst=1, dr_src=1, imm=0x4000),
        FaultType.NULL_CAP,
        None,
        False,
        id="dread-null-cap",
    ),
    pytest.param(
        "DWRITE",
        encode_turing(
            TuringOpcode.DWRITE, CondCode.AL,
            dr_dst=1, dr_src=1, imm=0x4000),
        FaultType.NULL_CAP,
        None,
        False,
        id="dwrite-null-cap",
    ),
]


@pytest.mark.parametrize(
    "name,instruction,expected_fault,cr1_value,clear_m",
    _DELAYED_FAULT_CASES,
)
def test_delayed_fault_retires_on_issuing_instruction(
        name, instruction, expected_fault, cr1_value, clear_m):
    """Every delayed-fault class reports its own NIA and instruction word."""
    dmem = list(_DMEM_INIT)
    first_nia = _SELFTEST_ENTRY_NIA
    dmem[first_nia // 4] = instruction
    dmem[first_nia // 4 + 1] = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1)

    dut = BootRomHarness(dmem)
    observed = {"retires": [], "owned_nias": []}

    async def testbench(ctx):
        configured = False
        issuer_seen = False
        for _ in range(800):
            at_issuer = ctx.get(dut.core.imem_addr) == first_nia
            if at_issuer and not configured:
                if cr1_value is not None:
                    ctx.set(dut.core.dbg_cr_wr_en, 1)
                    ctx.set(dut.core.dbg_cr_wr_addr, 1)
                    ctx.set(dut.core.dbg_cr_wr_data.as_value(), cr1_value)
                if clear_m:
                    ctx.set(dut.core.dbg_m_bit_wr_en, 1)
                    ctx.set(dut.core.dbg_m_bit_word, 0)
                configured = True
                issuer_seen = True
            else:
                ctx.set(dut.core.dbg_cr_wr_en, 0)
                ctx.set(dut.core.dbg_m_bit_wr_en, 0)

            if issuer_seen and not observed.get("fault_seen"):
                observed["owned_nias"].append(ctx.get(dut.core.nia))

            if ctx.get(dut.core.retire_valid):
                retire = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                    ctx.get(dut.core.retire_fault_code),
                )
                observed["retires"].append(retire)
                if retire[2]:
                    observed["fault_seen"] = True
                    await ctx.tick()
                    observed["fault_instr"] = ctx.get(dut.core.fault_instr)
                    return
            await ctx.tick()
        observed["timeout"] = True

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert not observed.get("timeout"), f"{name} never fault-retired"
    faults = [retire for retire in observed["retires"] if retire[2]]
    assert faults == [
        (first_nia, instruction, True, expected_fault)
    ], f"{name} fault was not attributed to its issuer"
    assert observed["fault_instr"] == instruction
    assert set(observed["owned_nias"]) == {first_nia}
    assert not any(
        nia == first_nia + 4 for nia, _, _, _ in observed["retires"]
    ), f"{name} exposed its successor before the delayed fault"


def test_successful_xloadlambda_retires_once_and_clears_namespace_g_bit():
    """A successful fused load commits once and preserves GC liveness."""
    dmem = list(_DMEM_INIT)
    first_nia = _SELFTEST_ENTRY_NIA
    target_nia = 0x3000
    slot = 4
    x_gt = make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=slot)
    word1_with_g = 63 | (1 << 30)
    word1_without_g = word1_with_g & ~(1 << 30)

    dmem[first_nia // 4] = encode_church(
        ChurchOpcode.XLOADLAMBDA, CondCode.AL,
        cr_dst=2, cr_src=6, imm=0)
    dmem[target_nia // 4] = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1)

    # CR6 names SelfTest's c-list at the tail of its fixed 512-word body.
    selftest_clist_word = WUKONG_SELFTEST_BASE_WORD + 512 - 2
    dmem[selftest_clist_word] = x_gt
    ns_word = slot * 4
    dmem[ns_word + 0] = target_nia
    dmem[ns_word + 1] = word1_with_g
    dmem[ns_word + 2] = integrity32(target_nia, word1_with_g)
    dmem[ns_word + 3] = 0x12345678

    dut = BootRomHarness(dmem)
    observed = {"retires": [], "gbit_writes": []}

    async def testbench(ctx):
        for _ in range(900):
            if ctx.get(dut.core.dmem_wr_en):
                observed["gbit_writes"].append((
                    ctx.get(dut.core.dmem_addr),
                    ctx.get(dut.core.dmem_wr_data),
                ))
            if ctx.get(dut.core.retire_valid):
                retire = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                )
                observed["retires"].append(retire)
                if retire[0] == target_nia:
                    return
            await ctx.tick()
        observed["timeout"] = True

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert not observed.get("timeout")
    issuing_retires = [
        retire for retire in observed["retires"] if retire[0] == first_nia
    ]
    assert issuing_retires == [(
        first_nia, dmem[first_nia // 4], False
    )]
    assert observed["gbit_writes"].count((
        slot * 16 + 4, word1_without_g
    )) == 1


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

def test_turing_arithmetic_register_and_immediate_forms():
    """RTL executes IADD/ISUB register and immediate operands like the simulator."""
    dmem = list(_DMEM_INIT)
    program = [
        encode_turing(TuringOpcode.IADD, dr_dst=1, dr_src=0, imm=7),
        encode_turing(TuringOpcode.IADD, dr_dst=2, dr_src=0, imm=5),
        encode_turing(
            TuringOpcode.IADD, dr_dst=3, dr_src=1, imm=2,
            register_operand=True),
        encode_turing(TuringOpcode.ISUB, dr_dst=4, dr_src=3, imm=2),
        encode_turing(
            TuringOpcode.ISUB, dr_dst=5, dr_src=4, imm=1,
            register_operand=True),
    ]
    for offset, word in enumerate(program, start=1):
        dmem[WUKONG_SELFTEST_BASE_WORD + offset] = word

    dut = BootRomHarness(dmem)
    results = {}

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return
        results["retires"], results["timeout_at"] = \
            await _collect_retires(ctx, dut, 3 + len(program))
        results["dr"] = [
            ctx.get(dut.core.debug_dr_words[index]) for index in range(1, 6)
        ]

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    assert results.get("timeout_at") is None, (
        f"Timed out at retire {results.get('timeout_at')}; "
        f"retires={results.get('retires')}"
    )
    assert results["dr"] == [7, 5, 12, 10, 3], (
        "IADD/ISUB register/immediate operand mismatch: "
        f"DR1..DR5={results['dr']}"
    )
def test_selftest_first_arithmetic_check_passes():
    """Factory SelfTest must branch past its first failure RETURN at NIA 0x690."""
    dut = BootRomHarness(_DMEM_INIT)
    results = {}

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return
        details = []
        for _ in range(1000):
            if ctx.get(dut.core.retire_valid):
                row = {
                    "nia": ctx.get(dut.core.retire_nia),
                    "instr": ctx.get(dut.core.retire_instr),
                    "fault_valid": bool(ctx.get(dut.core.retire_fault_valid)),
                    "fault_code": ctx.get(dut.core.retire_fault_code),
                    "fault_instr": ctx.get(dut.core.fault_instr),
                    "fault_stage": ctx.get(dut.core.fault_stage),
                }
                details.append(row)
                if row["nia"] in (0x690, 0x694):
                    break
            await ctx.tick()
        results["details"] = details
        results["timeout"] = not details or details[-1]["nia"] not in (0x690, 0x694)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    assert not results.get("timeout"), (
        "Timed out before the first SelfTest arithmetic verdict; "
        f"last retires={results.get('details', [])[-6:]}"
    )
    details = results["details"]
    assert all(not row["fault_valid"] for row in details), (
        f"SelfTest faulted before its first arithmetic verdict: {details[-6:]}"
    )
    assert all(row["nia"] != 0x690 for row in details), (
        "SelfTest took the first arithmetic failure RETURN at NIA 0x690"
    )
    assert details[-1]["nia"] == 0x694, (
        "SelfTest did not take the EQ pass branch to the second arithmetic check; "
        f"last retire={details[-1]}"
    )


def test_selftest_borrow_sets_c_clear_and_passes_test_27():
    """0-1 must clear C so SelfTest's BRANCHCC skips failure RETURN 27."""
    dut = BootRomHarness(_DMEM_INIT)
    results = {}

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return
        retired = []
        for _ in range(5000):
            if ctx.get(dut.core.retire_valid):
                retired.append(ctx.get(dut.core.retire_nia))
                if retired[-1] in (0x8DC, 0x8E0, 0x8E4):
                    break
            await ctx.tick()
        results["retired"] = retired

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    retired = results.get("retired", [])
    assert 0x8DC not in retired and 0x8E0 not in retired, (
        "SelfTest failed test 27 because BRANCHCC did not recognize the borrow"
    )
    assert retired and retired[-1] == 0x8E4, (
        f"SelfTest did not branch to test 28; last retires={retired[-8:]}"
    )


def test_nested_call_return_without_boot_special_case():
    """Two ordinary CALLs and RETURNs preserve the real Thread call stack."""
    dmem, fixture = _build_nested_call_dmem()
    dut = BootRomHarness(dmem)
    results = {
        "retires": [],
        "writes": [],
        "cloads": [],
        "active_bases": [],
    }

    async def testbench(ctx):
        results["boot_ok"] = await _wait_boot_complete(ctx, dut)
        if not results["boot_ok"]:
            return

        for cycle in range(1600):
            if ctx.get(dut.core.dmem_wr_en):
                addr = ctx.get(dut.core.dmem_addr)
                results["writes"].append((
                    addr, ctx.get(dut.core.dmem_wr_data),
                ))
                thread_base = WUKONG_THREAD_BASE_WORD * 4
                if thread_base <= addr < thread_base + 256 * 4:
                    results["active_bases"].append(
                        ctx.get(dut.core.active_thread_base))
            if ctx.get(dut.core.retire_trace_return_cr14_valid):
                results["cloads"].append((
                    cycle,
                    ctx.get(dut.core.retire_trace_return_cr14_gt),
                ))
            if ctx.get(dut.core.retire_valid):
                results["retires"].append({
                    "cycle": cycle,
                    "nia": ctx.get(dut.core.retire_nia),
                    "instr": ctx.get(dut.core.retire_instr),
                    "fault": bool(ctx.get(dut.core.retire_fault_valid)),
                })
                if len(results["retires"]) == 12:
                    break
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results.get("boot_ok"), "boot_complete never rose"
    retires = results["retires"]
    assert len(retires) == 12, f"nested sequence stalled: {retires}"

    middle_call_nia = fixture["middle_base"] + 12
    leaf_return_nia = fixture["leaf_base"] + 8
    expected_nias = [
        0x00, 0x04, 0x08,       # boot setup; only this CALL uses boot_window
        0x604,                   # LOAD middle E-GT from SelfTest c-list
        0x608,                   # ordinary SelfTest -> middle CALL
        fixture["middle_base"] + 4,  # LOAD middle's own return E-GT
        fixture["middle_base"] + 8,  # LOAD leaf E-GT
        middle_call_nia,         # ordinary middle -> leaf CALL
        fixture["leaf_base"] + 4,    # LOAD leaf's own return E-GT
        leaf_return_nia,         # leaf -> middle RETURN
        fixture["middle_base"] + 16,  # middle -> SelfTest RETURN
        0x60C,                   # settled caller fetch after both cloads
    ]
    assert [row["nia"] for row in retires] == expected_nias, (
        "unexpected or phantom retirement in nested CALL/RETURN sequence: "
        f"{retires}"
    )
    assert not any(row["fault"] for row in retires), retires

    # Both return targets must be fetched only after a settle interval and the
    # intervening cLoad commit. A stale RETURN fetch would retire on the next
    # cycle at the old domain's NIA.
    assert retires[10]["cycle"] > retires[9]["cycle"] + 1, retires
    assert retires[11]["cycle"] > retires[10]["cycle"] + 1, retires
    assert retires[10]["instr"] == encode_church(
        ChurchOpcode.RETURN, CondCode.AL, cr_src=2)
    assert retires[11]["instr"] == encode_turing(
        TuringOpcode.BRANCH, CondCode.AL, imm=0)

    cloads = results["cloads"]
    assert [gt for _, gt in cloads] == [
        make_gt(
            gt_type=GT_TYPE_INFORM,
            perms=PERM_MASK_R | PERM_MASK_X,
            slot_id=4,
        ),
        make_gt(
            gt_type=GT_TYPE_INFORM,
            perms=PERM_MASK_R | PERM_MASK_X,
            slot_id=6,
        ),
    ], f"RETURN cLoad commits missing or out of order: {cloads}"
    assert retires[9]["cycle"] < cloads[0][0] < retires[10]["cycle"]
    assert retires[10]["cycle"] < cloads[1][0] < retires[11]["cycle"]

    thread_base = WUKONG_THREAD_BASE_WORD * 4
    assert results["active_bases"]
    assert set(results["active_bases"]) == {thread_base}, (
        f"stack traffic escaped active Thread base 0x{thread_base:X}: "
        f"{results['active_bases']}"
    )

    # The boot setup leaves STO=241. The two ordinary pushes create nested
    # frames at 241 and 239, then the two RETURNs restore 239 and finally 241.
    def frame_word(prev_sto, return_nia):
        return (1 << 12) | ((return_nia // 4) << 13) | prev_sto

    expected_stack_writes = [
        (thread_base + 240 * 4, fixture["caller_gt"]),
        (thread_base + 241 * 4, frame_word(241, 0x60C)),
        (thread_base + 17 * 4, 239 | (1 << 12)),
        (thread_base + 238 * 4, fixture["middle_gt"]),
        (thread_base + 239 * 4,
         frame_word(239, fixture["middle_base"] + 16)),
        (thread_base + 17 * 4, 237 | (1 << 12)),
        (thread_base + 17 * 4, 239 | (1 << 12)),
        (thread_base + 17 * 4, 241 | (1 << 12)),
    ]
    writes = results["writes"]
    cursor = 0
    for expected in expected_stack_writes:
        try:
            cursor = writes.index(expected, cursor) + 1
        except ValueError:
            raise AssertionError(
                f"missing ordered stack write {expected}; writes={writes}")


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
        test_nested_call_return_without_boot_special_case,
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
