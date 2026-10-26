"""CALL's existing simulator contract: M boundary changes, not descriptors."""
from amaranth.sim import Simulator
from hardware.registers import ChurchRegisters


def test_successful_call_m_boundary_preserves_reserved_descriptor():
    dut = ChurchRegisters()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        sentinel = 456 << 32
        ctx.set(dut.cr_wr_en, 1)
        ctx.set(dut.cr_wr_addr, 13)
        ctx.set(dut.cr_wr_data.as_value(), sentinel)
        ctx.set(dut.m_bit_device_wr_en, 1)
        ctx.set(dut.m_bit_device_word, 0xffff)
        await ctx.tick()
        ctx.set(dut.cr_wr_en, 0)
        ctx.set(dut.m_bit_device_wr_en, 0)
        ctx.set(dut.cr_rd_addr, 13)
        await ctx.tick()
        assert ctx.get(dut.m_bit_device_state) == 0xffff
        ctx.set(dut.m_call_commit_en, 1)
        await ctx.tick()
        assert ctx.get(dut.m_bit_device_state) == 1 << 6
        assert ctx.get(dut.cr_rd_data.as_value()) == sentinel

    sim.add_testbench(bench)
    sim.run()
