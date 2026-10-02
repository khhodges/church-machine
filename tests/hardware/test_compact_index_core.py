"""Full-core compact-index access and fault containment, no saved fixtures."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.test_shift_ops import _boot, _exec, encode_iadd, encode_isub, encode_shl


def test_builtin_rom_loads_use_compact_literal_operands():
    from hardware.boot_rom import BOOT_PROGRAM, NUC_PROGRAM, WUKONG_NUC_PROGRAM
    assert BOOT_PROGRAM[0] & 0x7fff == 0
    assert NUC_PROGRAM[0] & 0x7fff == 0x50
    assert WUKONG_NUC_PROGRAM[0] & 0x7fff == 0x50
    assert WUKONG_NUC_PROGRAM[1] & 0x7fff == 0x60


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("opcode,base,operand,index", [
    (0, 5, 0x003b, 8), (0, 5, 0x403b, 2), (0, 5, 0x0030, 3),
    (0, 1026, 0x7ffb, 3),
    (0, 0xffffffff, 0x001b, None), (1, 0xffffffff, 0x001b, None),
    (0, 0, 0x401b, None), (1, 0, 0x401b, None),
    (0, 65536, 0x000b, None),  # Must not truncate to valid row zero.
    (0, 5, 0x000b, 5),
])
def test_compact_core(iot, opcode, base, operand, index):
    core = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        await _boot(ctx, core)
        # End the three-retirement privileged boot window before testing
        # ordinary capability bounds and NULL handling.
        for _ in range(3):
            await _exec(ctx, core, encode_iadd(0, 0, 0))
        if base == 0xffffffff:
            await _exec(ctx, core, encode_isub(11, 0, 1))
        elif base == 65536:
            await _exec(ctx, core, encode_iadd(11, 0, 1))
            await _exec(ctx, core, encode_shl(11, 11, 16))
        else:
            await _exec(ctx, core, encode_iadd(11, 0, base))
        ctx.set(core.defer_fault_reset, 1)
        before = [[ctx.get(w) for w in cr] for cr in core.debug_cr_words]
        dr = [ctx.get(r) for r in core.debug_dr_words]
        nia = ctx.get(core.nia)
        ctx.set(core.imem_data, (opcode << 27) | (14 << 23) | (2 << 19) | (6 << 15) | operand)
        ctx.set(core.imem_valid, 1)
        reads = []
        for cycle in range(64):
            if ctx.get(core.dmem_rd_en):
                reads.append(ctx.get(core.dmem_addr))
            assert not ctx.get(core.dmem_wr_en), (
                cycle, hex(ctx.get(core.dmem_addr)), hex(ctx.get(core.dmem_wr_data)))
            fault = ctx.get(core.fault_valid)
            code = ctx.get(core.fault)
            if fault:
                break
            request = ctx.get(core.dmem_rd_en)
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            ctx.set(core.dmem_rd_valid, request)
            ctx.set(core.dmem_rd_data, 0)  # NULL selected capability: stop before installation.
        else:
            pytest.fail("instruction did not fault within bounded execution window")
        assert [[ctx.get(w) for w in cr] for cr in core.debug_cr_words] == before
        assert [ctx.get(r) for r in core.debug_dr_words] == dr
        if index is None:
            assert code == FaultType.BOUNDS
            assert reads == []
        else:
            assert reads and reads[0] == 0x400 + 4 * index
        await ctx.tick()
        ctx.set(core.imem_valid, 0)
        assert ctx.get(core.nia) == nia, "Fault must preserve the failing NIA"

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("iot", [False, True])
def test_mcmp_signed_edges_and_false_predicate(iot):
    core = ChurchCore(iot_profile=iot)

    async def set_dr(ctx, reg, value):
        # Build each 32-bit value through real arithmetic instructions.
        await _exec(ctx, core, encode_iadd(reg, 0, 0))
        for shift in (24, 16, 8, 0):
            await _exec(ctx, core, encode_shl(reg, reg, 8))
            await _exec(ctx, core, encode_iadd(reg, reg, (value >> shift) & 255))

    async def bench(ctx):
        await _boot(ctx, core)
        for left, right in [(7, 7), (1, 0), (0, 1), (0xffffffff, 1),
                            (0x80000000, 1), (0x7fffffff, 0xffffffff)]:
            await set_dr(ctx, 2, left)
            await set_dr(ctx, 1, right)
            before = [ctx.get(r) for r in core.debug_dr_words]
            result = (left - right) & 0xffffffff
            expected = [result >> 31, int(result == 0), int(left >= right),
                        int(bool((left ^ right) & (left ^ result) & 0x80000000))]
            ctx.set(core.imem_data, 0xa7108000)
            ctx.set(core.imem_valid, 1)
            assert ctx.get(core.retire_valid)
            assert not ctx.get(core.fault_valid)
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            assert [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")] == expected
            assert [ctx.get(r) for r in core.debug_dr_words] == before
            await ctx.tick()
        # Never-executed LOAD must not evaluate its underflowing index.
        await set_dr(ctx, 11, 0)
        before = [ctx.get(r) for r in core.debug_dr_words]
        nia = ctx.get(core.nia)
        ctx.set(core.imem_data, (15 << 23) | (2 << 19) | (6 << 15) | 0x401b)
        ctx.set(core.imem_valid, 1)
        assert not ctx.get(core.fault_valid)
        assert not ctx.get(core.dmem_rd_en)
        assert not ctx.get(core.dmem_wr_en)
        await ctx.tick()
        ctx.set(core.imem_valid, 0)
        assert ctx.get(core.nia) == nia + 4
        assert [ctx.get(r) for r in core.debug_dr_words] == before

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()