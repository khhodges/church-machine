"""CR6.M grants only L permission: bounds and Namespace seals stay enforced."""
import pytest
from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.integrity32 import integrity32
from tests.hardware.test_mint_create_core import gt


@pytest.mark.parametrize("source,grant,index,broken_seal,expected", [
    (6, False, 0, False, 4), (7, True, 0, False, 4),
    (6, True, 1, False, 8), (6, True, 0, True, 10),
    (6, True, 0, False, None),
])
def test_bounded_cr6_l(source, grant, index, broken_seal, expected):
    dut = ChurchMLoad(enable_seal_check=True)
    memory = {0x1000: gt(3, 3), 48: 0x2000, 52: 7,
              56: integrity32(0x2000, 7) ^ int(broken_seal), 60: 0}

    async def bench(ctx):
        ctx.set(dut.sub_cr_src, source)
        ctx.set(dut.sub_cr_dst, 1)
        ctx.set(dut.sub_index, index)
        ctx.set(dut.sub_cr6_l, grant)
        ctx.set(dut.cr_rd_data.as_value(), gt(2, 32) | (0x1000 << 32))
        ctx.set(dut.cr15_namespace.as_value(), 63 << 64)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        # Permission belongs to the accepted request, not a later live signal.
        ctx.set(dut.sub_cr6_l, not grant)
        pending = None
        for _ in range(100):
            ctx.set(dut.mem_rd_valid, pending is not None)
            ctx.set(dut.mem_rd_data, memory.get(pending, 0))
            await ctx.delay(1e-9)
            pending = ctx.get(dut.mem_addr) if ctx.get(dut.mem_rd_en) else None
            if ctx.get(dut.sub_fault):
                assert ctx.get(dut.sub_fault_type) == expected
                return
            if ctx.get(dut.sub_done):
                assert expected is None
                return
            await ctx.tick()
        pytest.fail("mLoad did not terminate")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
