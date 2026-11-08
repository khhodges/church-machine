"""Local status RTL evidence; input pulses are fixtures, not monitor authority."""
import pytest
from amaranth.sim import Simulator

from hardware.thread_status_leds import ThreadStatusLEDs


def run(bench, clock_hz=16):
    dut = ThreadStatusLEDs(clock_hz=clock_hz)
    sim = Simulator(dut)
    sim.add_clock(1 / clock_hz)

    async def test(ctx):
        await bench(ctx, dut)

    sim.add_testbench(test)
    sim.run()


def test_count_wrap_stalls_and_active_low_pins():
    async def bench(ctx, dut):
        assert ctx.get(dut.count) == 0
        for n in range(1, 10):
            ctx.set(dut.change_complete, 1)
            await ctx.tick()
            assert ctx.get(dut.count) == n % 4
            assert ctx.get(dut.led_on) == n % 4
            assert ctx.get(dut.led_pins) == (n % 4) ^ 3
            ctx.set(dut.change_complete, 0)
            for _ in range(3):
                await ctx.tick()
                assert ctx.get(dut.count) == n % 4
    run(bench)


def test_fault_blinks_without_retirement_and_failed_change_does_not_count():
    async def bench(ctx, dut):
        ctx.set(dut.hard_fault, 1)
        # Failed CHANGE supplies no completion pulse.
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 1
        assert ctx.get(dut.led_on) == 3
        for n in range(1, 17):
            await ctx.tick()
            assert ctx.get(dut.led_on) == (3 if (n // 4) % 2 == 0 else 0)
            assert ctx.get(dut.count) == 0
        ctx.set(dut.hard_fault, 0)
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 1
    run(bench)


def test_progress_behind_fault_clear_preserves_count_and_fault_wins():
    async def bench(ctx, dut):
        ctx.set(dut.hard_fault, 1)
        await ctx.tick()
        ctx.set(dut.hard_fault, 0)
        ctx.set(dut.change_complete, 1)
        for n in range(1, 12):
            await ctx.tick()
            assert ctx.get(dut.count) == n % 4
            assert ctx.get(dut.fault_pending) == 1
        ctx.set(dut.change_complete, 0)
        ctx.set(dut.monitor_clear, 1)
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 0
        assert ctx.get(dut.led_on) == 3
        ctx.set(dut.hard_fault, 1)
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 1
        assert ctx.get(dut.count) == 3
        ctx.set(dut.hard_fault, 0)
        ctx.set(dut.monitor_clear, 0)
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 1
        ctx.set(dut.monitor_clear, 1)
        ctx.set(dut.change_complete, 1)
        await ctx.tick()
        assert ctx.get(dut.fault_pending) == 0
        assert ctx.get(dut.count) == 0
    run(bench)


def test_board_reset_initializes_indicator_and_count():
    async def bench(ctx, dut):
        ctx.set(dut.change_complete, 1)
        ctx.set(dut.hard_fault, 1)
        await ctx.tick()
        ctx.set(dut.board_reset, 1)
        await ctx.tick()
        assert ctx.get(dut.count) == 0
        assert ctx.get(dut.fault_pending) == 0
        assert ctx.get(dut.led_pins) == 3
    run(bench, clock_hz=4)


@pytest.mark.parametrize("clock_hz", [0, -4, 5, True, 4.0])
def test_invalid_clock_rejected(clock_hz):
    with pytest.raises(ValueError):
        ThreadStatusLEDs(clock_hz=clock_hz)
