import pytest
import asyncio
from types import SimpleNamespace
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.sim_boot_helpers import boot_core


@pytest.mark.parametrize("iot", [False, True])
def test_boot_completes_with_namespace_m_bits_initialized(iot):
    core = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        await boot_core(ctx, core)
        assert ctx.get(core.boot_complete)
        assert ctx.get(core.dbg_m_bit_state) == 1 << 12
        assert not ctx.get(core.imem_valid)

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_boot_timeout_reports_state():
    core = ChurchCore(iot_profile=True)

    async def bench(ctx):
        with pytest.raises(AssertionError, match="within 1 cycles: state="):
            await boot_core(ctx, core, max_cycles=1)
        assert not ctx.get(core.boot_start)

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("complete", [0, 1])
def test_boot_fault_is_never_accepted_as_completion(complete):
    names = ("imem_valid", "imem_data", "boot_start", "boot_state",
             "fault", "fault_valid", "boot_complete")
    core = SimpleNamespace(**{name: name for name in names})

    class Context:
        def __init__(self):
            self.values = dict(boot_state=4, fault=6, fault_valid=1,
                               boot_complete=complete)

        def set(self, signal, value):
            self.values[signal] = value

        def get(self, signal):
            return self.values[signal]

        async def tick(self):
            pass

    with pytest.raises(AssertionError, match="Boot fault at cycle 1"):
        asyncio.run(boot_core(Context(), core))