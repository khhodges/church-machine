"""Approved NULL/EXACT contract; simulation evidence, not physical FPGA evidence."""
import pytest
from amaranth.sim import Simulator
from hardware.tperm import ChurchTperm
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.test_shift_ops import _boot, _exec, encode_iadd


NULLS = [0, 1, 0xf9ffffff]
NONNULLS = [0x02000000, 0x04000001, 0xfe550123]


@pytest.mark.parametrize("preset,left,right", [
    *[(15, x, 0) for x in NULLS + NONNULLS],
    *[(14, x, y) for x in NULLS + NONNULLS for y in NULLS + NONNULLS],
    (31, 0, 0), (31, 0x02000000, 0),
])
def test_unit(preset, left, right):
    dut = ChurchTperm()
    fault = (FaultType.TPERM_RSV if preset == 31 else
             FaultType.NULL_CAP if preset == 14 and (left in NULLS or right in NULLS) else None)

    async def bench(ctx):
        ctx.set(dut.cr_target, 2)
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.preset, preset)
        ctx.set(dut.tperm_start, 1)
        await ctx.tick()
        ctx.set(dut.tperm_start, 0)
        for _ in range(16):
            ctx.set(dut.cr_rd_data.as_value(),
                    (left if ctx.get(dut.cr_rd_addr) == 2 else right) | (123 << 32))
            assert not ctx.get(dut.cr_wr_en)
            if ctx.get(dut.tperm_fault):
                assert ctx.get(dut.fault_type) == fault
                assert not ctx.get(dut.tperm_complete)
                return
            if ctx.get(dut.tperm_complete):
                assert fault is None
                assert ctx.get(dut.tperm_z_result) == (left in NULLS if preset == 15 else left == right)
                return
            await ctx.tick()
        pytest.fail("TPERM failed to terminate")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("preset,dst,src", [(15, 8, 8), (15, 6, 6),
                                         (14, 8, 8), (14, 6, 8), (14, 8, 6),
                                         (14, 6, 6), (14, 6, 14), (31, 8, 8)])
@pytest.mark.parametrize("cond", [14, 15])
def test_core_predication_flags_and_fault_location(iot, preset, dst, src, cond):
    core = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        await _boot(ctx, core)
        for _ in range(3):
            await _exec(ctx, core, encode_iadd(0, 0, 0))
        cr = [[ctx.get(w) for w in r] for r in core.debug_cr_words]
        flags = [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")]
        nia = ctx.get(core.nia)
        assert cr[8][0] == 0
        word = (6 << 27) | (cond << 23) | (dst << 19) | (src << 15) | preset
        expected_fault = (FaultType.TPERM_RSV if preset == 31 else
                          FaultType.NULL_CAP if preset == 14 and 8 in (dst, src) else None)
        if cond == 15:
            expected_fault = None
        ctx.set(core.imem_data, word)
        ctx.set(core.imem_valid, 1)
        for _ in range(32):
            assert not ctx.get(core.dmem_wr_en)
            if ctx.get(core.retire_fault_valid):
                assert ctx.get(core.retire_fault_code) == expected_fault
                assert ctx.get(core.retire_nia) == nia
                assert ctx.get(core.retire_instr) == word
                assert [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")] == flags
                assert [[ctx.get(w) for w in r] for r in core.debug_cr_words] == cr
                return
            retired = ctx.get(core.retire_valid)
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            if retired:
                assert expected_fault is None
                z = int(dst == 8) if preset == 15 else int(cr[dst][0] == cr[src][0])
                assert [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")] == (
                    flags if cond == 15 else [1-z, z, 0, 0])
                assert [[ctx.get(w) for w in r] for r in core.debug_cr_words] == cr
                return
        pytest.fail("TPERM failed to retire")

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
