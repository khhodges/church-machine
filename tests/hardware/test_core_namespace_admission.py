"""Actual guarded image bytes through core bootstrap, without instruction shims."""
import json
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("mutation,fault,slot", [
    (None, None, 0),
    ("version", FaultType.VERSION, 1),
    ("seal", FaultType.SEAL, 1),
    ("metadata", FaultType.BOUNDS, 0),
    ("thread_only", None, 0),
    ("both", FaultType.VERSION, 1),
])
def test_guarded_namespace_admission_and_fail_closed_hold(mutation, fault, slot):
    folder = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded"
    config = json.loads((folder / "guard.json").read_text())
    words = list(struct.unpack("<16384I", (folder / "candidate-le.bin").read_bytes()))
    if mutation in ("version", "both"):
        words[5] ^= 1 << 17
        words[6] = integrity32(words[4], words[5])
    elif mutation == "seal":
        words[6] ^= 1
    elif mutation == "metadata":
        words[1] = 1
    if mutation in ("thread_only", "both"):
        words[10] ^= 1  # must not be inspected before Namespace admission
    core = ChurchCore(expected_boot_guard=config["guard18"])
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await ctx.tick()
        ctx.set(core.boot_start, 0)
        # Supplying a marker continuously must never run it before the complete
        # guarded bootstrap/Thread path is implemented.
        ctx.set(core.imem_valid, 1)
        ctx.set(core.imem_data, 0x27000001)
        ctx.set(core.imem_fetch_address, 4)
        ctx.set(core.imem_from_reset_rom, 1)
        for cycle in range(100):
            assert not ctx.get(core.dmem_wr_en)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert not ctx.get(core.boot_complete)
            assert ctx.get(core.dbg_cr12_gt) == 0
            if ctx.get(core.fault_valid) or ctx.get(core.boot_namespace_admitted):
                assert bool(ctx.get(core.boot_namespace_admitted)) == (fault is None)
                assert bool(ctx.get(core.fault_valid)) == (fault is not None)
                if fault is not None:
                    assert ctx.get(core.fault) == fault
                    assert ctx.get(core.boot_fault_slot) == slot
                    assert all(ctx.get(w) == 0 for w in core.debug_cr_words[15])
                else:
                    assert [ctx.get(w) for w in core.debug_cr_words[15]] == [
                        0x1a000001 | (config["namespaceVersion"] << 16), 0,
                        (words[5] & 0x1ffff) | (((words[5] >> 17) & 511) << 21)]
                break
            enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            assert not enabled or (address < 32 and address % 4 == 0)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, enabled)
            ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
        else:
            pytest.fail("Namespace admission did not terminate")
        for _ in range(5):
            await ctx.tick()
            assert not ctx.get(core.boot_complete)
            assert not ctx.get(core.dmem_wr_en)
            assert ctx.get(core.dbg_cr12_gt) == 0
            assert bool(ctx.get(core.boot_namespace_admitted)) == (fault is None)
        if fault is None:
            # Fresh reset must not reuse admission or the previous CR15 when
            # presented with a different, correctly re-sealed version.
            words[5] ^= 1 << 17
            words[6] = integrity32(words[4], words[5])
            ctx.set(core.reboot_req, 1)
            await ctx.tick()
            ctx.set(core.reboot_req, 0)
            await ctx.tick()
            assert not ctx.get(core.boot_namespace_admitted)
            for _ in range(100):
                assert not ctx.get(core.boot_complete)
                assert not ctx.get(core.dmem_wr_en)
                assert all(ctx.get(w) == 0 for w in core.debug_cr_words[15])
                if ctx.get(core.fault_valid):
                    assert ctx.get(core.fault) == FaultType.VERSION
                    assert ctx.get(core.boot_fault_slot) == 1
                    break
                enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
                await ctx.tick()
                ctx.set(core.dmem_rd_valid, enabled)
                ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
            else:
                pytest.fail("Fresh reset reused prior Namespace admission")

    sim.add_testbench(bench)
    sim.run()
