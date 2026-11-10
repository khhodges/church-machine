"""Timer-unit evidence only; does not certify core wiring or containment."""
import pytest
from amaranth.sim import Simulator
from fixed_watchdog import FixedWatchdog


@pytest.mark.parametrize("case", [
    "idle", "expire", "renew", "expiry_wins", "sticky_expiry",
])
def test_fixed_watchdog(case):
    dut = FixedWatchdog(clock_hz=20)
    sim = Simulator(dut)
    sim.add_clock(1 / 20)

    async def bench(ctx):
        if case == "idle":
            await ctx.tick().repeat(30)
            assert not ctx.get(dut.active)
            assert not ctx.get(dut.expired)
            return
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        ctx.set(dut.execution_start, 0)
        assert ctx.get(dut.remaining) == 20
        if case == "renew":
            # Multiple full intervals pass, but actual completion pulses renew.
            for _ in range(5):
                await ctx.tick().repeat(10)
                assert ctx.get(dut.remaining) == 10
                ctx.set(dut.transition_complete, 1)
                await ctx.tick()
                ctx.set(dut.transition_complete, 0)
                assert ctx.get(dut.remaining) == 20
                assert not ctx.get(dut.block_program_writes)
            return
        await ctx.tick().repeat(19)
        assert ctx.get(dut.remaining) == 1
        assert ctx.get(dut.expiry)
        assert ctx.get(dut.block_program_writes)
        if case == "expiry_wins":
            ctx.set(dut.transition_complete, 1)
        await ctx.tick()
        assert ctx.get(dut.expired)
        assert not ctx.get(dut.active)
        if case == "sticky_expiry":
            ctx.set(dut.execution_start, 1)
            ctx.set(dut.transition_complete, 1)
            await ctx.tick().repeat(40)
            assert ctx.get(dut.expired)
            assert ctx.get(dut.remaining) == 0
        assert ctx.get(dut.block_program_writes)

    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("hz", [25_000_000, 50_000_000])
def test_hardware_interval(hz):
    from amaranth.hdl import Fragment
    dut = FixedWatchdog(clock_hz=hz)
    assert dut.period == hz
    Fragment.get(dut, platform=None)
