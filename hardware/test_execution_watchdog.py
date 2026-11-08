"""Unit contract only; no MMIO provisioning, core wiring or FPGA claim."""
import pytest
from amaranth import Module, ResetSignal, Signal
from amaranth.hdl import Fragment
from amaranth.sim import Simulator
from hardware.execution_watchdog import ExecutionWatchdog


def run(bench):
    dut = ExecutionWatchdog(clock_hz=16)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    async def wrapped(ctx):
        await bench(ctx, dut)
    sim.add_testbench(wrapped)
    sim.run()


async def write(ctx, dut, value):
    ctx.set(dut.control_write, 1)
    ctx.set(dut.control_data, value)
    assert ctx.get(dut.control_accepted)
    await ctx.tick()
    ctx.set(dut.control_write, 0)


@pytest.mark.parametrize("selector,cycles", enumerate((4, 8, 16, 32)))
def test_initial_control_and_exact_deadline(selector, cycles):
    async def bench(ctx, dut):
        assert ctx.get(dut.control_read) == 5
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        ctx.set(dut.execution_start, 0)
        assert not ctx.get(dut.active)  # bootstrap exemption
        await write(ctx, dut, selector << 1)
        assert ctx.get(dut.remaining) == cycles
        for remaining in range(cycles, 0, -1):
            assert ctx.get(dut.remaining) == remaining
            assert ctx.get(dut.expiry) == (remaining == 1)
            assert ctx.get(dut.block_program_writes) == (remaining == 1)
            await ctx.tick()
        assert ctx.get(dut.expired) and ctx.get(dut.block_program_writes)
    run(bench)


def test_selector_write_does_not_kick_or_change_active_deadline():
    async def bench(ctx, dut):
        await write(ctx, dut, 0)
        await write(ctx, dut, 6)
        assert ctx.get(dut.control_read) == 6
        assert ctx.get(dut.remaining) == 3
        await write(ctx, dut, 6)  # bit0 already zero: no exemption exit
        assert ctx.get(dut.remaining) == 2
        ctx.set(dut.transition_complete, 1)
        await ctx.tick()
        ctx.set(dut.transition_complete, 0)
        assert ctx.get(dut.remaining) == 32
    run(bench)


@pytest.mark.parametrize("event", ["renewal", "start"])
def test_same_edge_selector_and_approved_event_uses_new_value(event):
    async def bench(ctx, dut):
        await write(ctx, dut, 0)
        signal = dut.transition_complete if event == "renewal" else dut.execution_start
        ctx.set(signal, 1)
        await write(ctx, dut, 4)
        ctx.set(signal, 0)
        assert ctx.get(dut.remaining) == 16
    run(bench)


@pytest.mark.parametrize("action", ["renewal", "exempt", "invalid", "start"])
def test_expiry_wins_equality_and_remains_latched(action):
    async def bench(ctx, dut):
        await write(ctx, dut, 0)
        for _ in range(3):
            await ctx.tick()
        assert ctx.get(dut.expiry)
        ctx.set(dut.transition_complete, action == "renewal")
        ctx.set(dut.execution_start, action == "start")
        ctx.set(dut.control_write, action in ("exempt", "invalid"))
        ctx.set(dut.control_data, 7 if action == "exempt" else 0x80000007)
        assert not ctx.get(dut.control_accepted)
        assert ctx.get(dut.invalid_control) == (action == "invalid")
        await ctx.tick()
        assert ctx.get(dut.expired)
        assert ctx.get(dut.control_read) == 0
        for _ in range(5):
            await ctx.tick()
            assert ctx.get(dut.expired) and ctx.get(dut.block_program_writes)
            assert not ctx.get(dut.active)
    run(bench)


@pytest.mark.parametrize("bad", [8, 0x80000000, 0xFFFFFFFF])
def test_invalid_control_has_no_partial_effect(bad):
    async def bench(ctx, dut):
        await write(ctx, dut, 4)
        ctx.set(dut.control_write, 1)
        ctx.set(dut.control_data, bad)
        assert ctx.get(dut.invalid_control) and ctx.get(dut.control_rejected)
        await ctx.tick()
        assert ctx.get(dut.control_read) == 4
        assert ctx.get(dut.remaining) == 15
    run(bench)


@pytest.mark.parametrize("control", [0, 2, 4, 6, 1, 3, 5, 7])
def test_execution_reset_retains_configuration_not_elapsed_time(control):
    async def bench(ctx, dut):
        await write(ctx, dut, control)
        await ctx.tick()
        ctx.set(dut.execution_reset, 1)
        await ctx.tick()
        assert ctx.get(dut.control_read) == control
        assert not ctx.get(dut.active) and not ctx.get(dut.expired)
        ctx.set(dut.execution_reset, 0)
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        assert ctx.get(dut.active) == ((control & 1) == 0)
        assert ctx.get(dut.remaining) == (0 if control & 1 else dut.periods[control >> 1])
    run(bench)


def test_synchronous_domain_reset_preserves_control():
    dut = ExecutionWatchdog(clock_hz=16)
    m = Module()
    m.submodules.wdt = dut
    reset = Signal()
    m.d.comb += ResetSignal().eq(reset)
    sim = Simulator(m)
    sim.add_clock(1e-6)
    async def bench(ctx):
        await write(ctx, dut, 6)
        ctx.set(reset, 1)
        await ctx.tick()
        assert ctx.get(dut.control_read) == 6
        assert not ctx.get(dut.active) and not ctx.get(dut.expired)
        ctx.set(reset, 0)
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        assert ctx.get(dut.remaining) == 32
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("hz", [0, -4, 3, 5, 1.0, True])
def test_reject_unrepresentable_clock_counts(hz):
    with pytest.raises(ValueError):
        ExecutionWatchdog(clock_hz=hz)


@pytest.mark.parametrize("hz", [25_000_000, 50_000_000])
def test_actual_profile_periods(hz):
    dut = ExecutionWatchdog(clock_hz=hz)
    assert dut.periods == (hz // 4, hz // 2, hz, hz * 2)
    assert 2 ** len(dut.remaining) > hz * 2
    Fragment.get(dut, None)


def test_exemption_entry_and_exit_before_deadline():
    async def bench(ctx, dut):
        await write(ctx, dut, 0)
        await write(ctx, dut, 3)
        assert not ctx.get(dut.active)
        for _ in range(40):
            await ctx.tick()
            assert not ctx.get(dut.expiry) and not ctx.get(dut.expired)
        await write(ctx, dut, 6)  # exit exemption with new 2-second selection
        assert ctx.get(dut.active) and ctx.get(dut.remaining) == 32
    run(bench)


def test_reset_clears_expiry_but_preserves_selection():
    async def bench(ctx, dut):
        await write(ctx, dut, 0)
        for _ in range(4):
            await ctx.tick()
        assert ctx.get(dut.expired)
        ctx.set(dut.execution_reset, 1)
        await ctx.tick()
        ctx.set(dut.execution_reset, 0)
        assert not ctx.get(dut.expired)
        assert ctx.get(dut.control_read) == 0
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        assert ctx.get(dut.remaining) == 4
    run(bench)
