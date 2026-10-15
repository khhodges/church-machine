"""Independent Phase 1 fixtures: no assembler/decoder-derived expectations.

Run explicitly: python3 -m pytest hardware/test_phase1_independent_execution.py -q
Failures are conformance findings, not expected-failure passes. This initial
slice samples H01–H04, H07 and H09; it does not claim full H01–H09 coverage.
"""
import pytest
from amaranth import Array, Module, Signal
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.decoder import ChurchDecoder
from hardware.sim_boot_helpers import boot_core
from hardware.tperm import ChurchTperm
from hardware.perm_check import ChurchPermCheck


def predicate(condition, n, z, c, v):
    """ISA truth table; deliberately independent of hardware enums/layout code."""
    return (
        z, not z, c, not c, n, not n, v, not v,
        c and not z, not c or z, n == v, n != v,
        not z and n == v, z or n != v, True,
    )[condition]


def test_all_defined_predicates():
    dut = ChurchDecoder()

    async def bench(ctx):
        for n in (0, 1):
            for z in (0, 1):
                for c in (0, 1):
                    for v in (0, 1):
                        for field, value in zip(("N", "Z", "C", "V"), (n, z, c, v)):
                            ctx.set(dut.flags[field], value)
                        for condition in range(15):  # NV deliberately unresolved
                            # MCMP DR0,DR0; literal opcode 20, no DUT encoding helper.
                            ctx.set(dut.instruction, 0xA0000000 | (condition << 23))
                            for valid in (0, 1):
                                ctx.set(dut.instr_valid, valid)
                                assert ctx.get(dut.exec_enable) == (
                                    valid and predicate(condition, n, z, c, v)
                                ), (condition, n, z, c, v, valid)
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


def snapshot(ctx, dut):
    return {
        "dr": [ctx.get(x) for x in dut.debug_dr_words],
        "cr": [[ctx.get(x) for x in row] for row in dut.debug_cr_words],
        "flags": tuple(ctx.get(dut.flags[f]) for f in ("N", "Z", "C", "V")),
        "nia": ctx.get(dut.nia),
    }


async def execute_data(ctx, dut, word):
    """Observe acceptance and first effects, with a bounded idle check."""
    ctx.set(dut.imem_valid, 0)
    # Fixed idle tick plus the explicit acceptance assertion below; there is
    # no public stall signal on ChurchCore.
    await ctx.tick()
    before = snapshot(ctx, dut)
    ctx.set(dut.imem_data, word)
    ctx.set(dut.imem_valid, 1)
    assert not ctx.get(dut.fault_valid), ("pre-retirement fault", word, before)
    assert not ctx.get(dut.retire_fault_valid)
    assert ctx.get(dut.retire_valid), ("not accepted", word, before)
    assert ctx.get(dut.retire_instr) == word
    assert ctx.get(dut.retire_nia) == before["nia"]
    for enable in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
        assert not ctx.get(enable), ("unexpected memory write", word, before)
    await ctx.tick()
    ctx.set(dut.imem_valid, 0)
    after = snapshot(ctx, dut)
    for _ in range(2):
        assert not ctx.get(dut.fault_valid), ("post-retirement fault", word, before, after)
        assert not ctx.get(dut.retire_valid), "Duplicate retirement"
        for enable in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
            assert not ctx.get(enable), "Delayed unauthorized write"
        await ctx.tick()
    assert snapshot(ctx, dut) == after, "State changed again after retirement"
    assert after["nia"] == before["nia"] + 4
    assert after["cr"] == before["cr"]
    return before, after


