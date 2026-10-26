"""DWRITE's accepted authority and payload survive live input mutation."""
import pytest
from amaranth.sim import Simulator
from hardware.dwrite import ChurchDWrite
from hardware.core import ChurchCore
from hardware.hw_types import (
    make_gt, GT_TYPE_INFORM, GT_TYPE_ABSTRACT, PERM_MASK_W, FaultType,
    M_BIT_PORT, M_BIT_DEVICE_NS_SLOT,
)
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data


def cap(base=0x1000, limit=7, permissions=PERM_MASK_W, typ=GT_TYPE_INFORM, slot=3):
    return make_gt(typ, permissions, slot) | (base << 32) | (limit << 64)


@pytest.mark.parametrize("capability,index,imm,authorized,private,fault,expected", [
    (cap(), 3, 2, False, False, None, ("memory", 0x100C, 0xA5)),
    (cap(), 999, 0, False, False, None, ("memory", 0x1000, 0xA5)),  # DR0 index
    (0, 0, 0, False, False, FaultType.NULL_CAP, None),
    (cap(permissions=0), 0, 0, False, False, FaultType.PERM_W, None),
    (cap(typ=GT_TYPE_ABSTRACT), 0, 0, False, False, FaultType.INVALID_OP, None),
    (cap(), 8, 2, False, False, FaultType.BOUNDS, None),
    (cap(), 0, (1 << 14) | (1 << 4) | 2, False, False, FaultType.BOUNDS, None),
    (cap(base=0xFFFFFFFC), 1, 2, False, False, FaultType.BOUNDS, None),
    (cap(), 0xFFFFFFFF, (1 << 4) | 2, False, False, FaultType.BOUNDS, None),
    (cap(base=M_BIT_PORT, limit=0, slot=M_BIT_DEVICE_NS_SLOT), 0, 0,
     True, False, None, ("m", 0xA5)),
    (cap(base=M_BIT_PORT, limit=0, slot=M_BIT_DEVICE_NS_SLOT), 0, 0,
     False, False, FaultType.PERM_S, None),
    (cap(base=M_BIT_PORT, limit=7), 0, 0, True, False, FaultType.PERM_S, None),
    (0, 999, 0x7FFF, True, True, None, ("m", 0x1234)),
    (cap(), 999, 0x7FFF, False, True, FaultType.PERM_S, None),
])
def test_unit_binds_all_accepted_inputs(capability, index, imm, authorized, private, fault, expected):
    dut = ChurchDWrite()
    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), capability)
        ctx.set(dut.dr_rd_data, 0xA5)
        ctx.set(dut.dr_rd_data2, index)
        ctx.set(dut.imm, imm)
        ctx.set(dut.namespace_authorized, authorized)
        ctx.set(dut.private_m_word, 0x1234)
        ctx.set(dut.private_m_start, private)
        ctx.set(dut.start, not private)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.private_m_start, 0)
        # Valid accesses see hostile inputs; invalid accesses see repaired ones.
        ctx.set(dut.cr_rd_data.as_value(), cap(base=0x2000) if fault else 0)
        ctx.set(dut.dr_rd_data, 0xDEADBEEF)
        ctx.set(dut.dr_rd_data2, 0)
        ctx.set(dut.imm, 0)
        ctx.set(dut.namespace_authorized, not authorized)
        ctx.set(dut.private_m_word, 0xFFFF)
        writes, faults, done = [], [], 0
        for _ in range(8):
            if ctx.get(dut.fault):
                faults.append(ctx.get(dut.fault_type))
            if ctx.get(dut.dmem_wr_en):
                writes.append(("memory", ctx.get(dut.dmem_addr), ctx.get(dut.dmem_wr_data)))
            if ctx.get(dut.m_bit_wr_en):
                writes.append(("m", ctx.get(dut.m_bit_wr_word)))
            done += ctx.get(dut.done)
            await ctx.tick()
        assert faults == ([] if fault is None else [int(fault)])
        assert writes == ([] if expected is None else [expected])
        assert done == (1 if expected else 0)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_core_presents_source_data_before_dwrite_busy():
    dut = ChurchCore()
    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        for reg, value in ((2, 3), (4, 0xA5)):
            await execute_data(ctx, dut, 0xAF004000 | (reg << 19) | value)
        ctx.set(dut.dbg_cr_wr_en, 1)
        ctx.set(dut.dbg_cr_wr_addr, 3)
        ctx.set(dut.dbg_cr_wr_data.as_value(), cap())
        await ctx.tick()
        ctx.set(dut.dbg_cr_wr_en, 0)
        ctx.set(dut.imem_data, (17 << 27) | (14 << 23) | (4 << 19) | (3 << 15) | 2)
        ctx.set(dut.imem_valid, 1)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)
        writes = []
        for _ in range(12):
            assert not ctx.get(dut.fault_valid)
            if ctx.get(dut.dmem_wr_en):
                writes.append((ctx.get(dut.dmem_addr), ctx.get(dut.dmem_wr_data)))
            await ctx.tick()
        assert writes == [(0x100C, 0xA5)]
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
