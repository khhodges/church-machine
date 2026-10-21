"""Direct-NULL LOAD wrapper/shared-mLoad/register-file integration."""
from amaranth import Elaboratable, Module
from amaranth.sim import Simulator
import pytest
from hardware.load import ChurchLoad
from hardware.mload import ChurchMLoad
from hardware.registers import ChurchRegisters


class Harness(Elaboratable):
    def __init__(self):
        self.load = ChurchLoad()
        self.ml = ChurchMLoad(enable_seal_check=False)
        self.regs = ChurchRegisters()

    def elaborate(self, platform):
        m = Module()
        m.submodules.load = l = self.load
        m.submodules.ml = u = self.ml
        m.submodules.regs = r = self.regs
        m.d.comb += [
            u.sub_start.eq(l.mload_start), u.sub_direct.eq(l.mload_direct),
            u.sub_direct_gt.eq(l.mload_direct_gt), u.sub_null_clear.eq(l.mload_direct),
            u.sub_cr_dst.eq(l.mload_cr_dst), u.sub_cr_src.eq(l.mload_cr_src),
            u.sub_index.eq(l.mload_index),
            l.mload_busy.eq(u.sub_busy), l.mload_done.eq(u.sub_done),
            l.mload_fault.eq(u.sub_fault), l.mload_fault_type.eq(u.sub_fault_type),
            r.cr_wr_en.eq(u.cr_wr_en), r.cr_wr_addr.eq(u.cr_wr_addr),
            r.cr_wr_data.eq(u.cr_wr_data),
            r.null_clear_en.eq(l.load_busy & l.mload_direct & u.cr_wr_en),
            r.null_clear_addr.eq(u.cr_wr_addr),
        ]
        return m


@pytest.mark.parametrize("dst", [0, 1, 5, 7, 8, 11, 6, 12, 13, 14, 15])
def test_direct_null(dst):
    dut = Harness()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        l, u, r = dut.load, dut.ml, dut.regs
        ctx.set(r.m_bit_device_wr_en, 1)
        ctx.set(r.m_bit_device_word, 0xffff)
        await ctx.tick()
        ctx.set(r.m_bit_device_wr_en, 0)
        ctx.set(l.cr_dst, dst)
        ctx.set(l.cr_src, 13)  # ignored source, no authority required
        ctx.set(l.null_clear, 1)
        ctx.set(l.load_start, 1)
        await ctx.tick()
        ctx.set(l.load_start, 0)
        ctx.set(l.cr_dst, 3)  # must retain accepted operands
        ctx.set(l.null_clear, 0)
        homes, writes = [], []
        for _ in range(30):
            assert not ctx.get(u.mem_rd_en), "no C-list or Namespace read"
            assert not ctx.get(u.mem_wr_en)
            if ctx.get(u.thread_wr_en):
                homes.append((ctx.get(u.thread_wr_idx), ctx.get(u.thread_wr_data)))
            if ctx.get(u.cr_wr_en):
                writes.append((ctx.get(u.cr_wr_addr), ctx.get(u.cr_wr_data.as_value())))
            if ctx.get(l.load_fault):
                assert dst == 6 or dst >= 12
                assert not homes and not writes
                assert ctx.get(r.m_bit_device_state) == 0xffff
                return
            if ctx.get(l.load_complete):
                assert dst != 6 and dst < 12
                assert homes == [(dst, 0)]
                assert writes == [(dst, 0)]
                await ctx.tick()
                assert ctx.get(r.m_bit_device_state) == (0xffff & ~(1 << dst))
                return
            await ctx.tick()
        raise AssertionError("LOAD did not terminate")
    sim.add_testbench(bench)
    sim.run()