@pytest.mark.parametrize("word,expected,nzcv", [
    (0xAF084000, 0, (0, 1, 0, 0)),        # IADD DR1,DR0,#0
    (0xAF084001, 1, (0, 0, 0, 0)),        # IADD DR1,DR0,#1
    (0xAF087FFF, 16383, (0, 0, 0, 0)),    # maximum unsigned14 immediate
    (0xAF086000, 8192, (0, 0, 0, 0)),     # bit13 is magnitude, not sign
    (0xAF085FFF, 8191, (0, 0, 0, 0)),     # value immediately below bit13
    (0xB7084000, 0, (0, 1, 1, 0)),       # ISUB DR1,DR0,#0: no borrow
    (0xB7084001, 0xFFFFFFFF, (1, 0, 0, 0)),
    (0xB7085FFF, 0xFFFFE001, (1, 0, 0, 0)),  # 0 - 8191
    (0xB7086000, 0xFFFFE000, (1, 0, 0, 0)),  # 0 - 8192
    (0xB7087FFF, 0xFFFFC001, (1, 0, 0, 0)),  # 0 - 16383
])
def test_arithmetic_unsigned_immediate_literal_words(word, expected, nzcv):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        # Three real retirements leave the boot microcode window. Each setup
        # word is checked; boot_complete alone is insufficient.
        for _ in range(3):
            before, after = await execute_data(ctx, dut, 0xAF784000)
            expected_dr = before["dr"].copy()
            expected_dr[15] = 0
            assert after["dr"] == expected_dr
            assert after["flags"] == (0, 1, 0, 0)
        # Nonzero destination sentinel prevents an absent write looking correct.
        await execute_data(ctx, dut, 0xAF084007)
        before, after = await execute_data(ctx, dut, word)
        expected_dr = before["dr"].copy()
        expected_dr[1] = expected
        assert after["dr"] == expected_dr, (hex(word), before, after, expected_dr)
        assert after["flags"] == nzcv

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("word", [
    0xA8884001,  # IADDNE DR1,DR0,#1
    0x08888000,  # SAVENE through NULL CR1
    0x20EE8000,  # CHANGENE CR13: reserved operand must not be checked
    0xB8FFFFFF,  # BRANCHNE with maximal encoded index/magnitude
])
def test_false_condition_has_no_core_effect(word):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        _, sentinel = await execute_data(ctx, dut, 0xAF084007)
        assert sentinel["dr"][1] == 7
        _, zero = await execute_data(ctx, dut, 0xAF784000)
        assert zero["flags"] == (0, 1, 0, 0)  # NE must skip
        before, after = await execute_data(ctx, dut, word)
        assert after["dr"] == before["dr"]
        assert after["flags"] == before["flags"]

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_dr0_destination_and_source_destination_alias():
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        _, state = await execute_data(ctx, dut, 0xAF084007)
        assert state["dr"][1] == 7
        before, after = await execute_data(ctx, dut, 0xAF08C001)  # DR1←DR1+1
        expected = before["dr"].copy()
        expected[1] = 8
        assert after["dr"] == expected
        before, after = await execute_data(ctx, dut, 0xAF004001)  # DR0←1
        assert after["dr"] == before["dr"]
        assert after["dr"][0] == 0
        assert after["flags"] == (0, 0, 0, 0)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_approved_indexed_call_is_recognized():
    dut = ChurchDecoder()

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        # CALL AL: row DR2, indexed bit18, method DR3, both magnitudes zero.
        # Recognition only: this is not execution/mLoad coverage.
        ctx.set(dut.instruction, 0x1714C000)
        assert ctx.get(dut.exec_enable)
        assert not ctx.get(dut.fault_valid)
        assert ctx.get(dut.call_indexed) == 1
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


