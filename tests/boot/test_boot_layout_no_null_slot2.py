"""Regression test: A7 v1.2 memory layout — Thread LUMP at word 0, NS LUMP/TABLE at top.

A7 v1.2 inverts the v1.1 layout:
  - Thread LUMP body is at word 0 (was at ns_size in v1.1).
  - Boot.Abstr lump body immediately follows Thread (was at ns_size+thread_size).
  - NS LUMP IS the NS TABLE, placed at NS_TABLE_BASE = total − NS_TABLE_RESERVE.
  - NS slot 0 word0 = NS_TABLE_BASE (self-referential location).
  - NS slot 1 word0 = 0 (Thread at word 0).
  - NS slot 6 word0 = thread_size (Boot.Abstr immediately after Thread).

Layout under test (default config: thread=256, total=16384):

    [0x0000 .. 0x00FF]  Thread LUMP body     (256 words)
    [0x0100 .. 0x013F]  Boot.Abstr LUMP body (64 words)
    [0x0140 .. 0x3BFD]  Resident catalog lump bodies + dynamic pool (all-zero)
    [0x3BFE]            boot_entry_slot sentinel
    [0x3BFF]            BOOT_IMAGE_FORMAT_TAG
    [0x3C00 .. 0x3FFF]  NS TABLE (256 entries × 4 words)
                          slot 0 word0 = 0x3C00  (self-referential NS location)
                          slot 1 word0 = 0x0000  (Thread at word 0)
                          slot 6 word0 = 0x0100  (Boot.Abstr at thread_size)

These tests fail if generate_boot_image() regresses to the old v1.1 layout
(NS lump at word 0, Thread above it, Boot.Abstr at ns_size+thread_size).
"""
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    generate_boot_image,
    DEFAULT_ABSTRACTION_CATALOG,
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    SLOT_SIZE,
)
from server.boot_constants import BOOT_ABSTR_DEFAULT_SIZE  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

LUMP_HEADER_MAGIC = 0x1F  # bits [31:27] of every valid LUMP header word


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_image(image_bytes, total_words):
    """Unpack image bytes into a list of 32-bit little-endian words."""
    assert len(image_bytes) == total_words * 4, (
        f"Image length {len(image_bytes)} bytes does not match "
        f"totalNamespaceWords={total_words} (expected {total_words * 4} bytes)"
    )
    return list(struct.unpack(f"<{total_words}I", image_bytes))


def _compute_catalog_pool_start(ns_size, thread_size, abstr_size=None):
    """Return the word offset where the dynamic pool begins.

    Mirrors generate_boot_image()'s running_offset progression through
    DEFAULT_ABSTRACTION_CATALOG under A7 v1.2 layout rules:
      - Slot 0 (NS) is at NS_TABLE_BASE (top); does NOT advance running_offset.
      - Slot 1 (Thread) starts at running_offset=0 and advances by thread_size.
      - Slot 6 (Boot.Abstr) advances by abstr_size.
      - All other catalog entries advance by SLOT_SIZE.

    The pool starts immediately after the physical region assigned to the last
    non-None catalog entry with a RAM body.
    """
    if abstr_size is None:
        _boot_lump = os.path.join(
            LUMPS_DIR, f"{BOOT_ABSTR_NS_SLOT << 8:08x}.lump")
        abstr_size = BOOT_ABSTR_DEFAULT_SIZE
        if os.path.isfile(_boot_lump):
            try:
                with open(_boot_lump, "rb") as _f:
                    _raw = _f.read(4)
                if len(_raw) == 4:
                    _hdr = struct.unpack(">I", _raw)[0]
                    if (_hdr >> 27) == 0x1F:
                        _nm6 = (_hdr >> 23) & 0xF
                        abstr_size = 1 << (_nm6 + 6)
            except Exception:
                pass
    slot_sizes = {
        0:                  ns_size,      # unused: slot 0 at NS_TABLE_BASE
        1:                  thread_size,
        BOOT_ABSTR_NS_SLOT: abstr_size,
    }
    running_offset = 0
    for i, entry in enumerate(DEFAULT_ABSTRACTION_CATALOG):
        if entry is None:
            continue
        if i == 0:
            # A7 v1.2: NS LUMP at NS_TABLE_BASE (top), not in RAM pool.
            # Don't advance running_offset — Thread (slot 1) gets loc=0.
            continue
        my_size = slot_sizes.get(i, SLOT_SIZE)
        running_offset += my_size
    return running_offset


def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _custom_cfg():
    """Non-default thread size to confirm the no-gap formula holds generally."""
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      512,
        },
    }


