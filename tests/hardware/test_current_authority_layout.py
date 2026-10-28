"""Current contract field widths, including independently sealed high limits."""
import pytest
from amaranth.sim import Simulator
from hardware.mload import ChurchMLoad
from hardware.integrity32 import integrity32
from hardware.guarded_build_profile import validate_words


@pytest.mark.parametrize("version", [1, 16, 256, 510])
@pytest.mark.parametrize("defect", [None, "version", "seal", "high_limit"])
def test_current_descriptor_version_and_limit_independent(version, defect):
    dut = ChurchMLoad(resident_word_locations=True)
    authority = (63 if defect != "high_limit" else 0x2003f) | (version << 21)
    memory = {48: 512, 52: authority, 56: integrity32(512, authority), 60: 0}
    if defect == "seal":
        memory[56] ^= 1
    gt = 0x4a000003 | ((version ^ int(defect == "version")) << 16)

    async def bench(ctx):
        ctx.set(dut.sub_direct, 1)
        ctx.set(dut.sub_direct_gt, gt)
        ctx.set(dut.sub_validate_only, 1)
        ctx.set(dut.cr15_namespace.as_value(), 0x02000001 | (255 << 64))
        ctx.set(dut.sub_start, 1)
        pending = None
        for cycle in range(100):
            ctx.set(dut.mem_rd_valid, pending is not None)
            ctx.set(dut.mem_rd_data, memory.get(pending, 0))
            assert not ctx.get(dut.cr_wr_en)
            assert not ctx.get(dut.mem_wr_en)
            if ctx.get(dut.sub_done):
                assert defect is None
                cap = ctx.get(dut.resolved_cap.as_value())
                assert cap & 0xffffffff == gt
                assert cap >> 32 & 0xffffffff == 2048
                assert cap >> 64 == authority
                return
            if ctx.get(dut.sub_fault):
                assert defect is not None
                assert ctx.get(dut.sub_fault_type) == {
                    "version": 9, "seal": 10, "high_limit": 8}[defect]
                return
            pending = ctx.get(dut.mem_addr) if ctx.get(dut.mem_rd_en) else None
            await ctx.tick()
            ctx.set(dut.sub_start, 0)
        pytest.fail("descriptor validation deadline")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_historical_build_candidate_cannot_use_current_rtl():
    from pathlib import Path
    import struct
    raw = (Path(__file__).resolve().parents[2] /
           "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin").read_bytes()
    with pytest.raises(ValueError, match="incompatible Namespace authority layout"):
        validate_words(struct.unpack("<16384I", raw), 23971)