def test_bfext_runtime_position_is_not_ignored():
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        for word, reg, value in (
            (0xAF084007, 1, 7),
            (0xAF104004, 2, 4),
            (0xAF184020, 3, 32),
        ):
            _, after = await execute_data(ctx, dut, word)
            assert after["dr"][reg] == value
        # BFEXT DR1,DR3, position DR2+1, width1: extract bit5 of 32 => 1.
        before, after = await execute_data(ctx, dut, 0x97098821)
        expected = before["dr"].copy()
        expected[1] = 1
        assert after["dr"] == expected
        assert after["flags"] == (0, 0, 0, 0)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("preset,left,right,should_fault,z", [
    (15, 0x00000000, 0, False, 1),
    (15, 0x81000000, 0, False, 1),  # nonzero NULL, B set, type bits still 00
    (15, 0x02000001, 0, False, 0),
    (15, 0x06000001, 0, False, 0),  # Abstract is not NULL
    (31, 0x00000000, 0, True, None),
    (31, 0x02000001, 0, True, None),
    (14, 0x00000000, 0x00000000, True, None),
    (14, 0x01000000, 0x02000001, True, None),
    (14, 0x02000001, 0x81000000, True, None),
    (14, 0x02000001, 0x02000001, False, 1),
    (14, 0x02000001, 0x02000002, False, 0),
])
def test_tperm_null_exact_unit(preset, left, right, should_fault, z):
    """Check the execution unit, not encoding or full-core flag propagation."""
    dut = ChurchTperm()
    module = Module()
    module.submodules.tperm = dut
    caps = Array(Signal(96, name=f"fixture_cr{i}") for i in range(16))
    module.d.comb += dut.cr_rd_data.eq(caps[dut.cr_rd_addr])

    async def bench(ctx):
        ctx.set(caps[2], left | (0x1234 << 32) | (0x5678 << 64))
        ctx.set(caps[3], right | (0x4321 << 32) | (0x8765 << 64))
        initial = [ctx.get(cap) for cap in caps]
        ctx.set(dut.cr_target, 2)
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.preset, preset)
        ctx.set(dut.tperm_start, 1)
        await ctx.tick()
        ctx.set(dut.tperm_start, 0)
        for cycle in range(16):
            assert not ctx.get(dut.cr_wr_en)
            fault, complete = ctx.get(dut.tperm_fault), ctx.get(dut.tperm_complete)
            if fault or complete:
                assert bool(fault) == should_fault, (preset, hex(left), hex(right), cycle)
                if not should_fault:
                    assert complete
                    assert ctx.get(dut.tperm_z_result) == z
                assert [ctx.get(cap) for cap in caps] == initial
                return
            await ctx.tick()
        pytest.fail("TPERM neither completed nor faulted within 16 cycles")
    sim = Simulator(module)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_executed_change_cr13_faults_before_effects():
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, 0x276E8000)  # CHANGE AL CR13
        ctx.set(dut.imem_valid, 1)
        for cycle in range(32):
            for enable in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
                assert not ctx.get(enable), "Write before reserved-CR13 rejection"
            after = snapshot(ctx, dut)
            assert after["cr"] == before["cr"]
            assert after["dr"] == before["dr"]
            assert after["flags"] == before["flags"]
            if ctx.get(dut.fault_valid):
                assert ctx.get(dut.fault) == 0x0B, (
                    "CR13 must report INVALID_OP before operand validation",
                    ctx.get(dut.fault), cycle, before,
                )
                assert after["nia"] == before["nia"]
                return
            assert not ctx.get(dut.retire_valid), "Reserved CHANGE retired"
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
        pytest.fail("Reserved CHANGE did not fault within 32 cycles")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_permission_gate_generation_and_seal_independently():
    """Unit inputs only: not GT extraction, bounds, integrity calculation or mLoad."""
    dut = ChurchPermCheck()

    async def bench(ctx):
        ctx.set(dut.gt_in.as_value(), 0x12000001)  # Inform/R, Turing domain
        ctx.set(dut.required_perms, 1)
        ctx.set(dut.check_valid, 1)
        # Architectural inclusive limits cannot be assumed to be this unit's
        # internal count interface. Bounds belong in integrated access tests.
        ctx.set(dut.check_bounds, 0)
        ctx.set(dut.check_version, 1)
        ctx.set(dut.check_seal, 1)
        ctx.set(dut.check_domain_purity, 1)
        ctx.set(dut.limit, 31)
        ctx.set(dut.access_index, 0)
        ctx.set(dut.calculated_seal, 0xA569C387)
        ctx.set(dut.stored_seal, 0xA569C387)
        # Hardware tests equality even for encoded511; software separately
        # prohibits issuing retired generations.
        for generation in range(512):
            ctx.set(dut.gt_seq, generation)
            ctx.set(dut.stored_gt_seq, generation)
            assert ctx.get(dut.all_checks_pass)
            assert not ctx.get(dut.fault_valid)
            for bit in range(9):
                ctx.set(dut.stored_gt_seq, generation ^ (1 << bit))
                assert not ctx.get(dut.version_ok)
                assert ctx.get(dut.fault_valid)
                assert ctx.get(dut.gt_seq) == generation
            ctx.set(dut.stored_gt_seq, generation)
        for bit in range(32):
            ctx.set(dut.stored_seal, 0xA569C387 ^ (1 << bit))
            assert not ctx.get(dut.seal_valid)
            assert ctx.get(dut.fault_valid)
        ctx.set(dut.stored_seal, 0xA569C387)
        ctx.set(dut.required_perms, 2)  # W denied by R-only GT
        assert ctx.get(dut.fault_valid)
        assert not ctx.get(dut.perm_granted)
        assert ctx.get(dut.gt_in.as_value()) == 0x12000001

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("setup,operand,expected_index", [
    (0xAF584005, 0x003B, 8),   # DR11=5; +3
    (0xAF584005, 0x403B, 2),   # DR11=5; -3
    (0xAF584005, 0x0030, 3),   # DR0, +3; ignores DR11
    (0xAF584000, 0x401B, None),  # 0-1 underflow
    (0xB7584001, 0x001B, None),  # 0xFFFFFFFF+1 overflow
])
def test_load_index_first_access_and_no_writes(setup, operand, expected_index):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        _, setup_state = await execute_data(ctx, dut, setup)
        expected_base = {0xAF584005: 5, 0xAF584000: 0,
                         0xB7584001: 0xFFFFFFFF}[setup]
        assert setup_state["dr"][11] == expected_base
        # This isolated boot fixture establishes CR6 at byte0x400. This is a
        # fixture assertion, not a claim about the new Namespace boot layout.
        assert ctx.get(dut.debug_cr_words[6][1]) == 0x400
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, 0x07130000 | operand)  # LOAD AL CR2,CR6
        ctx.set(dut.imem_valid, 1)
        reads = []
        for cycle in range(64):
            for enable in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
                assert not ctx.get(enable), "LOAD or fault caused an unauthorized write"
            if ctx.get(dut.dmem_rd_en):
                reads.append(ctx.get(dut.dmem_addr))
            if ctx.get(dut.fault_valid):
                after = snapshot(ctx, dut)
                assert after["dr"] == before["dr"]
                assert after["cr"] == before["cr"]
                assert after["flags"] == before["flags"]
                assert after["nia"] == before["nia"]
                if expected_index is None:
                    assert reads == [], "Arithmetic failure reached memory"
                else:
                    assert reads and reads[0] == 0x400 + 4 * expected_index
                return
            request = ctx.get(dut.dmem_rd_en)
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            ctx.set(dut.dmem_rd_valid, request)
            # Selected NULL row intentionally faults before installation.
            ctx.set(dut.dmem_rd_data, 0)
        pytest.fail("LOAD did not produce the bounded expected rejection")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_return_keep_mask_decode_all_values():
    """H05 encoding coverage only; no assumption about unresolved frame packing."""
    dut = ChurchDecoder()

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        for keep_mask in range(4096):
            ctx.set(dut.instruction, 0x1F000000 | keep_mask)
            assert not ctx.get(dut.fault_valid)
            assert ctx.get(dut.exec_enable)
            assert ctx.get(dut.return_mask) == keep_mask
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("left,right,expected_flags", [
    (7, 1, (0, 0, 1, 0)),
    (7, 7, (0, 1, 1, 0)),
    (1, 7, (1, 0, 0, 0)),
])
def test_mcmp_literal_expected_flags_and_no_data_write(left, right, expected_flags):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        for prefix, reg, value in ((0xAF084000, 1, left), (0xAF104000, 2, right)):
            _, state = await execute_data(ctx, dut, prefix | value)
            assert state["dr"][reg] == value
        before, after = await execute_data(ctx, dut, 0xA7090000)
        assert after["dr"] == before["dr"]
        assert after["flags"] == expected_flags
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
