"""Actual retained image words into the RTL bootstrap reader; no translation."""
from pathlib import Path
import struct
import hashlib

from amaranth.sim import Simulator
import pytest

from hardware.ascending_namespace import AscendingNamespaceBootstrap


IMAGE = (Path(__file__).resolve().parents[2] /
         "docs/phase-1/reload-evidence/new-layout/simulator-image-le.bin")


def run(words, expected_versions=None):
    dut = AscendingNamespaceBootstrap()
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    result = {}

    async def bench(ctx):
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        for _ in range(100):
            if ctx.get(dut.done) or ctx.get(dut.fault):
                if ctx.get(dut.done) and expected_versions is not None:
                    assert (ctx.get(dut.namespace_version),
                            ctx.get(dut.thread_version)) == expected_versions
                result.update(done=ctx.get(dut.done), error=ctx.get(dut.error),
                              slots=ctx.get(dut.slots),
                              base=ctx.get(dut.thread_base_byte),
                              limit=ctx.get(dut.thread_limit))
                return
            enabled = ctx.get(dut.mem_rd_en)
            addr = ctx.get(dut.mem_addr)
            assert not enabled or (addr % 4 == 0 and addr < 48)
            await ctx.tick()
            ctx.set(dut.mem_valid, enabled)
            ctx.set(dut.mem_data, words[addr // 4] if enabled else 0)
        pytest.fail("bootstrap reader did not finish within 100 cycles")

    sim.add_testbench(bench)
    sim.run()
    return result


def image_words():
    image = IMAGE.read_bytes()
    assert len(image) == 65536
    assert hashlib.sha256(image).hexdigest() == (
        "47966de85a7a8561b838a6c85f3ea6de447a7c54b0ea3b9c198527992ea4c565")
    return list(struct.unpack("<12I", image[:48]))


def test_exact_new_layout_metadata_and_thread_address():
    words = image_words()
    result = run(words)
    assert result == dict(done=1, error=0, slots=64,
                          base=words[8] * 4, limit=words[9] & 0x1fffff)


@pytest.mark.parametrize("word,value,error", [
    (0, 0, 1), (1, 1, 1), (2, 64, 1), (3, 1, 1),
    (4, 16, 2), (5, 63, 2), (6, 0, 3), (7, 1, 2),
    (8, 0, 4), (8, 16384, 4), (9, 1 << 31, 4), (10, 0, 5),
])
def test_reject_bad_metadata_without_publishing_boot_outputs(word, value, error):
    words = image_words()
    words[word] = value
    assert run(words) == dict(done=0, error=error, slots=0, base=0, limit=0)


@pytest.mark.parametrize("version", [1, 16, 256, 510])
def test_geometry_reader_does_not_force_guard_versions_to_zero(version):
    from server.boot_image import integrity32
    words = image_words()
    words[5] |= version << 21
    words[9] |= (version ^ 1) << 21
    words[6] = integrity32(words[4], words[5])
    words[10] = integrity32(words[8], words[9])
    assert run(words, (version, version ^ 1))["done"] == 1


def test_high_limit_bits_are_not_discarded_as_old_reserved_bits():
    from server.boot_image import integrity32
    words = image_words()
    words[9] |= 1 << 17
    words[10] = integrity32(words[8], words[9])
    assert run(words)["error"] == 4
