"""Local RTL control-boundary tests; no board operations or executable verifier.

The harness uses real reset domains and the real fixed watchdog. Its counter
models program commits for reset/gating tests; it is not the ChurchCore.
"""
import pytest
import gc
import warnings
from amaranth import (ClockDomain, ClockSignal, DomainRenamer, Elaboratable,
                      Module, ResetSignal, Signal)
from amaranth.sim import Simulator
from fixed_watchdog import FixedWatchdog
from starter_lifecycle import StarterLifecycle


class BoundaryHarness(Elaboratable):
    def __init__(self):
        self.control = StarterLifecycle(image_words=4)
        self.watchdog = FixedWatchdog(clock_hz=20)
        self.commits = Signal(32)
        self.renew = Signal()

    def elaborate(self, platform):
        m = Module()
        # The reset controller is NOT reset by its own execution-reset output.
        m.domains += ClockDomain("sync", reset_less=True)
        m.domains += ClockDomain("execution")
        m.d.comb += [
            ClockSignal("execution").eq(ClockSignal("sync")),
            ResetSignal("execution").eq(self.control.execution_reset),
        ]
        m.submodules.control = self.control
        m.submodules.watchdog = DomainRenamer("execution")(self.watchdog)
        started = Signal()
        with m.If(~started):
            m.d.execution += started.eq(1)
        m.d.comb += [
            self.watchdog.execution_start.eq(~started & ~self.control.execution_reset),
            self.watchdog.transition_complete.eq(self.renew &
                                                ~self.control.execution_reset),
        ]
        with m.If(self.control.program_write_allowed &
                  ~self.watchdog.block_program_writes):
            m.d.sync += self.commits.eq(self.commits + 1)
        return m


def simulate(bench):
    dut = BoundaryHarness()
    sim = Simulator(dut)
    sim.add_clock(1 / 20)

    async def run(ctx):
        await bench(ctx, dut)

    sim.add_testbench(run)
    sim.run()


async def pulse(ctx, signal):
    ctx.set(signal, 1)
    await ctx.tick()
    ctx.set(signal, 0)


async def begin(ctx, d):
    ctx.set(d.begin_authorized, 1)
    await pulse(ctx, d.begin)
    ctx.set(d.begin_authorized, 0)
    assert ctx.get(d.state) == d.LOADING
    assert ctx.get(d.execution_reset)


async def data(ctx, d, n=4):
    for index in range(n):
        ctx.set(d.word_index, index)
        ctx.set(d.word_data, 0x1000 + index)
        ctx.set(d.word_valid, 1)
        assert ctx.get(d.memory_write)
        assert ctx.get(d.memory_address) == index
        assert ctx.get(d.memory_data) == 0x1000 + index
        await ctx.tick()
    ctx.set(d.word_valid, 0)


async def ready(ctx, d):
    await begin(ctx, d)
    await data(ctx, d)
    await pulse(ctx, d.finish)
    assert ctx.get(d.validate_request)
    ctx.set(d.validation_epoch, ctx.get(d.epoch))
    ctx.set(d.validation_ok, 1)
    await pulse(ctx, d.validation_valid)
    assert ctx.get(d.state) == d.READY
    assert ctx.get(d.execution_reset)


async def start(ctx, d):
    ctx.set(d.start_epoch, ctx.get(d.epoch))
    ctx.set(d.start_authorized, 1)
    await pulse(ctx, d.start)
    ctx.set(d.start_authorized, 0)
    assert ctx.get(d.state) == d.RUNNING


def test_long_upload_does_not_execute_or_deadlock_reset():
    async def bench(ctx, dut):
        d, w = dut.control, dut.watchdog
        await begin(ctx, d)
        await ctx.tick().repeat(250)  # 12.5 seconds, beyond full UART lower bound.
        assert ctx.get(d.state) == d.LOADING
        assert ctx.get(dut.commits) == 0
        assert not ctx.get(w.active)
        assert not ctx.get(w.expired)
        await data(ctx, d)
        await pulse(ctx, d.finish)
        await ctx.tick().repeat(50)
        assert ctx.get(dut.commits) == 0
        ctx.set(d.validation_epoch, ctx.get(d.epoch))
        ctx.set(d.validation_ok, 1)
        await pulse(ctx, d.validation_valid)
        await start(ctx, d)
        await ctx.tick().repeat(3)
        assert ctx.get(dut.commits) > 0
        assert ctx.get(w.active)
        assert not ctx.get(w.expired)
    simulate(bench)


def test_new_epoch_resets_expired_execution_watchdog_but_does_not_exempt_run():
    async def bench(ctx, dut):
        d, w = dut.control, dut.watchdog
        await ready(ctx, d)
        await start(ctx, d)
        await ctx.tick().repeat(25)
        assert ctx.get(w.expired)
        frozen = ctx.get(dut.commits)
        await ctx.tick().repeat(5)
        assert ctx.get(dut.commits) == frozen
        old_epoch = ctx.get(d.epoch)
        await ready(ctx, d)
        assert ctx.get(d.epoch) == old_epoch + 1
        assert not ctx.get(w.expired)
        assert ctx.get(dut.commits) == frozen
        await start(ctx, d)
        await ctx.tick().repeat(3)
        assert ctx.get(dut.commits) > frozen
        assert ctx.get(w.active)
    simulate(bench)


