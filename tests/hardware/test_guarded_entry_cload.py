"""Normal cLoad admission of the retained entry, not a full boot claim."""
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.cload import ChurchCLoad
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


def test_guarded_cload_cannot_disable_descriptor_seal_validation():
    with pytest.raises(ValueError, match="requires.*seal"):
        ChurchCLoad(enable_seal_check=False, resident_word_locations=True)


@pytest.mark.parametrize("case,expected_fault", [
    ("exact", None), ("seal", FaultType.SEAL),
    ("version", FaultType.VERSION), ("header", FaultType.BOUNDS),
    ("limit", FaultType.BOUNDS),
    ("free", FaultType.BOUNDS), ("permission", FaultType.PERM_E),
    ("slot_bound", FaultType.BOUNDS),
    ("nonzero_version", None),
    ("legacy_profile", None),
])
def test_guarded_entry_uses_original_seal_and_word_location(case, expected_fault):
    path = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded/candidate-le.bin"
    words = list(struct.unpack("<16384I", path.read_bytes()))
    gt = words[words[8] + 244]
    slot = gt & 65535
    base, authority = words[slot*4:slot*4+2]
    header = words[base]
    if case == "seal":
        words[slot*4+2] ^= 1
    elif case == "version":
        gt ^= 1 << 16
    elif case == "header":
        words[base] = 0
    elif case == "limit":
        words[slot*4+1] = (authority & ~0x1ffff) | 1
        words[slot*4+2] = integrity32(base, words[slot*4+1])
    elif case == "free":
        words[slot*4+1] |= 1 << 31
    elif case == "permission":
        gt &= ~(1 << 30)
    elif case == "slot_bound":
        gt = (gt & ~65535) | 64
    elif case == "nonzero_version":
        gt = (gt & ~(511 << 16)) | (46 << 16)
        words[slot*4+1] = (authority & ~(511 << 17)) | (46 << 17)
        words[slot*4+2] = integrity32(base, words[slot*4+1])
    elif case == "legacy_profile":
        # Separate synthetic historical-format fixture, never a conversion
        # offered for installation of New Layout.
        gt = (gt & ~(511 << 16)) | (46 << 16)
        words[slot*4] = base * 4
        words[slot*4+1] = (authority & 0x1ffff) | (46 << 21)
        words[slot*4+2] = integrity32(base * 4, words[slot*4+1])
    dut = ChurchCLoad(resident_word_locations=case != "legacy_profile")
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        writes = {}
        reads = []

        async def tick():
            en, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_addr)
            if en:
                assert addr % 4 == 0 and addr < 65536
                reads.append(addr)
            if ctx.get(dut.cr_wr_en):
                writes[ctx.get(dut.cr_wr_addr)] = ctx.get(dut.cr_wr_data.as_value())
            await ctx.tick()
            ctx.set(dut.mem_rd_valid, en)
            ctx.set(dut.mem_rd_data, words[addr//4] if en else 0)

        ns_gt, ns_authority = (0x1a000000, 255) if case == "legacy_profile" else (
            0x1a2e0001, (words[5] & 0x1ffff) |
            (((words[5] >> 17) & 511) << 21) | (words[5] & 0xc0000000))
        ctx.set(dut.cr15_namespace.as_value(), ns_gt | (ns_authority << 64))
        ctx.set(dut.e_gt, gt)
        ctx.set(dut.cload_start, 1)
        await tick()
        ctx.set(dut.cload_start, 0)
        for _ in range(100):
            if ctx.get(dut.cload_done) or ctx.get(dut.cload_fault):
                break
            await tick()
        else:
            pytest.fail("cLoad timed out")
        if expected_fault is not None:
            assert ctx.get(dut.cload_fault)
            assert ctx.get(dut.cload_fault_type) == expected_fault
            assert not writes, "failed admission must not publish CR6/CR14"
            if case == "slot_bound":
                assert not reads, "out-of-table tokens must fault before any read"
        else:
            assert ctx.get(dut.cload_done)
            assert base * 4 in reads
            assert (writes[14] >> 32) & 0xffffffff == base * 4 + 4
            size = 1 << (((header >> 23) & 15) + 6)
            assert (writes[6] >> 32) & 0xffffffff == (base + size - (header & 255)) * 4
            assert writes[6] & 0xffffffff == gt

    sim.add_testbench(bench)
    sim.run()