def _assert_boot_abstr_at(words, thread_size, label):
    """Core A7 v1.2 assertion: Boot.Abstr header is at physAddr = thread_size.

    In A7 v1.2 the Thread LUMP occupies [0 .. thread_size-1] and Boot.Abstr
    immediately follows at [thread_size .. thread_size+63].

    Checks:
    1. The word at thread_size carries the 0x1F LUMP magic in bits [31:27].
    2. The Boot.Abstr region is NOT all-zero.
    """
    phys_abstr = thread_size

    header_word = words[phys_abstr]
    actual_magic = header_word >> 27
    assert actual_magic == LUMP_HEADER_MAGIC, (
        f"{label}: Expected LUMP magic 0x1F at word 0x{phys_abstr:04X} "
        f"(thread_size={thread_size}), "
        f"but got 0x{actual_magic:02X} (full word=0x{header_word:08X}).  "
        "Boot.Abstr should start immediately after Thread in A7 v1.2 layout."
    )

    abstr_region = words[phys_abstr : phys_abstr + BOOT_ABSTR_DEFAULT_SIZE]
    assert any(w != 0 for w in abstr_region), (
        f"{label}: Words 0x{phys_abstr:04X}–"
        f"0x{phys_abstr + BOOT_ABSTR_DEFAULT_SIZE - 1:04X} are all-zero.  "
        "Expected Boot.Abstr lump body, not an empty gap."
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_thread_lump_at_word_zero():
    """A7 v1.2: Thread LUMP header must be at word 0 (not NS lump).

    In v1.1 word 0 held the NS lump header. In A7 v1.2 the Thread LUMP starts
    at word 0, and the NS LUMP/TABLE is at NS_TABLE_BASE = total − 1024.
    """
    cfg   = _default_cfg()
    th    = int(cfg["step1"]["threadLumpWords"])   # 256
    total = int(cfg["step1"]["totalNamespaceWords"])

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    header_word  = words[0]
    actual_magic = header_word >> 27
    assert actual_magic == LUMP_HEADER_MAGIC, (
        f"Word 0x0000 = 0x{header_word:08X}: expected Thread LUMP magic 0x1F "
        f"in bits [31:27] but got 0x{actual_magic:02X}.  "
        "In A7 v1.2 the Thread LUMP must start at word 0."
    )

    # Verify the Thread region is not all-zero.
    thread_region = words[0:th]
    assert any(w != 0 for w in thread_region), (
        f"Thread LUMP region [0x0000..0x{th - 1:04X}] is entirely zero — "
        "something failed to write it."
    )


def test_boot_abstr_immediately_follows_thread_default():
    """Default config (thread=256): Boot.Abstr header at 0x0100 (= thread_size).

    In A7 v1.2 physAddr(Boot.Abstr) = threadLumpWords = 256 = 0x0100.
    """
    cfg   = _default_cfg()
    th    = int(cfg["step1"]["threadLumpWords"])   # 256
    total = int(cfg["step1"]["totalNamespaceWords"])

    assert th == 0x100, f"Test assumption: thread_size should be 0x100 got 0x{th:04X}"

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    _assert_boot_abstr_at(words, th, "default config (thread=256)")


def test_boot_abstr_immediately_follows_thread_custom():
    """Custom config (thread=512): Boot.Abstr header at 0x200 (= thread_size).

    Exercises the general physAddr=thread_size formula with a non-default size.
    """
    cfg   = _custom_cfg()
    th    = int(cfg["step1"]["threadLumpWords"])   # 512
    total = int(cfg["step1"]["totalNamespaceWords"])

    assert th == 0x200, f"Test assumption: thread_size should be 0x200 got 0x{th:04X}"

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    _assert_boot_abstr_at(words, th, "custom config (thread=512)")


def test_ns_slot0_word0_is_ns_table_base():
    """NS slot 0 word0 must equal NS_TABLE_BASE (self-referential in A7 v1.2).

    The NS LUMP IS the NS TABLE. Slot 0 word0 stores the physical base of the
    NS lump, which is NS_TABLE_BASE = totalNamespaceWords − NS_TABLE_RESERVE.
    """
    cfg   = _default_cfg()
    total = int(cfg["step1"]["totalNamespaceWords"])

    ns_table_base = total - NS_TABLE_RESERVE  # 16384 − 1024 = 15360 = 0x3C00

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    slot0_word0 = words[ns_table_base + 0 * NS_ENTRY_WORDS]
    assert slot0_word0 == ns_table_base, (
        f"NS slot 0 word0 = 0x{slot0_word0:05X}; "
        f"expected NS_TABLE_BASE = 0x{ns_table_base:05X}.  "
        "In A7 v1.2 NS slot 0 is self-referential (points to NS_TABLE_BASE)."
    )


def test_ns_slot1_word0_is_zero():
    """NS slot 1 (Thread) word0 must be 0 — Thread LUMP is at word 0 in A7 v1.2."""
    cfg   = _default_cfg()
    total = int(cfg["step1"]["totalNamespaceWords"])

    ns_table_base = total - NS_TABLE_RESERVE

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    slot1_word0 = words[ns_table_base + 1 * NS_ENTRY_WORDS]
    assert slot1_word0 == 0, (
        f"NS slot 1 (Thread) word0 = 0x{slot1_word0:08X}; expected 0 "
        "(Thread LUMP is at word 0 in A7 v1.2).  "
        "v1.1 would place Thread at ns_size (e.g. 0x0040 or 0x0400)."
    )


def test_boot_abstr_ns_entry_points_to_thread_size():
    """NS entry for Boot.Abstr (slot 6) word0 must equal thread_size = 0x0100.

    In A7 v1.2 Boot.Abstr starts immediately after Thread (at thread_size),
    so the NS entry records physAddr = thread_size, not ns_size + thread_size.
    """
    cfg   = _default_cfg()
    th    = int(cfg["step1"]["threadLumpWords"])   # 256
    total = int(cfg["step1"]["totalNamespaceWords"])

    expected_phys = th   # 0x0100

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    ns_table_base = total - NS_TABLE_RESERVE
    slot_base     = ns_table_base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS
    ns_word0      = words[slot_base]

    assert ns_word0 == expected_phys, (
        f"NS slot {BOOT_ABSTR_NS_SLOT} (Boot.Abstr) word0 = 0x{ns_word0:04X}; "
        f"expected 0x{expected_phys:04X} (= thread_size in A7 v1.2).  "
        "v1.1 would record ns_size + thread_size = 0x0140."
    )


def test_ns_table_at_top_not_at_zero():
    """The NS TABLE must be at NS_TABLE_BASE (top of memory), not at word 0.

    In v1.1 words [0..ns_size-1] held the NS lump. In A7 v1.2 those words hold
    the Thread LUMP. The NS TABLE lives at NS_TABLE_BASE = total − NS_TABLE_RESERVE.
    """
    cfg   = _default_cfg()
    total = int(cfg["step1"]["totalNamespaceWords"])

    ns_table_base = total - NS_TABLE_RESERVE  # e.g. 0x3C00

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    # At the NS TABLE base, slot 0 word0 should be ns_table_base (self-ref).
    ns_table_first_word = words[ns_table_base]
    assert ns_table_first_word == ns_table_base, (
        f"NS_TABLE_BASE (word 0x{ns_table_base:04X}) = 0x{ns_table_first_word:08X}; "
        f"expected 0x{ns_table_base:08X} (NS slot 0 self-referential location).  "
        "NS TABLE must be at the top of memory in A7 v1.2."
    )

    # Word 0 should be a LUMP header (Thread), not the NS slot 0 entry.
    word0_magic = words[0] >> 27
    assert word0_magic == LUMP_HEADER_MAGIC, (
        f"Word 0x0000 = 0x{words[0]:08X}: expected Thread LUMP header (magic 0x1F) "
        f"but got magic 0x{word0_magic:02X}.  NS TABLE must not start at word 0."
    )


def test_dynamic_pool_is_zeroed_at_boot_time():
    """The dynamic pool region (after all resident catalog lumps) is all-zero.

    The pool begins at the word address immediately after the last resident
    catalog lump's physical allocation (_compute_catalog_pool_start) and ends
    just before the two control words that precede the NS table
    (boot_entry_slot at ns_table_base-2, format tag at ns_table_base-1).

    Checked for both default and custom configs.
    """
    for label, cfg in [("default config", _default_cfg()),
                       ("custom config",  _custom_cfg())]:
        ns    = int(cfg["step1"]["namespaceLumpWords"])
        th    = int(cfg["step1"]["threadLumpWords"])
        total = int(cfg["step1"]["totalNamespaceWords"])

        pool_start    = _compute_catalog_pool_start(ns, th)
        ns_table_base = total - NS_TABLE_RESERVE
        # Three non-zero control words precede the NS table (A7 v1.2):
        #   ns_table_base-3 = stored nsCount (non-zero)
        #   ns_table_base-2 = boot_entry_slot word (non-zero)
        #   ns_table_base-1 = BOOT_IMAGE_FORMAT_TAG (non-zero)
        pool_end      = ns_table_base - 3

        assert pool_start < pool_end, (
            f"{label}: pool_start=0x{pool_start:04X} is not before pool_end=0x{pool_end:04X}"
        )

        image = generate_boot_image(cfg, LUMPS_DIR)
        words = _parse_image(image, total)

        pool_region = words[pool_start : pool_end]
        non_zero = [(pool_start + i, w) for i, w in enumerate(pool_region) if w != 0]
        assert not non_zero, (
            f"{label}: Dynamic pool words 0x{pool_start:04X}–0x{pool_end - 1:04X} "
            "should be all-zero at boot time but found non-zero words:\n"
            + "\n".join(f"  word 0x{addr:04X} = 0x{val:08X}"
                        for addr, val in non_zero[:10])
            + (f"\n  ... and {len(non_zero) - 10} more" if len(non_zero) > 10 else "")
        )
