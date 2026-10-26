"""Slot-2 structural validation through the actual guarded core memory path."""
import json
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("mutation,expected", [
    (None, None),
    ("version", FaultType.VERSION),
    ("seal", FaultType.SEAL),
    ("base", FaultType.BOUNDS),
    ("limit", FaultType.BOUNDS),
    ("type", FaultType.BOUNDS),
    ("size", FaultType.BOUNDS),
    ("stack", FaultType.BOUNDS),
    ("indicator", FaultType.STACK_CORRUPT),
    ("root_gt", FaultType.STACK_CORRUPT),
    ("root_frame", FaultType.STACK_CORRUPT),
    ("cr0", FaultType.STACK_CORRUPT),
])
def test_slot_two_validation_never_activates_on_success_or_failure(mutation, expected):
    folder = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded"
    config = json.loads((folder / "guard.json").read_text())
    words = list(struct.unpack("<16384I", (folder / "candidate-le.bin").read_bytes()))
    base = words[8]
    if mutation == "version":
        words[9] ^= 1 << 17
    elif mutation == "seal":
        words[10] ^= 1
    elif mutation == "base":
        words[8] = 16384
    elif mutation == "limit":
        words[9] = (words[9] & ~0x1ffff) | 254
    elif mutation == "type":
        words[base] &= ~(3 << 8)
    elif mutation == "size":
        words[base] &= ~(15 << 23)
    elif mutation == "stack":
        words[base] &= ~(8191 << 10)
    elif mutation == "indicator":
        words[base + 17] ^= 1
    elif mutation == "root_gt":
        words[base + 242] = 0
    elif mutation == "root_frame":
        words[base + 243] ^= 1 << 13
    elif mutation == "cr0":
        words[base + 244] ^= 1
    if mutation in ("version", "base", "limit"):
        words[10] = integrity32(words[8], words[9])
    core = ChurchCore(expected_boot_guard=config["guard18"])
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await ctx.tick()
        ctx.set(core.boot_start, 0)
        for _ in range(160):
            assert not ctx.get(core.boot_complete)
            assert not ctx.get(core.dmem_wr_en)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert ctx.get(core.dbg_cr12_gt) == 0
            if ctx.get(core.fault_valid) or ctx.get(core.boot_thread_validated):
                assert ctx.get(core.boot_namespace_admitted)
                assert ctx.get(core.debug_cr_words[15][0]) == 0x1a2e0001
                assert bool(ctx.get(core.boot_thread_validated)) == (expected is None)
                assert bool(ctx.get(core.fault_valid)) == (expected is not None)
                if expected is not None:
                    assert ctx.get(core.fault) == expected
                    assert ctx.get(core.boot_fault_slot) == 2
                break
            enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            assert not enabled or (address % 4 == 0 and address < 65536)
            # No descriptor/body read for slot 2 before slot-1 admission.
            if enabled and not ctx.get(core.boot_namespace_admitted):
                assert address < 32
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, enabled)
            ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
        else:
            pytest.fail("Thread validation did not terminate")
        for _ in range(5):
            await ctx.tick()
            assert not ctx.get(core.boot_complete)
            assert not ctx.get(core.dmem_wr_en)
            assert ctx.get(core.dbg_cr12_gt) == 0
            assert ctx.get(core.boot_namespace_admitted)
        if expected is None:
            # A completed structural check must not survive a new reset with
            # different slot-2 bytes, even when their descriptor seal is valid.
            words[9] ^= 1 << 17
            words[10] = integrity32(words[8], words[9])
            ctx.set(core.reboot_req, 1)
            await ctx.tick()
            ctx.set(core.reboot_req, 0)
            await ctx.tick()
            assert not ctx.get(core.boot_thread_validated)
            for _ in range(160):
                assert not ctx.get(core.boot_thread_validated)
                assert not ctx.get(core.boot_complete)
                assert not ctx.get(core.dmem_wr_en)
                assert ctx.get(core.dbg_cr12_gt) == 0
                if ctx.get(core.fault_valid):
                    assert ctx.get(core.boot_namespace_admitted)
                    assert ctx.get(core.fault) == FaultType.VERSION
                    assert ctx.get(core.boot_fault_slot) == 2
                    break
                enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
                await ctx.tick()
                ctx.set(core.dmem_rd_valid, enabled)
                ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
            else:
                pytest.fail("Reset retained stale Thread validation")

    sim.add_testbench(bench)
    sim.run()
