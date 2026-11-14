"""Candidate SWITCH must use the same descriptor units/capacity as LOAD."""
import pytest
from amaranth.sim import Simulator
from hardware.switch import ChurchSwitch
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("base,capacity,success,source,source_m,register", [
    (0x10000, 32768, True, 0x1a000003, 0, 7),
    (0x10000, 16384, False, 0x1a000003, 0, 7),
    (0x20000, 32768, False, 0x1a000003, 0, 7),
    (0x10000, 32768, True, 0x4a000003, 1, 6),
    (0x10000, 32768, False, 0x4a000003, 0, 6),
    (0x10000, 32768, False, 0x4a000003, 1, 7)])
def test_switch_resolves_word_addressed_high_namespace(base, capacity, success, source, source_m, register):
    dut = ChurchSwitch(resident_word_locations=True, capacity_words=capacity)
    loc, auth = base//4, 255
    memory = {0x2000: 0x0200000a, 0xa0: loc, 0xa4: auth,
              0xa8: integrity32(loc, auth), 0xac: 0,
              base: 0xf8010100, base+4: base, base+8: 2, base+12: 0}
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.cr_src, register)
        ctx.set(dut.cr6_m, source_m)
        ctx.set(dut.target_m, 1)
        ctx.set(dut.cr_rd_data.as_value(), source | 0x2000 << 32)
        ctx.set(dut.cr15_namespace.as_value(), 0x02000001 | 255 << 64)
        ctx.set(dut.switch_start, 1)
        await ctx.tick()
        ctx.set(dut.switch_start, 0)
        # Admission captures the read view; later M changes cannot grant or
        # revoke a partially accepted operation.
        ctx.set(dut.cr6_m, not source_m)
        pending = None
        for _ in range(200):
            ctx.set(dut.mem_rd_valid, pending is not None)
            ctx.set(dut.mem_rd_data, memory.get(pending, 0))
            await ctx.delay(1e-9)
            pending = ctx.get(dut.mem_addr) if ctx.get(dut.mem_rd_en) else None
            if ctx.get(dut.handoff_start):
                assert success
                assert ctx.get(dut.incoming_namespace.as_value()) >> 32 & 0xffffffff == base
                return
            if ctx.get(dut.switch_fault):
                assert not success, ctx.get(dut.fault_type)
                return
            await ctx.tick()
        pytest.fail("SWITCH did not reach admission/rejection")

    sim.add_testbench(bench)
    sim.run()
