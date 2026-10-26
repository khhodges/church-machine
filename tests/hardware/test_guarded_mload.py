"""Stored ascending authority versus internal cached authority, real mLoad."""
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("case", ["thread", "namespace", "mmio", "bad_version", "bad_seal", "slot_bound", "legacy"])
def test_guarded_direct_mload(case):
    p = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded/candidate-le.bin"
    words = list(struct.unpack("<16384I", p.read_bytes()))
    slot = {"namespace": 1, "mmio": 3, "slot_bound": 64}.get(case, 2)
    raw = words[slot*4+1] if slot < 64 else 0
    seq = (raw >> 17) & 511
    gt = 0x02000000 | (seq << 16) | slot
    expected = None
    if case == "bad_version":
        gt ^= 1 << 16
        expected = FaultType.VERSION
    elif case == "bad_seal":
        words[slot*4+2] ^= 1
        expected = FaultType.SEAL
    elif case == "slot_bound":
        expected = FaultType.BOUNDS
    elif case == "legacy":
        words[slot*4] *= 4
        raw = (raw & 0x1ffff) | (seq << 21)
        words[slot*4+1] = raw
        words[slot*4+2] = integrity32(words[slot*4], raw)
    dut = ChurchMLoad(resident_word_locations=case != "legacy")
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        writes = []
        ctx.set(dut.cr15_namespace.as_value(), 0x1a2e0001 | ((255 | (46 << 21)) << 64))
        ctx.set(dut.sub_direct, 1)
        ctx.set(dut.sub_direct_gt, gt)
        ctx.set(dut.sub_cr_dst, 0)
        # Even asserted elevation cannot bypass guarded descriptor admission.
        ctx.set(dut.sub_m_elevated, case != "legacy")
        ctx.set(dut.sub_start, 1)
        for cycle in range(100):
            if ctx.get(dut.sub_fault):
                assert expected is not None
                assert ctx.get(dut.sub_fault_type) == expected
                assert not writes
                assert not ctx.get(dut.cr_wr_en)
                return
            if ctx.get(dut.sub_done):
                assert expected is None
                value = ctx.get(dut.resolved_cap.as_value())
                loc = words[slot*4]
                assert (value >> 32) & 0xffffffff == (
                    loc * 4 if case != "legacy" and loc < 16384 else loc)
                cached = raw if case == "legacy" else (
                    (raw & 0x1ffff) | (seq << 21) | (raw & 0xc0000000))
                assert (value >> 64) == cached
                assert value & 0xffffffff == gt
                # Namespace G-bit maintenance must retain the STORED format.
                assert writes == [(slot*16+4, raw & ~(1 << 30))]
                return
            en, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_addr)
            if ctx.get(dut.mem_wr_en):
                writes.append((addr, ctx.get(dut.mem_wr_data)))
            await ctx.tick()
            ctx.set(dut.sub_start, 0)
            ctx.set(dut.mem_rd_valid, en)
            ctx.set(dut.mem_rd_data, words[addr//4] if en else 0)
        pytest.fail("mLoad timed out")

    sim.add_testbench(bench)
    sim.run()
