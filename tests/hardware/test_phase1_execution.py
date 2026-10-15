"""H01/H02/H04/H07/H09: approved state transitions, independent word oracle."""
import itertools
import pytest
from amaranth.sim import Simulator
from hardware.decoder import ChurchDecoder
from phase1_support import (
    MASK, arithmetic, execute, flags, predicate, run_core, set_cr, set_dr, snapshot, word,
)


@pytest.mark.parametrize("op", [20, 21, 22])
@pytest.mark.parametrize("reg", range(16))
def test_h01_arithmetic_registers_aliases_and_edges(op, reg):
    async def bench(ctx, core):
        for left, right in [(0, 0), (0, 1), (MASK, 1), (0x7fffffff, 1),
                            (0x80000000, 1), (1, MASK), (0x80000000, MASK)]:
            src = reg or 1
            rhs = 2 if src != 2 else 3
            await set_dr(ctx, core, src, left)
            await set_dr(ctx, core, rhs, right)
            before, caps, _ = snapshot(ctx, core)
            result, nzcv = arithmetic(before[src], before[rhs], op != 21)
            instruction = word(op, src if op == 20 else reg,
                               rhs if op == 20 else src, 0 if op == 20 else rhs)
            await execute(ctx, core, instruction)
            expected = list(before)
            if op != 20 and reg:
                expected[reg] = result
            assert snapshot(ctx, core) == (tuple(expected), caps, nzcv)
        # Both read operands and destination are the same register.
        await set_dr(ctx, core, src, 0x80000000)
        before, caps, _ = snapshot(ctx, core)
        result, nzcv = arithmetic(before[reg], before[reg], op != 21)
        await execute(ctx, core, word(op, reg, reg, 0 if op == 20 else reg))
        expected = list(before)
        if reg and op != 20:
            expected[reg] = result
        assert snapshot(ctx, core) == (tuple(expected), caps, nzcv)
    run_core(bench)


@pytest.mark.parametrize("op", [21, 22])
@pytest.mark.parametrize("immediate", [0, 1, 8191, 8192, 16383])
def test_h01_unsigned_immediate(op, immediate):
    async def bench(ctx, core):
        await set_dr(ctx, core, 3, 0x7fffffff)
        before, caps, _ = snapshot(ctx, core)
        result, nzcv = arithmetic(before[3], immediate, op == 22)
        await execute(ctx, core, word(op, 3, 3, 0x4000 | immediate))
        expected = list(before)
        expected[3] = result
        assert snapshot(ctx, core) == (tuple(expected), caps, nzcv)
    run_core(bench)


@pytest.mark.parametrize("op,asr", [(24, False), (25, False), (25, True)])
def test_h01_shift_results_not_unapproved_flags(op, asr):
    async def bench(ctx, core):
        for reg, amount, value in itertools.product(range(16), (0, 1, 31),
                                                    (0, 1, MASK, 0x80000000, 0x7fffffff)):
            src = reg or 1
            await set_dr(ctx, core, src, value)
            before, caps, _ = snapshot(ctx, core)
            signed = value - (1 << 32) if asr and value >> 31 else value
            result = ((value << amount) if op == 24 else signed >> amount) & MASK
            await execute(ctx, core, word(op, reg, src, amount | (32 if asr else 0)))
            expected = list(before)
            if reg:
                expected[reg] = result
            after = snapshot(ctx, core)
            assert after[:2] == (tuple(expected), caps)
    run_core(bench)


def test_h02_all_defined_predicates_all_nzcv():
    dut = ChurchDecoder()
    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        for n, z, c, v in itertools.product((0, 1), repeat=4):
            for key, value in zip("NZCV", (n, z, c, v)):
                ctx.set(dut.flags[key], value)
            for cond, expected in enumerate(predicate(n, z, c, v)):
                ctx.set(dut.instruction, word(21, 1, 0, 0x4001, cond))
                assert ctx.get(dut.exec_enable) == expected, (n, z, c, v, cond)
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("instruction", [
    word(0, 13, 0, 0x4010, 1), word(1, 13, 0, 0x4010, 1),
    word(4, 0, 13, 0, 1), word(5, 0, 13, 0x4010, 1),
    word(6, 0, 0, 14, 1), word(6, 0, 0, 31, 1),
    word(16, 1, 0, 0x4010, 1), word(17, 1, 0, 0x4010, 1),
    word(18, 1, 1, 0, 1), word(19, 1, 1, 0x7fff, 1),
])
def test_h02_false_condition_has_no_operand_effect(instruction):
    async def bench(ctx, core):
        await execute(ctx, core, 0xaf004000)  # Z=1, so NE is false.
        before = snapshot(ctx, core)
        await execute(ctx, core, instruction)
        assert snapshot(ctx, core) == before
    run_core(bench)


