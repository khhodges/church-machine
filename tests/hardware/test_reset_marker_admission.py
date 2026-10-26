from amaranth.sim import Simulator
from hardware.reset_marker import ResetMarkerAdmission
from hardware.hw_types import FaultType


def test_marker_rejects_ordinary_code_and_replay_rearms_only_on_reset():
    dut = ResetMarkerAdmission()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.instruction, 0x27000001)
        ctx.set(dut.fetch_address, 4)
        ctx.set(dut.trusted_rom_fetch, 1)
        ctx.set(dut.namespace_admitted, 1)
        ctx.set(dut.issue, 1)
        assert ctx.get(dut.fault_type) == FaultType.INVALID_OP
        ctx.set(dut.issue, 0)
        ctx.set(dut.reset_enter, 1)
        await ctx.tick()
        ctx.set(dut.reset_enter, 0)
        ctx.set(dut.issue, 1)
        for signal, bad, good in [
            (dut.trusted_rom_fetch, 0, 1),
            (dut.namespace_admitted, 0, 1),
            (dut.fetch_address, 8, 4),
        ]:
            ctx.set(signal, bad)
            assert ctx.get(dut.fault)
            assert not ctx.get(dut.accepted)
            ctx.set(signal, good)
        assert ctx.get(dut.accepted)
        await ctx.tick()
        # No completion/success input exists: a later activation fault cannot
        # re-arm admission, even if the exact marker is issued again.
        assert ctx.get(dut.fault)
        assert not ctx.get(dut.available)
        ctx.set(dut.issue, 0)
        ctx.set(dut.reset_enter, 1)
        await ctx.tick()
        ctx.set(dut.reset_enter, 0)
        assert ctx.get(dut.available)
        ctx.set(dut.boot_handoff, 1)
        await ctx.tick()
        ctx.set(dut.boot_handoff, 0)
        ctx.set(dut.issue, 1)
        assert ctx.get(dut.fault)
        ctx.set(dut.instruction, 0x27060000)
        assert not ctx.get(dut.fault)
        assert not ctx.get(dut.accepted)

    sim.add_testbench(bench)
    sim.run()
