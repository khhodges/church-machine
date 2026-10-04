"""Full descriptor limits and non-wrapping addresses; no saved artifacts."""

import pytest
from amaranth.sim import Simulator

from hardware.dread import ChurchDRead
from hardware.dwrite import ChurchDWrite
from hardware.hw_types import (
    FaultType, GT_TYPE_INFORM, M_BIT_PORT, PERM_MASK_R, PERM_MASK_W, make_gt,
)


def run_access(kind, *, limit, index=0, magnitude=0, base=0x1000,
               immediate=False, permitted=True):
    dut = ChurchDRead() if kind == "read" else ChurchDWrite()
    permission = PERM_MASK_R if kind == "read" else PERM_MASK_W
    gt = make_gt(GT_TYPE_INFORM, permission if permitted else 0, slot_id=3)
    cap = gt | (base << 32) | (limit << 64)
    observed = {"fault": None, "done": 0, "reads": [], "writes": [],
                "register_writes": [], "m_writes": 0}
    payload = 0xD15EA5E5

    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.imm, (0x4000 | magnitude) if immediate else
                ((magnitude << 4) | 11))
        if kind == "read":
            ctx.set(dut.dr_dst, 4)
            ctx.set(dut.dr_rd_data, index)
            ctx.set(dut.dmem_rd_data, payload)
        else:
            ctx.set(dut.dr_src, 4)
            ctx.set(dut.dr_rd_data, payload)
            ctx.set(dut.dr_rd_data2, index)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        for _ in range(10):
            if ctx.get(dut.fault):
                observed["fault"] = ctx.get(dut.fault_type)
            observed["done"] += ctx.get(dut.done)
            if kind == "read":
                if ctx.get(dut.dmem_rd_en):
                    observed["reads"].append(ctx.get(dut.dmem_addr))
                if ctx.get(dut.dr_wr_en):
                    observed["register_writes"].append(
                        (ctx.get(dut.dr_wr_addr), ctx.get(dut.dr_wr_data)))
            else:
                if ctx.get(dut.dmem_wr_en):
                    observed["writes"].append(
                        (ctx.get(dut.dmem_addr), ctx.get(dut.dmem_wr_data)))
                observed["m_writes"] += ctx.get(dut.m_bit_wr_en)
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return observed


@pytest.mark.parametrize("kind", ["read", "write"])
@pytest.mark.parametrize("limit,index,magnitude,immediate,base", [
    (0, 0, 0, True, 0x1000),
    (65536, 0, 1, True, 0x1000),
    (65535, 65535, 0, False, 0x1000),
    (65536, 65536, 0, False, 0x1000),
    (65536, 65535, 1, False, 0x1000),
    (0x1FFFFF, 0x1FFFFF, 0, False, 0x1000),
    (0, 0, 0, True, 0xFFFFFFFC),
])
def test_full_width_access(kind, limit, index, magnitude, immediate, base):
    observed = run_access(kind, limit=limit, index=index, magnitude=magnitude,
                          immediate=immediate, base=base)
    address = base + 4 * (magnitude if immediate else index + magnitude)
    assert observed["fault"] is None
    assert observed["done"] == 1
    assert observed["m_writes"] == 0
    assert observed["reads"] == ([address] if kind == "read" else [])
    assert observed["writes"] == ([(address, 0xD15EA5E5)] if kind == "write" else [])
    assert observed["register_writes"] == ([(4, 0xD15EA5E5)] if kind == "read" else [])


@pytest.mark.parametrize("kind", ["read", "write"])
@pytest.mark.parametrize("kwargs,fault", [
    (dict(limit=65536, index=65537), FaultType.BOUNDS),
    (dict(limit=0x1FFFFF, index=0x200000), FaultType.BOUNDS),
    (dict(limit=0x1FFFFF, index=0xFFFFFFFF, magnitude=1), FaultType.BOUNDS),
    (dict(limit=4, index=1, base=0xFFFFFFFC), FaultType.BOUNDS),
    (dict(limit=65536, index=65536, permitted=False), None),
    # A broad ordinary data capability is not authority for the M-bit port.
    (dict(limit=65536, index=65536, base=M_BIT_PORT - (65536 << 2)),
     FaultType.PERM_S),
])
def test_rejection_has_no_access_or_write(kind, kwargs, fault):
    observed = run_access(kind, **kwargs)
    expected = fault if fault is not None else (
        FaultType.PERM_R if kind == "read" else FaultType.PERM_W)
    assert observed == {
        "fault": expected, "done": 0, "reads": [], "writes": [],
        "register_writes": [], "m_writes": 0,
    }