"""Full-top still-absent control against the isolated handoff source.

Run with that source on PYTHONPATH. No source mutation, host memory insertion,
remote build, or device access. This is not a new physical diagnostic BIT.
"""
import pytest
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD, SYSTEM_GT


def test_full_top_resumes_and_retries_still_absent_call():
    words = [0] * 16384
    for address, word in guarded_fixture().items():
        words[address // 4] = word
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=62500,
        sim_boot_image_words=words, expected_boot_guard=GUARD,
        diagnostic_llr_stop=False,
    )

    async def bench(ctx):
        ctx.set(top.uart_rx_pin, 1)
        core = top.sim_core
        handoffs = 0
        changes = []
        for cycle in range(150000):
            assert not ctx.get(core.fault_valid), (
                cycle, ctx.get(core.fault), hex(ctx.get(core.imem_addr)))
            if ctx.get(core.retire_valid):
                nia = ctx.get(core.retire_nia)
                assert nia != 0x4008, "unavailable CALL retired"
                assert not 0x5000 <= nia < 0x5100, "absent body executed"
                if nia in (0x200C, 0x2010):
                    changes.append(nia)
            if ctx.get(core.llr_complete):
                handoffs += 1
                assert ctx.get(core.imem_addr) == 0x2010
                assert ctx.get(core.debug_cr_words[12][0]) == SYSTEM_GT
                assert [ctx.get(r) for r in core.debug_dr_words[:7]] == [
                    0, words[0], words[1], words[2], words[3], 6, 0x02070004]
                if handoffs == 2:
                    assert changes == [0x200C, 0x2010]
                    return
            await ctx.tick()
        pytest.fail(f"Observation limit: handoffs={handoffs}, changes={changes}")

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
