"""Physical generic-image allocations, not capability access limits."""
import struct
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.path.insert(0, os.path.dirname(__file__))
from server import boot_image as bi
from shared.namespace_header import encode_namespace_header


TOTAL = 16384
SLOTS = 32


def fixture_words():
    words = [0] * TOTAL
    words[:bi.NAMESPACE_HEADER_V2_WORDS] = encode_namespace_header(
        0, TOTAL, SLOTS, 1408 * 4)

    def entry(slot, location, limit):
        bi.write_ns_entry(words, TOTAL, bi.NS_ENTRY_WORDS, slot, location,
                          limit, 0, 0, 1, 0, 0, 0)

    entry(0, 0, TOTAL - SLOTS * 4 - 1)
    for slot, (addr, limit) in bi._MMIO_SLOT_SPECS.items():
        entry(slot, addr, limit)
    thread = 16
    size = 256
    layout = bi.thread_layout(size, 32)
    words[thread] = bi.pack_lump_header(bi._ns_n_minus_6(size), 32,
                                         bi.THREAD_CAP_WORDS, 2)
    enter = bi.create_gt(0, 6, {"E": 1}, 1)
    sto = layout["stack_end"] - 2
    words[thread + bi.THREAD_STO_OFFSET] = (1 << 12) | sto
    words[thread + sto + 1] = enter
    words[thread + sto + 2] = (0x7fff << 13) | (1 << 12) | layout["stack_end"]
    words[thread + layout["caps_start"]] = enter
    entry(1, thread, size - 1)
    for slot, addr in ((6, 1408), (10, 1664)):
        words[addr] = bi.pack_lump_header(2, 1, 0, 0)
        entry(slot, addr, 63)
    return words


def check(words):
    bi.validate_boot_image(struct.pack(f"<{TOTAL}I", *words))


def move(words, slot, addr, size, limit=0):
    base = TOTAL - (slot + 1) * bi.NS_ENTRY_WORDS
    words[base] = addr
    words[base + 1] = bi.pack_ns_word1(limit)
    words[base + 2] = bi.integrity32(addr, words[base + 1])
    words[addr] = bi.pack_lump_header(bi._ns_n_minus_6(size), 1, 0, 0)


def test_valid_adjacent_executable_thread_and_mmio():
    words = fixture_words()
    move(words, 14, 576, 64)
    check(words)


@pytest.mark.parametrize("limit", [0, 3])
def test_full_allocation_overlap_even_with_short_capability_limit(limit):
    words = fixture_words()
    # NS[7] occupies [0x110,0x510); NS[14] starts at 0x400.
    # Preserve Thread and boot-body bytes to isolate the pairwise check.
    move(words, 7, 0x110, 1024, limit)
    move(words, 14, 0x400, 256, 0)
    with pytest.raises(ValueError, match=r"NS slot 7.*overlaps NS slot 14"):
        check(words)


def test_header_allocation_outside_ram_body_region():
    words = fixture_words()
    move(words, 14, TOTAL - SLOTS * 4 - 32, 64)
    with pytest.raises(ValueError, match="full LUMP allocation"):
        check(words)


def test_missing_header_rejected():
    words = fixture_words()
    base = TOTAL - 15 * bi.NS_ENTRY_WORDS
    words[base] = 1200
    words[base + 1] = bi.pack_ns_word1(0)
    with pytest.raises(ValueError, match="missing LUMP header"):
        check(words)


def test_reserved_header_region_rejected():
    words = fixture_words()
    base = TOTAL - 15 * bi.NS_ENTRY_WORDS
    words[base] = 8
    words[base + 1] = bi.pack_ns_word1(0)
    with pytest.raises(ValueError, match="out-of-range RAM location"):
        check(words)


def test_invalid_header_geometry_rejected():
    words = fixture_words()
    move(words, 14, 576, 64)
    words[576] = bi.pack_lump_header(0, 8191, 0, 0)
    with pytest.raises(ValueError, match="malformed LUMP header"):
        check(words)


@pytest.mark.parametrize("typ", [1, 3])
def test_data_and_outform_bodies_claim_complete_allocation(typ):
    words = fixture_words()
    move(words, 14, 576, 128)
    words[576] = (words[576] & ~(3 << 8)) | (typ << 8)
    check(words)
    move(words, 15, 640, 64)
    with pytest.raises(ValueError, match=r"NS slot 14.*overlaps NS slot 15"):
        check(words)


def test_symbolic_nonzero_generation_has_no_ram_body():
    words = fixture_words()
    base = TOTAL - 15 * bi.NS_ENTRY_WORDS
    words[base + 1] = bi.pack_ns_word1(0, gt_seq=5)
    check(words)


def test_empty_catalog_slot_reserves_whole_body_and_must_stay_zero():
    words = fixture_words()
    move(words, 8, 576, 64)
    words[576] = 0
    check(words)
    move(words, 14, 608, 64)
    with pytest.raises(ValueError, match="nonempty unloaded catalog allocation"):
        check(words)
    words = fixture_words()
    move(words, 8, 576, 64)
    words[576] = 0
    words[600] = 1
    with pytest.raises(ValueError, match="nonempty unloaded catalog allocation"):
        check(words)


def test_private_generation_accepts_normal_image_rejects_staged_collision(tmp_path, monkeypatch):
    # Reuse the existing fully private SelfTest fixture; never read the live
    # saved artifact library, Namespace, config, or boot image.
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "boot-image-test-secret-" + "a" * 32)
    from test_boot_image_matches_simulator import _write_synthetic_boot_abstr_lump, _cfg_default

    _write_synthetic_boot_abstr_lump(str(tmp_path))
    cfg = _cfg_default()
    valid = bi.generate_boot_image(cfg, str(tmp_path))
    bi.validate_boot_image(valid)
    original_write = bi.write_ns_entry
    def stage_conflicting_descriptors(mem, total, width, slot, *args):
        original_write(mem, total, width, slot, *args)
        if slot == 10:
            # Fault-inject a staged pair after normal catalog placement;
            # both headers are valid but their allocations intersect.
            for extra, location in ((20, 4096), (21, 4128)):
                mem[location] = bi.pack_lump_header(0, 1, 0)
                original_write(mem, total, width, extra, location, 0,
                               0, 0, 1, 0, 0, 0)
    monkeypatch.setattr(bi, "write_ns_entry", stage_conflicting_descriptors)
    with pytest.raises(ValueError, match="overlaps"):
        bi.generate_boot_image(cfg, str(tmp_path))
    assert not (tmp_path / "boot-image.bin").exists()


def test_corrupt_image_never_reaches_publication(tmp_path, monkeypatch):
    from server import app as server_app

    target = tmp_path / "boot-image.bin"
    target.write_bytes(b"original")
    monkeypatch.setattr(server_app, "BOOT_IMAGE_PATH", str(target))
    words = fixture_words()
    move(words, 7, 0x110, 1024)
    move(words, 14, 0x400, 256)
    with pytest.raises(ValueError, match="overlaps"):
        server_app._write_boot_image_bytes(struct.pack(f"<{TOTAL}I", *words))
    assert target.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [target]

