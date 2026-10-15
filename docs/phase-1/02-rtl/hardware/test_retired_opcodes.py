import pytest
from amaranth.sim import Simulator
from hardware.decoder import ChurchDecoder
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.sim_boot_helpers import boot_core


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("opcode", [8, 9])
def test_retired_decoder_rejects_every_condition(iot, opcode):
    dut = ChurchDecoder(iot_profile=iot)

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        for condition in range(16):
            ctx.set(dut.instruction, (opcode << 27) | (condition << 23))
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == FaultType.INVALID_OP

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("opcode", [8, 9])
@pytest.mark.parametrize("condition", [14, 15])
def test_core_retired_instruction_has_no_memory_writes(opcode, condition):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        m_before = ctx.get(dut.dbg_m_bit_state)
        ctx.set(dut.imem_data, (opcode << 27) | (condition << 23) | (1 << 19) | (6 << 15))
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.fault_valid)
        assert ctx.get(dut.fault) == FaultType.INVALID_OP
        for cycle in range(20):
            assert not ctx.get(dut.dmem_wr_en)
            assert not ctx.get(dut.ns_wr_en)
            assert not ctx.get(dut.clist_wr_en)
            assert ctx.get(dut.dbg_m_bit_state) == m_before
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()