@pytest.mark.parametrize("op", [18, 19])
@pytest.mark.parametrize("index,mag,subtract,width", [
    (0, 0, False, 1), (0, 0, False, 31), (0, 31, False, 1),
    (0, 31, False, 31), (0, 0, False, 0), (1, 1, True, 31),
    (0, 1, True, 1), (MASK, 1, False, 1),
    (0x7fffffff, 31, False, 1), (0x80000000, 31, True, 1),
])
@pytest.mark.parametrize("alias", [False, True])
def test_h04_checked_position_and_preserved_bits(op, index, mag, subtract, width, alias):
    async def bench(ctx, core):
        await set_dr(ctx, core, 1, 0xa5a5a5a5)
        await set_dr(ctx, core, 2, 0x81234567)
        await set_dr(ctx, core, 3, index)
        dst = 3 if alias else 1
        src = dst if alias else 2
        before, caps, oldflags = snapshot(ctx, core)
        position = index + (-mag if subtract else mag)
        valid = width != 0 and 0 <= position and position + width <= 32
        instruction = word(op, dst, src, (int(subtract) << 14) | (3 << 10) |
                           (mag << 5) | width)
        await execute(ctx, core, instruction, fault=not valid)
        if not valid:
            assert snapshot(ctx, core) == (before, caps, oldflags)
        else:
            mask = (1 << width) - 1
            result = ((before[src] >> position) & mask) if op == 18 else (
                (before[dst] & ~(mask << position)) | ((before[src] & mask) << position))
            expected = list(before)
            expected[dst] = result
            assert snapshot(ctx, core) == (tuple(expected), caps,
                                          (result >> 31, int(result == 0), 0, 0))
    run_core(bench)


@pytest.mark.parametrize("a,b,preset,fault", [
    (0, 0, 15, False), (6, 0, 15, False), (6, 6, 14, False),
    (6, 14, 14, False), (0, 6, 14, True), (6, 0, 14, True),
    (0, 0, 14, True), (6, 0, 31, True),
])
def test_h07_tperm_commit_and_first_fault(a, b, preset, fault):
    async def bench(ctx, core):
        before, caps, oldflags = snapshot(ctx, core)
        await execute(ctx, core, word(6, a, b, preset), fault=fault)
        if fault:
            expected = oldflags
        else:
            z = int((caps[a][0] >> 25 & 3) == 0) if preset == 15 else int(caps[a][0] == caps[b][0])
            expected = (1-z, z, 0, 0)
        assert snapshot(ctx, core) == (before, caps, expected)
    run_core(bench)


@pytest.mark.parametrize("instruction", [0x27068000, 0x2f068000])
def test_h09_reserved_cr13_fault_before_effect(instruction):
    async def bench(ctx, core):
        before = snapshot(ctx, core)
        await execute(ctx, core, instruction, fault=True)
        assert snapshot(ctx, core) == before
    run_core(bench)


@pytest.mark.parametrize("subtract", [False, True])
@pytest.mark.parametrize("index,magnitude", [
    (0, 0), (0, 1), (0, 262143), (1, 1), (0x7fffffff, 262143),
    (0x80000000, 1), (MASK, 262143),
])
def test_h03_branch_nonwrapping_target(subtract, index, magnitude):
    async def bench(ctx, core):
        await set_dr(ctx, core, 1, index)
        await set_cr(ctx, core, 14, 0x42000002, 4, 4095)
        before = snapshot(ctx, core)
        nia = ctx.get(core.nia)
        base = before[1][14][1]
        limit = before[1][14][2] & 0x1fffff
        target = nia + 4 * (index + (-magnitude if subtract else magnitude))
        valid = 0 <= target <= MASK and base <= target <= base + 4 * limit
        instruction = 0xbf080000 | (int(subtract) << 18) | magnitude
        await execute(ctx, core, instruction, fault=not valid, next_nia=target)
        assert snapshot(ctx, core) == before
    run_core(bench)


@pytest.mark.parametrize("op", [18, 19])
def test_h04_dr0_discards_result_but_sets_result_flags(op):
    async def bench(ctx, core):
        await set_dr(ctx, core, 2, MASK)
        before, caps, _ = snapshot(ctx, core)
        await execute(ctx, core, word(op, 0, 2, 31))
        assert snapshot(ctx, core) == (before, caps, (0, 0, 0, 0))
    run_core(bench)


@pytest.mark.parametrize("subtract", [False, True])
def test_h09_switch_without_cr15_m_has_no_effect(subtract):
    async def bench(ctx, core):
        await set_cr(ctx, core, 6, 0x1a000002, 0x2000, 31)
        await set_dr(ctx, core, 11, 1)
        ctx.set(core.dbg_m_bit_word, 1 << 6)  # source M cannot authorize SWITCH
        ctx.set(core.dbg_m_bit_wr_en, 1)
        await ctx.tick()
        ctx.set(core.dbg_m_bit_wr_en, 0)
        before = snapshot(ctx, core)
        await execute(ctx, core, word(5, 0, 6, int(subtract) << 14 | 0x1b), fault=True)
        assert snapshot(ctx, core) == before
        assert ctx.get(core.dbg_m_bit_state) == 1 << 6
    run_core(bench)


@pytest.mark.parametrize("gap", [
    "H02 NV/reserved condition and malformed reserved fields",
    "H01 SHL/SHR flags and unused shift bits",
    "H07 ordinary TPERM mode/preset/modifier packing and precedence",
    "H05 H08 H09 protected Thread frame/indicator packing",
    "H05 CALL/RETURN M-bit effects with untouched CR13",
    "H05 LAMBDA continuation representation",
    "H06 unspecified multi-fault precedence and unspecified numeric fault codes",
])
def test_oracle_closure_blocked(gap):
    pytest.skip("BLOCKED by instruction-set.md §Oracle closure: " + gap)
