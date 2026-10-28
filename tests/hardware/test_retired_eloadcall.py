"""Retired fused CALL cannot mutate architecture, even via direct unit start."""
import pytest
from amaranth.sim import Simulator
from hardware.fused_unit import ChurchELoadCall
from hardware.hw_types import FaultType
from hardware.decoder import ChurchDecoder


@pytest.mark.parametrize("iot_profile", [False, True])
@pytest.mark.parametrize("opcode", [8, 9])
def test_decoder_rejects_retired_fused_opcodes(iot_profile, opcode):
    dut = ChurchDecoder(iot_profile=iot_profile)
    sim = Simulator(dut)

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        for selector in (0, 1, 127):
            ctx.set(dut.instruction, (opcode << 27) | (14 << 23) | (selector << 5))
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == FaultType.INVALID_OP

    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("selector", [0, 1, 127, 32767])
def test_retired_eloadcall_faults_without_side_effects(selector):
    dut = ChurchELoadCall()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        for _ in range(2):  # refusal remains repeatable after returning idle
            ctx.set(dut.call_imm, selector)
            ctx.set(dut.start, 1)
            await ctx.tick()
            ctx.set(dut.start, 0)
            assert ctx.get(dut.fault)
            assert ctx.get(dut.fault_type) == FaultType.INVALID_OP
            for _ in range(4):
                for signal in (dut.complete, dut.nia_set, dut.cr_wr_en,
                               dut.mem_wr_en, dut.mem_rd_en, dut.thread_wr_en,
                               dut.lazy_resolve_irq, dut.dr_clear_mask,
                               dut.cr_clear_mask):
                    assert ctx.get(signal) == 0
                await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
