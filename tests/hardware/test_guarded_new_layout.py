import json
import struct

import pytest

from scripts.prepare_guarded_new_layout import (
    SOURCE, guarded_image, prepare, verify, sha, SOURCE_HASH)


def test_typed_references_only_and_deterministic_reconstruction():
    raw = (SOURCE / "simulator-image-le.bin").read_bytes()
    guarded, patches = guarded_image(raw, (7 << 9) | 19)
    before = struct.unpack("<16384I", raw)
    after = struct.unpack("<16384I", guarded)
    assert (after[5] >> 17) & 511 == 7
    assert (after[9] >> 17) & 511 == 19
    # CR0 still enters ActorManager at slot 20; no program or address substitution.
    assert after[500] == before[500] == 0x4a000014
    assert any("NS[21]" in p["reason"] for p in patches)
    undo = list(after)
    for patch in patches:
        undo[patch["word"]] = patch["before"]
    assert sha(struct.pack("<16384I", *undo)) == SOURCE_HASH
    assert guarded_image(raw, (7 << 9) | 19) == (guarded, patches)


def test_retained_pair_reused_and_overwrite_refused(tmp_path):
    folder = tmp_path / "candidate"
    result = prepare(folder)
    guard = (folder / "guard.json").read_bytes()
    assert verify(folder) == result
    assert (folder / "guard.json").read_bytes() == guard
    with pytest.raises(FileExistsError):
        prepare(folder)
    image = bytearray((folder / "candidate-le.bin").read_bytes())
    image[-1] ^= 1
    (folder / "candidate-le.bin").write_bytes(image)
    with pytest.raises(ValueError, match="reconstruction"):
        verify(folder)


def test_changed_input_rejected():
    raw = bytearray((SOURCE / "simulator-image-le.bin").read_bytes())
    raw[-1] ^= 1
    with pytest.raises(ValueError, match="retained exact"):
        guarded_image(raw, 0)


@pytest.mark.parametrize("changed_slot", [None, 1, 2])
def test_historical_guarded_bytes_are_rejected_by_current_rtl(changed_slot):
    from amaranth import Module
    from amaranth.sim import Simulator
    from hardware.ascending_namespace import AscendingNamespaceBootstrap
    from hardware.boot_pair_guard import BootPairGuard
    from hardware.hw_types import FaultType
    from server.boot_image import integrity32

    folder = SOURCE.parent / "new-layout-guarded"
    manifest = verify(folder)
    config = json.loads((folder / "guard.json").read_text())
    raw = (folder / "candidate-le.bin").read_bytes()
    assert sha(raw) == manifest["sha256"]
    words = list(struct.unpack("<16384I", raw))
    if changed_slot:
        # Re-seal an independently altered version: mismatch must still fail
        # against retained build configuration, not just a bad-seal fixture.
        at = changed_slot * 4
        words[at + 1] ^= 1 << 17
        words[at + 2] = integrity32(words[at], words[at + 1])
    m = Module()
    m.submodules.reader = reader = AscendingNamespaceBootstrap()
    m.submodules.guard = guard = BootPairGuard(expected_guard=config["guard18"])
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(reader.start, 1)
        await ctx.tick()
        ctx.set(reader.start, 0)
        for _ in range(100):
            assert not ctx.get(reader.done), "old 17-bit profile must not be accepted"
            if ctx.get(reader.fault):
                assert ctx.get(reader.error) == 2
                assert ctx.get(reader.slots) == 0
                return
            enabled, addr = ctx.get(reader.mem_rd_en), ctx.get(reader.mem_addr)
            await ctx.tick()
            ctx.set(reader.mem_valid, enabled)
            ctx.set(reader.mem_data, words[addr // 4] if enabled else 0)
        else:
            pytest.fail("historical metadata was not rejected")
    sim.add_testbench(bench)
    sim.run()
