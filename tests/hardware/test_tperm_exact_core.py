"""EXACT is comparison, not a trapping credential assertion."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.test_shift_ops import _boot, _exec, encode_iadd
from hardware.tperm import ChurchTperm


@pytest.mark.parametrize("delta", [0, 1, 1 << 16, 1 << 28, 1 << 31])
def test_exact_checks_all_gt_bits_without_capability_rewrite(delta):
    dut = ChurchTperm()
    target = 0x1a000002
    reference = target ^ delta
    assert reference

    async def bench(ctx):
        ctx.set(dut.cr_target, 1)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.preset, 14)
        ctx.set(dut.tperm_start, 1)
        await ctx.tick()
        ctx.set(dut.tperm_start, 0)
        for _ in range(16):
            is_target = ctx.get(dut.cr_rd_addr) == 1
            # Only word0 is compared; different descriptor locations are irrelevant.
            ctx.set(dut.cr_rd_data.as_value(),
                    (target if is_target else reference) |
                    ((0x100 if is_target else 0x200) << 32))
            assert not ctx.get(dut.tperm_fault)
            assert not ctx.get(dut.cr_wr_en)
            if ctx.get(dut.tperm_complete):
                assert ctx.get(dut.tperm_z_result) == int(delta == 0)
                return
            await ctx.tick()
        pytest.fail("EXACT did not complete")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("source,cond", [(6, 14), (14, 14), (14, 15)])
def test_exact_completes_without_state_writes(iot, source, cond):
    core = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        await _boot(ctx, core)
        for _ in range(3):
            await _exec(ctx, core, encode_iadd(0, 0, 0))
        cr = [[ctx.get(w) for w in reg] for reg in core.debug_cr_words]
        dr = [ctx.get(r) for r in core.debug_dr_words]
        flags = [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")]
        assert cr[6][0] and cr[source][0]
        expected_z = int(cr[6][0] == cr[source][0])
        nia = ctx.get(core.nia)
        word = (6 << 27) | (cond << 23) | (6 << 19) | (source << 15) | 14
        ctx.set(core.imem_data, word)
        ctx.set(core.imem_valid, 1)
        for cycle in range(32):
            assert not ctx.get(core.fault_valid)
            assert not ctx.get(core.retire_fault_valid)
            assert not ctx.get(core.dmem_rd_en)
            assert not ctx.get(core.dmem_wr_en)
            retired = ctx.get(core.retire_valid)
            if retired:
                assert ctx.get(core.retire_instr) == word
                assert ctx.get(core.retire_nia) == nia
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            if retired:
                break
        else:
            pytest.fail("EXACT failed to retire within 32 cycles")
        assert ctx.get(core.nia) == nia + 4
        assert [[ctx.get(w) for w in reg] for reg in core.debug_cr_words] == cr
        assert [ctx.get(r) for r in core.debug_dr_words] == dr
        actual = [ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")]
        assert actual == (flags if cond == 15 else [1 - expected_z, expected_z, 0, 0])

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()