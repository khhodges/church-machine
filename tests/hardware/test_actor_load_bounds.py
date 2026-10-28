"""Exact absent-row check delegated by ordinary LOAD to hardware mLoad."""
from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.hw_types import FaultType


def test_missing_third_clist_row_is_bounds_before_fetch():
    dut = ChurchMLoad()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        # CR6 E-only with implicit L; two rows => inclusive cached limit 1.
        ctx.set(dut.sub_cr_src, 6)
        ctx.set(dut.sub_cr_dst, 1)
        ctx.set(dut.sub_cr6_l, 1)
        ctx.set(dut.sub_index, 2)
        ctx.set(dut.sub_start, 1)
        for _ in range(40):
            ctx.set(dut.cr_rd_data.as_value(), 0x4a000011 | (1 << 64))
            if ctx.get(dut.sub_fault):
                assert ctx.get(dut.sub_fault_type) == FaultType.BOUNDS == 8
                assert not ctx.get(dut.cr_wr_en)
                return
            assert not ctx.get(dut.sub_done)
            await ctx.tick()
        raise AssertionError("mLoad did not reject the absent C-list row")

    sim.add_testbench(bench)
    sim.run()
