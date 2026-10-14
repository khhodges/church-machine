"""Isolated elaborated-RTL evidence, not approval or physical-board acceptance."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.decoder import ChurchDecoder
from hardware.hw_types import FaultType
from hardware.sim_boot_helpers import boot_core

CANDIDATE = 0xF7000000


@pytest.mark.parametrize("iot", [False, True])
def test_candidate_decoder(iot):
    dut = ChurchDecoder(iot_profile=iot)

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        # WORD is data in RTL regardless of its payload/condition-shaped bits.
        for condition in range(16):
            ctx.set(dut.instruction, 0xF0000000 | (condition << 23))
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == FaultType.INVALID_OP
        ctx.set(dut.instruction, CANDIDATE)
        assert ctx.get(dut.fault_valid)

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("deferred", [False, True])
@pytest.mark.parametrize("negative", [False, True])
def test_candidate_core_capture_and_stop(iot, deferred, negative):
    dut = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, int(deferred))
        await boot_core(ctx, dut)
        # Execute real arithmetic to seed DRs/flags and leave the 3-retirement
        # boot window. No debug writes overlap the candidate instruction.
        for index in range(1, 16):
            ctx.set(dut.imem_data, 0xAF004000 | (index << 19) | index)
            ctx.set(dut.imem_valid, 1)
            assert not ctx.get(dut.fault_valid)
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            await ctx.tick()  # arithmetic unit's one-cycle busy/writeback stall
        for index in range(1, 16):
            assert ctx.get(dut.debug_dr_words[index]) == index
        # ISUB DR1, DR0, #0/#1: establish nonzero Z or N flags.
        ctx.set(dut.imem_data, 0xB7084000 | int(negative))
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.retire_valid)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()
        assert ctx.get(dut.flags.N) == int(negative)
        assert ctx.get(dut.flags.Z) == int(not negative)
        for index in range(12):
            ctx.set(dut.dbg_cr_wr_addr, index)
            ctx.set(dut.dbg_cr_wr_data.as_value(),
                    (0x08000000 | index) |
                    ((0x1000 + index * 16) << 32) |
                    ((0x123 + index) << 64))
            ctx.set(dut.dbg_cr_wr_en, 1)
            await ctx.tick()
        ctx.set(dut.dbg_cr_wr_en, 0)

        def state():
            return (
                tuple(tuple(ctx.get(w) for w in row) for row in dut.debug_cr_words),
                tuple(ctx.get(w) for w in dut.debug_dr_words),
                ctx.get(dut.flags.as_value()), ctx.get(dut.dbg_m_bit_state),
                ctx.get(dut.debug_isolated_m_flags),
            )

        before = state()
        origin = ctx.get(dut.nia)
        assert origin == 64, "fixture has retired 16 instructions (byte-addressed NIA)"
        ctx.set(dut.imem_data, CANDIDATE)
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.fault_valid)
        assert ctx.get(dut.fault) == FaultType.INVALID_OP
        assert ctx.get(dut.retire_fault_valid)
        assert ctx.get(dut.retire_nia) == origin
        assert ctx.get(dut.retire_instr) == CANDIDATE
        assert ctx.get(dut.retire_flags.as_value()) == before[2]
        assert state() == before
        assert not ctx.get(dut.dmem_wr_en)
        assert not ctx.get(dut.ns_wr_en)
        assert not ctx.get(dut.clist_wr_en)
        await ctx.tick()
        # Model the integration fetch gate, NOT an intrinsic core halt latch.
        ctx.set(dut.imem_valid, 0)
        assert ctx.get(dut.fault_instr) == CANDIDATE
        assert ctx.get(dut.fault_stage) == 1
        assert state() == before, "fault edge must preserve the pre-fault register bank"
        if deferred:
            for _ in range(20):
                assert ctx.get(dut.nia) == origin
                assert state() == before
                assert not ctx.get(dut.dmem_wr_en)
                assert not ctx.get(dut.ns_wr_en)
                assert not ctx.get(dut.clist_wr_en)
                await ctx.tick()
        else:
            assert ctx.get(dut.nia) == 0, "default integration resets, it does not return"
            await ctx.tick()
            assert state() != before, "pre-fault preservation is not post-reset preservation"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
