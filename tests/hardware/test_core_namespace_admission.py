"""Namespace-stage guarded controls; no Thread fixture or archive translation.

The synthetic prefix deliberately stops at Namespace admission. It is not a
bootable image, release candidate, or substitute for full Thread-path coverage.
"""
import hashlib
import json
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


def namespace_prefix():
    # Independently authored current-format metadata + self descriptor. Keep
    # high nonzero version bits so historical bit-17 decoding cannot pass.
    config = {"namespaceVersion": 302, "threadVersion": 419,
              "guard18": (302 << 9) | 419}
    words = [(31 << 27) | (1 << 23) | (64 << 10) | (1 << 8),
             0, 0, 0, 0, (302 << 21) | 255, 0, 0,
             0, 0, 0, 0]
    words[6] = integrity32(words[4], words[5])
    return config, words


@pytest.mark.parametrize("mutation,fault,slot", [
    (None, None, 0),
    ("version", FaultType.VERSION, 1),
    ("seal", FaultType.SEAL, 1),
    ("metadata", FaultType.BOUNDS, 0),
    ("thread_only", None, 0),
    ("both", FaultType.VERSION, 1),
    ("geometry", FaultType.BOUNDS, 1),
    ("high_limit", FaultType.BOUNDS, 1),
    ("base", FaultType.BOUNDS, 1),
    ("reserved", FaultType.BOUNDS, 1),
    ("version_bad_seal", FaultType.SEAL, 1),
    ("geometry_bad_seal", FaultType.BOUNDS, 1),
    ("historical", FaultType.BOUNDS, 1),
])
def test_guarded_namespace_admission_and_fail_closed_hold(mutation, fault, slot):
    config, words = namespace_prefix()
    if mutation == "historical":
        folder = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded"
        config = json.loads((folder / "guard.json").read_text())
        raw = (folder / "candidate-le.bin").read_bytes()
        assert len(raw) == 65536
        assert hashlib.sha256(raw).hexdigest() == (
            "866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879")
        assert config["guard18"] == (46 << 9) | 419
        words = list(struct.unpack("<16384I", raw))
    if mutation in ("version", "both", "version_bad_seal"):
        words[5] ^= 1 << 21
    elif mutation in ("geometry", "geometry_bad_seal"):
        words[5] = (words[5] & ~0x1fffff) | 254
    elif mutation == "high_limit":
        words[5] |= 1 << 17  # limit bit, NOT a current-format version bit
    elif mutation == "base":
        words[4] = 1
    elif mutation == "reserved":
        words[7] = 1
    if mutation in ("version", "both", "geometry", "high_limit", "base"):
        words[6] = integrity32(words[4], words[5])
    elif mutation == "seal":
        words[6] ^= 1
    elif mutation == "metadata":
        words[1] = 1
    if mutation in ("thread_only", "both"):
        words[10] ^= 1  # must not be inspected before Namespace admission
    if mutation in ("version", "both", "geometry", "high_limit", "base"):
        assert words[6] == integrity32(words[4], words[5])
    if mutation in ("seal", "version_bad_seal", "geometry_bad_seal"):
        assert words[6] != integrity32(words[4], words[5])
    core = ChurchCore(expected_boot_guard=config["guard18"])
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        reads = []
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await ctx.tick()
        ctx.set(core.boot_start, 0)
        cr13 = [ctx.get(w) for w in core.debug_cr_words[13]]
        # A continuously supplied marker cannot bypass Namespace/Thread checks.
        ctx.set(core.imem_valid, 1)
        ctx.set(core.imem_data, 0x27000001)
        ctx.set(core.imem_fetch_address, 4)
        ctx.set(core.imem_from_reset_rom, 1)
        for cycle in range(100):
            assert not ctx.get(core.dmem_wr_en)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert not ctx.get(core.boot_complete)
            assert not ctx.get(core.boot_thread_validated)
            assert not ctx.get(core.boot_thread_activated)
            assert ctx.get(core.dbg_cr12_gt) == 0
            assert [ctx.get(w) for w in core.debug_cr_words[13]] == cr13
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
                        (302 << 21) | 255]
                break
            assert all(ctx.get(w) == 0 for w in core.debug_cr_words[15])
            enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            assert not enabled or (address < 32 and address % 4 == 0)
            if enabled:
                reads.append(address)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, enabled)
            ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
        else:
            pytest.fail("Namespace admission did not terminate")
        assert set(reads) == set(range(0, 32, 4))
        # Stop responses at the Namespace boundary, not by supplying bogus
        # Thread data. This suite makes no Thread-admission success claim.
        ctx.set(core.dmem_rd_valid, 0)
        for _ in range(5):
            await ctx.tick()
            assert not ctx.get(core.boot_complete)
            assert not ctx.get(core.dmem_wr_en)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert not ctx.get(core.boot_thread_validated)
            assert not ctx.get(core.boot_thread_activated)
            assert bool(ctx.get(core.fault_valid)) == (fault is not None)
            if fault is not None:
                assert ctx.get(core.fault) == fault
                assert ctx.get(core.boot_fault_slot) == slot
                assert not ctx.get(core.dmem_rd_en)
                assert all(ctx.get(w) == 0 for w in core.debug_cr_words[15])
            assert ctx.get(core.dbg_cr12_gt) == 0
            assert [ctx.get(w) for w in core.debug_cr_words[13]] == cr13
            assert bool(ctx.get(core.boot_namespace_admitted)) == (fault is None)
        if fault is None:
            # Fresh reset must not reuse admission or the previous CR15 when
            # presented with a different, correctly re-sealed version.
            words[5] ^= 1 << 21
            words[6] = integrity32(words[4], words[5])
            ctx.set(core.reboot_req, 1)
            await ctx.tick()
            ctx.set(core.reboot_req, 0)
            await ctx.tick()
            assert not ctx.get(core.boot_namespace_admitted)
            for _ in range(100):
                assert not ctx.get(core.boot_complete)
                assert not ctx.get(core.dmem_wr_en)
                assert not ctx.get(core.ns_wr_en)
                assert not ctx.get(core.clist_wr_en)
                assert not ctx.get(core.boot_namespace_admitted)
                assert not ctx.get(core.boot_thread_validated)
                assert not ctx.get(core.boot_thread_activated)
                assert all(ctx.get(w) == 0 for w in core.debug_cr_words[15])
                if ctx.get(core.fault_valid):
                    assert ctx.get(core.fault) == FaultType.VERSION
                    assert ctx.get(core.boot_fault_slot) == 1
                    break
                enabled, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
                assert not enabled or (address < 32 and address % 4 == 0)
                await ctx.tick()
                ctx.set(core.dmem_rd_valid, enabled)
                ctx.set(core.dmem_rd_data, words[address // 4] if enabled else 0)
            else:
                pytest.fail("Fresh reset reused prior Namespace admission")

    sim.add_testbench(bench)
    sim.run()
