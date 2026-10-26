"""Ordinary CHANGE converts only after authenticating stored descriptors."""
import pytest
from amaranth.sim import Simulator
from hardware.change import ChurchChange
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("version", [1, 256, 419])
@pytest.mark.parametrize("defect", [None, "stale", "seal", "free", "outside", "extent"])
def test_nonzero_generation_and_stored_integrity(version, defect):
    dut = ChurchChange(resident_word_locations=True)
    location = 16384 if defect == "outside" else 16380 if defect == "extent" else 2304
    authority = 255 | ((version ^ 1 if defect == "stale" else version) << 17)
    if defect == "free":
        authority |= 1 << 31
    seal = integrity32(location, authority) ^ int(defect == "seal")
    memory = {0xb0: location, 0xb4: authority, 0xb8: seal, 0xbc: 0}
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.ordinary, 1)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.cr_dst, 0)
        ctx.set(dut.cr_rd_data.as_value(), 0x0200000b | (version << 16))
        ctx.set(dut.cr15_namespace.as_value(), 0x1a000001 | (255 << 64))
        ctx.set(dut.change_start, 1)
        await ctx.tick()
        ctx.set(dut.change_start, 0)
        for _ in range(100):
            assert not ctx.get(dut.mem_wr_en)
            assert not ctx.get(dut.cr_wr_en)
            assert not ctx.get(dut.thread_wr_en)
            requested, address = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_rd_addr)
            if requested and address == 0x2400:
                assert defect is None
                return
            if ctx.get(dut.change_fault):
                assert defect is not None
                assert ctx.get(dut.fault_type) == 29
                return
            if requested:
                assert address in memory, hex(address)
            await ctx.tick()
            ctx.set(dut.mem_rd_valid, requested)
            ctx.set(dut.mem_rd_data, memory.get(address, 0))
        pytest.fail("Ordinary CHANGE descriptor deadline")

    sim.add_testbench(bench)
    sim.run()