@pytest.mark.parametrize("failure", [
    "short", "reordered", "extra", "abort", "bad_validation",
    "stale_validation", "data_after_validation", "finish_with_data",
])
def test_failed_transfer_never_runs(failure):
    async def bench(ctx, dut):
        d = dut.control
        await begin(ctx, d)
        if failure == "short":
            await data(ctx, d, 2)
            await pulse(ctx, d.finish)
        elif failure == "reordered":
            ctx.set(d.word_index, 2)
            await pulse(ctx, d.word_valid)
        elif failure == "abort":
            await data(ctx, d, 2)
            await pulse(ctx, d.abort)
        else:
            await data(ctx, d)
            if failure in ("extra", "finish_with_data"):
                ctx.set(d.word_index, 4)
                ctx.set(d.finish, failure == "finish_with_data")
                await pulse(ctx, d.word_valid)
                ctx.set(d.finish, 0)
            else:
                await pulse(ctx, d.finish)
                ctx.set(d.validation_ok, failure != "bad_validation")
                ctx.set(d.validation_epoch, ctx.get(d.epoch) -
                        (failure == "stale_validation"))
                await pulse(ctx, d.validation_valid)
                if failure == "data_after_validation":
                    await pulse(ctx, d.word_valid)
        assert ctx.get(d.state) == d.FAILED
        ctx.set(d.start_authorized, 1)
        ctx.set(d.start_epoch, ctx.get(d.epoch))
        await pulse(ctx, d.start)
        await ctx.tick().repeat(30)
        assert ctx.get(d.state) == d.FAILED
        assert ctx.get(d.execution_reset)
        assert not ctx.get(d.memory_write)
        assert ctx.get(dut.commits) == 0
    simulate(bench)


def test_unauthorized_and_stale_controls_cannot_start_or_reset_running_program():
    async def bench(ctx, dut):
        d = dut.control
        await pulse(ctx, d.begin)
        assert ctx.get(d.state) == d.HELD
        await ready(ctx, d)
        await pulse(ctx, d.start)  # No authorization.
        assert ctx.get(d.state) == d.READY
        ctx.set(d.start_authorized, 1)
        ctx.set(d.start_epoch, ctx.get(d.epoch) - 1)
        await pulse(ctx, d.start)
        assert ctx.get(d.state) == d.READY
        await start(ctx, d)
        epoch = ctx.get(d.epoch)
        await pulse(ctx, d.begin)  # No authorization: no reset or watchdog kick.
        assert ctx.get(d.state) == d.RUNNING
        assert ctx.get(d.epoch) == epoch
        await pulse(ctx, d.start)
        assert not ctx.get(d.execution_reset)
        await ctx.tick().repeat(25)
        assert ctx.get(dut.watchdog.expired)
    simulate(bench)


def test_abort_wins_over_start_and_blocks_data_commit():
    async def bench(ctx, dut):
        d = dut.control
        await ready(ctx, d)
        ctx.set(d.start_epoch, ctx.get(d.epoch))
        ctx.set(d.start_authorized, 1)
        ctx.set(d.start, 1)
        ctx.set(d.abort, 1)
        assert not ctx.get(d.start_accepted)
        await ctx.tick()
        assert ctx.get(d.state) == d.FAILED
        ctx.set(d.start, 0)
        ctx.set(d.abort, 0)
        await begin(ctx, d)
        ctx.set(d.word_valid, 1)
        ctx.set(d.abort, 1)
        assert not ctx.get(d.memory_write)
        await ctx.tick()
        assert ctx.get(d.state) == d.FAILED
    simulate(bench)


def test_control_parameter_rejects_invalid_geometry():
    # Deliberately rejected constructors cannot be elaborated. Collect their
    # expected MustUse warnings locally, not during an unrelated later test.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=".*created but never used",
                                category=Warning)
        for value in (0, -1, 16385, True, 4.5):
            with pytest.raises(ValueError):
                StarterLifecycle(image_words=value)
        gc.collect()


def test_full_native_geometry_and_transfer_write_bounds():
    d = StarterLifecycle()
    sim = Simulator(d)
    sim.add_clock(1e-6)

    async def bench(ctx):
        await begin(ctx, d)
        await data(ctx, d, 16384)
        assert ctx.get(d.words_received) == 16384
        assert ctx.get(d.execution_reset)
        await pulse(ctx, d.finish)
        assert ctx.get(d.state) == d.VERIFYING
        assert not ctx.get(d.memory_write)
        ctx.set(d.validation_ok, 1)
        ctx.set(d.validation_epoch, ctx.get(d.epoch))
        await pulse(ctx, d.validation_valid)
        await start(ctx, d)
        # Stray data while executing cannot acquire the upload write port.
        ctx.set(d.word_valid, 1)
        ctx.set(d.word_index, 0)
        assert not ctx.get(d.memory_write)
        await ctx.tick()
        assert ctx.get(d.state) == d.RUNNING

    sim.add_testbench(bench)
    sim.run()
