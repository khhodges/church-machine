"""Offline evidence for SR's blocked Outform materialization, not SR acceptance.

Exercise the actual mLoad FSM, without debug-register installation, a host
resolver, or the unrelated full-core CALL fixture. M must not bypass ingress.
"""
import pytest
from amaranth.sim import Simulator

from hardware.hw_types import FaultType
from hardware.mload import ChurchMLoad


@pytest.mark.parametrize("dst", [0, 1, 2, 3, 4, 7, 8, 9, 10])
@pytest.mark.parametrize("attributes", [
    (0, 0, 0),       # no permissions, zero version, entry B clear
    (2, 7, 0),       # R, nonzero version
    (14, 511, 0),    # RWX, maximum version
    (9, 19, 0),      # E
    (6, 23, 1),      # raw B-set input: M still cannot bypass the gate
])
def test_m_authorized_outform_cannot_materialize(dst, attributes):
    permissions, version, b = attributes
    word = 22 | (version << 16) | (2 << 25) | (permissions << 27) | (b << 31)
    dut = ChurchMLoad()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.sub_cr_src, 11)
        ctx.set(dut.sub_cr_dst, dst)
        ctx.set(dut.sub_index, 1)
        ctx.set(dut.sub_m_elevated, 1)
        # Private scratch RW capability, deliberately without L. M waives L,
        # not the fetched token's type check. Locations here are byte addresses.
        ctx.set(dut.cr_rd_data.as_value(),
                (25 | (1 << 25) | (6 << 27)) | (0x1000 << 32) | (2 << 64))
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        addresses = []
        # Model a one-cycle synchronous memory response. Namespace reads would
        # require a different address and fail this test: binding present,
        # missing, stale, or F-marked cannot affect this earlier rejection.
        pending = False
        for _ in range(40):
            ctx.set(dut.mem_rd_valid, pending)
            ctx.set(dut.mem_rd_data, word)
            assert not ctx.get(dut.cr_wr_en), "destination must not be overwritten"
            assert not ctx.get(dut.thread_wr_en), "Thread home must not change"
            assert not ctx.get(dut.mem_wr_en), "scratch/Namespace must not change"
            assert not ctx.get(dut.version_reset_en)
            assert not ctx.get(dut.outform_start_out), "no Lazy Load"
            assert not ctx.get(dut.sub_done), "rejection is not success"
            if ctx.get(dut.sub_fault):
                assert ctx.get(dut.sub_fault_type) == int(FaultType.OUTFORM_UNAUTH)
                assert addresses and set(addresses) == {0x1004}
                return
            pending = bool(ctx.get(dut.mem_rd_en))
            if pending:
                addresses.append(ctx.get(dut.mem_addr))
            await ctx.tick()
        pytest.fail("mLoad did not reach its Outform rejection")

    sim.add_testbench(bench)
    sim.run()
