"""Real CSI3 installation through hash/scrub/START to maintained-core recovery."""
import struct
from amaranth import Assert, Elaboratable, Module
from amaranth.sim import Simulator
from candidate_test_support import module
from test_candidate_core import prepared, _install_amaranth_elaboration_caches
from test_candidate_admission import load, send, header, inspect


class ObservedInstallation(Elaboratable):
    def __init__(self):
        self.words, binding = prepared(access=0x12000)
        self.top = module("candidate_core").CandidateCoreTop(self.words, binding, clock_hz=100)

    def elaborate(self, platform):
        m = Module()
        m.submodules.top = self.top
        core, admission = self.top.core, self.top.admission
        with m.If(admission.control.execution_reset):
            m.d.sync += [Assert(~core.imem_valid), Assert(~core.retire_valid),
                         Assert(~core.dmem_write_granted)]
        return m


def test_received_image_stays_stopped_until_start_then_executes():
    d = ObservedInstallation()
    _install_amaranth_elaboration_caches()
    sim = Simulator(d)
    sim.add_clock(1e-6)

    async def bench(ctx):
        a, core = d.top.admission, d.top.core
        ctx.set(a.transport.maintenance, 1)
        epoch = await load(ctx, a, struct.pack("<32768I", *d.words))
        assert ctx.get(a.control.state) == a.control.READY
        assert ctx.get(a.staging_ready)
        assert ctx.get(a.control.execution_reset)
        for address in (0x20000, 0x23ffc):
            await inspect(ctx, a, address, 0)
        await send(ctx, a.transport, header(3, epoch - 1))
        assert ctx.get(a.control.execution_reset)
        await send(ctx, a.transport, header(3, epoch))
        assert ctx.get(a.control.state) == a.control.RUNNING
        fault = None
        resumed = False
        for _ in range(2500):
            assert not ctx.get(core.fault_catastrophic)
            if ctx.get(core.retire_fault_valid) and not ctx.get(core.fault_entry_active):
                fault = (ctx.get(core.retire_nia), ctx.get(core.fault))
            if ctx.get(core.fault_entry_done):
                assert ctx.get(core.imem_addr) == 0x1a008
                resumed = True
            if resumed and ctx.get(core.retire_valid) and ctx.get(core.retire_nia) == 0x1c004:
                await ctx.tick()
                assert ctx.get(core.debug_dr_words[10]) == 1
                assert fault == (0x4018, 11)
                await inspect(ctx, a, 0x12000, 17)
                await inspect(ctx, a, 0x2000, d.words[0x2000 // 4])
                return
            await ctx.tick()
        raise AssertionError("Installed image did not execute retained Boot continuation")

    sim.add_testbench(bench)
    sim.run()
