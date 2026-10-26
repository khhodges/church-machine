from amaranth.sim import Simulator
import pytest
from hardware.boot_pair_guard import BootPairGuard, validate_boot_guard
from hardware.hw_types import FaultType


@pytest.mark.parametrize("stage,version,accept,slot", [
    (0, 7, True, 0), (1, 19, True, 0),
    (0, 19, False, 1), (1, 7, False, 2),
    (0, 511, False, 1), (1, 511, False, 2),
])
def test_independent_stage_checks_latch_inputs(stage, version, accept, slot):
    # Synthetic unit fixture, not a generated/approved user configuration.
    dut = BootPairGuard(expected_guard=(7 << 9) | 19)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.start, 1)
        ctx.set(dut.thread_stage, stage)
        ctx.set(dut.observed_version, version)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.thread_stage, 1 - stage)
        ctx.set(dut.observed_version, 0)
        assert ctx.get(dut.done)
        assert bool(ctx.get(dut.accepted)) is accept
        assert bool(ctx.get(dut.fault)) is not accept
        assert ctx.get(dut.fault_slot) == slot
        assert ctx.get(dut.fault_type) == (FaultType.NONE if accept else FaultType.VERSION)
        await ctx.tick()
        assert not ctx.get(dut.done)

    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("guard", [-1, 1 << 18, 511, 511 << 9, True, None])
def test_guard_configuration_rejects_invalid_or_reserved_halves(guard):
    with pytest.raises(ValueError):
        validate_boot_guard(guard)
