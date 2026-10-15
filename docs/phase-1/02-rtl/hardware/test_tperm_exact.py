"""ISA word0 comparison oracle; D3 mode/B/NULL questions are not resolved here."""
import pytest
from amaranth import Array, Module, Signal
from amaranth.sim import Simulator
from hardware.tperm import ChurchTperm
from hardware.core import ChurchCore
from hardware.test_shift_ops import _boot, _exec, encode_iadd


def test_exact_all_word0_bits_and_ignored_metadata():
    dut = ChurchTperm()
    m = Module()
    m.submodules.dut = dut
    caps = Array(Signal(96, name=f"cap{i}") for i in range(16))
    m.d.comb += dut.cr_rd_data.eq(caps[dut.cr_rd_addr])

    async def bench(ctx):
        base = 0x7e550123
        vectors = [(base, base, 1), (0xfe550123, 0xfe550123, 1)]
        vectors += [(base, base ^ (1 << bit), 0) for bit in range(32)]
        for left, right, z in vectors:
            ctx.set(caps[2], left | (0x12345678 << 32) | (0xabcdef01 << 64))
            ctx.set(caps[3], right | (0xfedcba98 << 32) | (0x76543210 << 64))
            before = [ctx.get(c) for c in caps]
            ctx.set(dut.cr_target, 2)
            ctx.set(dut.cr_src, 3)
            ctx.set(dut.preset, 14)
            ctx.set(dut.tperm_start, 1)
            await ctx.tick()
            ctx.set(dut.tperm_start, 0)
            for _ in range(12):
                assert not ctx.get(dut.tperm_fault)
                assert not ctx.get(dut.cr_wr_en)
                if ctx.get(dut.tperm_complete):
                    assert ctx.get(dut.tperm_z_result) == z
                    break
                await ctx.tick()
            else:
                pytest.fail("EXACT did not complete")
            assert [ctx.get(c) for c in caps] == before
            await ctx.tick()
            await ctx.tick()

    sim = Simulator(m)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("iot", [False, True])
def test_core_exact_completion_and_predication(iot):
    core = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        await _boot(ctx, core)
        for _ in range(3):
            await _exec(ctx, core, encode_iadd(7, 0, 123))
        # Independent boot fixture literals; no NULL or preset-B cases.
        assert ctx.get(core.debug_cr_words[6][0]) == 0x1a000002
        assert ctx.get(core.debug_cr_words[14][0]) == 0x42000001
        for src, cond, z in [(6, 14, 1), (14, 14, 0), (6, 0, None),
                             (14, 15, None), (6, 1, 1), (14, 1, None)]:
            cr = [[ctx.get(w) for w in r] for r in core.debug_cr_words]
            dr = [ctx.get(r) for r in core.debug_dr_words]
            flags = [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")]
            nia = ctx.get(core.nia)
            ctx.set(core.imem_data, (6 << 27) | (cond << 23) | (6 << 19) | (src << 15) | 14)
            ctx.set(core.imem_valid, 1)
            for cycle in range(32):
                assert not ctx.get(core.fault_valid)
                assert not ctx.get(core.dmem_wr_en)
                assert not ctx.get(core.dmem_rd_en)
                retired = ctx.get(core.retire_valid)
                await ctx.tick()
                ctx.set(core.imem_valid, 0)
                if retired:
                    break
            else:
                pytest.fail("EXACT failed to retire")
            assert ctx.get(core.nia) == nia + 4
            assert [[ctx.get(w) for w in r] for r in core.debug_cr_words] == cr
            assert [ctx.get(r) for r in core.debug_dr_words] == dr
            assert [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")] == (
                flags if z is None else [1-z, z, 0, 0])
            await ctx.tick()

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()