"""Read selection precedes acceptance; this is not routed timing evidence."""
import ast
from pathlib import Path
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data, snapshot


def test_read_addresses_do_not_consume_acceptance_signals():
    tree = ast.parse(Path("hardware/core.py").read_text())
    assignments = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "eq" and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr in ("dr_rd_addr1", "dr_rd_addr2")):
            names = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
            assert not any(name.endswith("_start_sig") for name in names)
            assignments.append(names)
    assert len(assignments) >= 3  # two defaults plus CHANGE busy override


@pytest.mark.parametrize("opcode", [18, 19])  # independent BFEXT/BFINS encoding
@pytest.mark.parametrize("index,offset,width,subtract,valid", [
    (4, 0, 3, False, True),
    (31, 0, 1, False, True),
    (4, 1, 2, True, True),
    (4, 0, 0, False, False),
    (31, 0, 2, False, False),
    (0, 1, 1, True, False),
])
def test_bitfield_operands_and_fault_atomicity(opcode, index, offset, width, subtract, valid):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        for reg, value in ((1, 0xA5), (2, index), (3, 0x35)):
            await execute_data(ctx, dut, 0xAF004000 | (reg << 19) | value)
        word = ((opcode << 27) | (14 << 23) | (1 << 19) | (3 << 15)
                | (int(subtract) << 14) | (2 << 10) | (offset << 5) | width)
        if valid:
            before, after = await execute_data(ctx, dut, word)
            position = index - offset if subtract else index + offset
            mask = (1 << width) - 1
            result = ((0x35 >> position) & mask) if opcode == 18 else (
                (0xA5 & ~(mask << position)) | ((0x35 & mask) << position))
            expected = before["dr"].copy()
            expected[1] = result
            assert after["dr"] == expected
            assert after["cr"] == before["cr"]
            assert after["flags"] == (int(bool(result & 0x80000000)), int(result == 0), 0, 0)
        else:
            ctx.set(dut.imem_valid, 0)
            await ctx.tick()
            before = snapshot(ctx, dut)
            ctx.set(dut.imem_data, word)
            ctx.set(dut.imem_valid, 1)
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == 8
            for enable in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
                assert not ctx.get(enable)
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            after = snapshot(ctx, dut)
            assert after == before

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
