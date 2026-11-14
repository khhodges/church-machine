"""Disposable high-bank resolver boundaries; historical profiles unchanged."""
import pytest
from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.cload import ChurchCLoad
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("kind", ["mload", "cload"])
@pytest.mark.parametrize("capacity", [16384, 32768])
@pytest.mark.parametrize("base", [0x4800, 0x7ff0])
def test_explicit_capacity_preserves_descriptor_bounds(kind, capacity, base):
    authority, gt = 63 | (7 << 21), 0x4a070002
    mem = {32: base, 36: authority, 40: integrity32(base, authority), 44: 0,
           base * 4: (31 << 27) | (12 << 10) | 1,
           (base + 63) * 4: gt}
    mload = kind == "mload"
    dut = (ChurchMLoad if mload else ChurchCLoad)(
        enable_seal_check=True, resident_word_locations=True, capacity_words=capacity)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.cr15_namespace.as_value(), 0x02000001 | (255 << 64))
        start = dut.sub_start if mload else dut.cload_start
        done = dut.sub_done if mload else dut.cload_done
        fault = dut.sub_fault if mload else dut.cload_fault
        reason = dut.sub_fault_type if mload else dut.cload_fault_type
        if mload:
            ctx.set(dut.sub_direct, 1)
            ctx.set(dut.sub_direct_gt, gt)
            ctx.set(dut.sub_validate_only, 1)
        else:
            ctx.set(dut.e_gt, gt)
        ctx.set(start, 1)
        writes = {}
        for _ in range(100):
            if ctx.get(dut.cr_wr_en):
                writes[ctx.get(dut.cr_wr_addr)] = ctx.get(dut.cr_wr_data.as_value())
            if ctx.get(done) or ctx.get(fault):
                accepted = base + 63 < capacity
                assert bool(ctx.get(done)) == accepted
                if not accepted:
                    assert ctx.get(reason) == FaultType.BOUNDS
                    assert not writes
                elif mload:
                    assert (ctx.get(dut.resolved_cap.as_value()) >> 32) & 0xffffffff == base * 4
                else:
                    assert (writes[14] >> 32) & 0xffffffff == base * 4 + 4
                return
            read, address = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_addr)
            await ctx.tick()
            ctx.set(start, 0)
            ctx.set(dut.mem_rd_valid, read)
            ctx.set(dut.mem_rd_data, mem.get(address, 0) if read else 0)
        pytest.fail("Resolver did not terminate")

    sim.add_testbench(bench)
    sim.run()
