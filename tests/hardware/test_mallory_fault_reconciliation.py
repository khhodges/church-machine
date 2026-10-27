"""Isolated current-RTL check of the retained Mallory operand boundary.

No board, server, or saved-image writes. This does not attest installed RTL.
"""
import hashlib
import json
from pathlib import Path
import struct

from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.hw_types import FaultType


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime"


def retained():
    raw = (EVIDENCE / "candidate-le.bin").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == (
        "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451")
    snapshot = json.loads((EVIDENCE / "physical-runtime-reload-status.json").read_text())["latest_snapshot"]
    assert snapshot["crc_valid"] is True
    assert snapshot["nia"] == 0x2e08
    assert struct.unpack_from("<I", raw, 0x2e08)[0] == 0x070b0020
    assert snapshot["cr"][6] == [0x4a000011, 0x2ff8, 1]
    assert struct.unpack_from("<I", raw, 0x2e00)[0] & 0xff == 2
    return snapshot["cr"][6]


def observe(index):
    words = retained()
    dut = ChurchMLoad(resident_word_locations=True)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    result = {"reads": [], "writes": [], "cr_writes": []}

    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), words[0] | words[1] << 32 | words[2] << 64)
        ctx.set(dut.sub_cr_src, 6)
        ctx.set(dut.sub_cr_dst, 1)
        ctx.set(dut.sub_index, index)
        ctx.set(dut.sub_m_elevated, 0)
        # Normal CR6 c-list L authorization, not Namespace M elevation.
        ctx.set(dut.sub_cr6_l, 1)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        for _ in range(20):
            if ctx.get(dut.mem_rd_en):
                result["reads"].append(ctx.get(dut.mem_addr))
            if ctx.get(dut.mem_wr_en):
                result["writes"].append(ctx.get(dut.mem_addr))
            if ctx.get(dut.cr_wr_en):
                result["cr_writes"].append(ctx.get(dut.cr_wr_addr))
            if ctx.get(dut.sub_fault):
                result["fault"] = ctx.get(dut.sub_fault_type)
                break
            if result["reads"]:
                # Positive control only needs to show FETCH_GT is reached.
                break
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
    return result


def test_retained_row_two_is_bounds_before_any_memory_read():
    result = observe(2)
    assert result["fault"] == FaultType.BOUNDS
    assert result["reads"] == []
    assert result["writes"] == []
    assert result["cr_writes"] == []


def test_in_range_row_one_reaches_capability_fetch():
    result = observe(1)
    assert "fault" not in result
    assert result["reads"] == [0x2ffc]
    assert result["writes"] == []
    assert result["cr_writes"] == []
