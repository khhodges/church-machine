"""Full-top still-absent control against the isolated handoff source.

Run with that source on PYTHONPATH. No source mutation, host memory insertion,
remote build, or device access. This is not a new physical diagnostic BIT.
"""
import pytest
from collections import deque
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD, SYSTEM_GT


@pytest.mark.parametrize("baud", [125000, 62500])
def test_full_top_resumes_and_retries_still_absent_call(baud):
    words = [0] * 16384
    for address, word in guarded_fixture().items():
        words[address // 4] = word
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=baud,
        sim_boot_image_words=words, expected_boot_guard=GUARD,
        diagnostic_llr_stop=False,
    )

    async def bench(ctx):
        ctx.set(top.uart_rx_pin, 1)
        core = top.sim_core
        handoffs = 0
        changes = []
        recent = deque(maxlen=16)
        original_user = None
        restored_user_checked = False
        for cycle in range(150000):
            recent.append({
                "cycle": cycle,
                "nia": hex(ctx.get(core.imem_addr)),
                "word": hex(ctx.get(core.imem_data)),
                "valid": ctx.get(core.imem_valid),
                "retire": ctx.get(core.retire_valid),
                "retire_nia": hex(ctx.get(core.retire_nia)),
                "llr_complete": ctx.get(core.llr_complete),
            })
            assert not ctx.get(core.fault_valid), (
                cycle, ctx.get(core.fault), hex(ctx.get(core.imem_addr)))
            if ctx.get(core.imem_addr) == 0x4008 and ctx.get(core.imem_valid):
                user = (
                    [ctx.get(r) for r in core.debug_dr_words],
                    ctx.get(core.flags.as_value()),
                    ctx.get(core.debug_cr_words[12][0]),
                )
                if handoffs == 0 and original_user is None:
                    original_user = user
                elif handoffs == 1 and not restored_user_checked:
                    assert original_user is not None
                    assert user == original_user, "USER state was not restored"
                    restored_user_checked = True
            if ctx.get(core.retire_valid):
                nia = ctx.get(core.retire_nia)
                assert nia != 0x4008, "unavailable CALL retired"
                assert not 0x5000 <= nia < 0x5100, "absent body executed"
                if nia in (0x200C, 0x2010):
                    changes.append(nia)
            if ctx.get(core.llr_complete):
                handoffs += 1
                # The first SYSTEM CHANGE was at 0x200C. The next was at
                # 0x2010, so its saved continuation is now 0x2014.
                assert ctx.get(core.imem_addr) == {
                    1: 0x2010, 2: 0x2014,
                }[handoffs], list(recent)
                assert ctx.get(core.debug_cr_words[12][0]) == SYSTEM_GT
                assert [ctx.get(r) for r in core.debug_dr_words[:7]] == [
                    0, words[0], words[1], words[2], words[3], 6, 0x02070004]
                if handoffs == 2:
                    assert changes == [0x200C, 0x2010]
                    assert restored_user_checked
                    return
            await ctx.tick()
        pytest.fail(f"Observation limit: handoffs={handoffs}, changes={changes}")

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
