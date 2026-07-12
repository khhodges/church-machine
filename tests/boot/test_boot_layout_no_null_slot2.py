"""Regression test: Boot.Abstr sits immediately after Thread lump — no null-slot-2 gap.

Task #1205 removed the 64-word physical reservation that used to hold a zeroed
NS slot 2 body between the Thread lump and Boot.Abstr.  This test enforces that
the gap is absent from every boot image produced by generate_boot_image().

Layout under test (default config: ns=64, thread=256):

    [0x0000 .. 0x003F]  Namespace lump body  (64 words)
    [0x0040 .. 0x013F]  Thread lump body     (256 words)
    [0x0140 .. 0x017F]  Boot.Abstr lump body (64 words) ← must start HERE
    [0x0180 .. 0x08BF]  Resident catalog lump bodies (service c-lists etc.)
    [0x08C0 .. 0x3BFF]  Dynamic pool         (all-zero at boot time)
    [0x3C00 .. 0x3FFF]  NS table (256 entries × 4 words)

Before Task #1205 a zeroed 64-word block occupied 0x0140–0x017F (the old NS
slot 2 physical reservation), pushing Boot.Abstr to 0x0180.  The assertions
below prove that the old gap region is no longer all-zero, that Boot.Abstr's
lump header magic is present at the exact offset physAddr = ns_size + thread_size,
and that the dynamic pool (the zero region between resident lumps and the NS
table) is correctly initialized to zero.

Dynamic pool note
-----------------
The dynamic pool does NOT start at 0x0180 — that region is occupied by the
service c-list lump bodies for resident catalog abstractions (Salvation,
Navana, Mint, etc.).  The pool starts at the word address immediately after the
last resident catalog lump, computed by mirroring generate_boot_image()'s
running_offset progression through DEFAULT_ABSTRACTION_CATALOG.
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


def _compute_catalog_pool_start(ns_size, thread_size,
                                abstr_size=None):
    """Return the word offset where the dynamic pool begins.

    Mirrors generate_boot_image()'s running_offset progression through
    DEFAULT_ABSTRACTION_CATALOG so we know exactly where the last catalog
    lump ends and the unallocated (all-zero) pool begins.

    The pool starts immediately after the physical region assigned to the last
    non-None catalog entry, regardless of whether that entry's lump body is
    actually written into the image (some entries have no code or c-list and
    therefore remain all-zero, but their physical slot is still reserved).

    abstr_size defaults to the lump_size read from the saved Boot.Abstr lump
    on disk (mirroring generate_boot_image()), falling back to
    BOOT_ABSTR_DEFAULT_SIZE if the file is absent or unreadable.
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
        0:                  ns_size,
        1:                  thread_size,
        BOOT_ABSTR_NS_SLOT: abstr_size,
    }
    running_offset = 0
    for i, entry in enumerate(DEFAULT_ABSTRACTION_CATALOG):
        if entry is None:
            if i == 0:
                running_offset = slot_sizes[0]
            continue
        my_size = slot_sizes.get(i, SLOT_SIZE)
        if i == 0:
            running_offset = my_size
        else:
            running_offset += my_size
    return running_offset


def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _custom_cfg():
    """Non-default ns/thread sizes to confirm the no-gap formula holds generally."""
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":    128,
            "threadLumpWords":       512,
        },
    }


def _assert_boot_abstr_at(words, ns_size, thread_size, label):
    """Core assertions: Boot.Abstr header is at physAddr = ns_size + thread_size
    with no null-gap between the Thread lump and Boot.Abstr.

    Checks:
    1. The word at physAddr carries the 0x1F LUMP magic in bits [31:27].
    2. The entire Boot.Abstr region (physAddr .. physAddr+63) is NOT all-zero.
    """
    phys_abstr = ns_size + thread_size

    header_word = words[phys_abstr]
    actual_magic = header_word >> 27
    assert actual_magic == LUMP_HEADER_MAGIC, (
        f"{label}: Expected LUMP magic 0x1F at word 0x{phys_abstr:04X} "
        f"(ns_size={ns_size}, thread_size={thread_size}), "
        f"but got 0x{actual_magic:02X} (full word=0x{header_word:08X}).  "
        "Boot.Abstr may have been pushed forward by a null-slot-2 gap."
    )

    abstr_region = words[phys_abstr : phys_abstr + BOOT_ABSTR_DEFAULT_SIZE]
    assert any(w != 0 for w in abstr_region), (
        f"{label}: Words 0x{phys_abstr:04X}–"
        f"0x{phys_abstr + BOOT_ABSTR_DEFAULT_SIZE - 1:04X} are all-zero.  "
        "This looks like the old null-slot-2 gap, not a Boot.Abstr lump body."
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_default_config_boot_abstr_at_0x0140():
    """Default config (ns=64, thread=256): Boot.Abstr header must be at 0x0140.

    If the null-slot-2 gap were still present, Boot.Abstr would be at 0x0180
    and 0x0140–0x017F would be all-zero.  This test fails in that scenario.
    """
    cfg   = _default_cfg()
    ns    = int(cfg["step1"]["namespaceLumpWords"])
    th    = int(cfg["step1"]["threadLumpWords"])
    total = int(cfg["step1"]["totalNamespaceWords"])

    expected_phys = ns + th  # 64 + 256 = 320 = 0x0140
    assert expected_phys == 0x0140, (
        f"Test assumption: physAddr should be 0x0140 but got 0x{expected_phys:04X}"
    )

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    old_gap_region = words[0x0140 : 0x0180]
    assert any(w != 0 for w in old_gap_region), (
        "Words 0x0140–0x017F are all-zero — the null-slot-2 gap appears to have "
        "been reintroduced.  Boot.Abstr must occupy this region directly."
    )

    _assert_boot_abstr_at(words, ns, th, "default config")


def test_default_config_boot_abstr_header_word_is_correct():
    """Boot.Abstr header word at 0x0140 carries the 0x1F magic (not an all-zero gap word)."""
    cfg   = _default_cfg()
    total = int(cfg["step1"]["totalNamespaceWords"])

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    header_word  = words[0x0140]
    actual_magic = header_word >> 27
    assert actual_magic == LUMP_HEADER_MAGIC, (
        f"Word 0x0140 = 0x{header_word:08X}: expected LUMP magic 0x1F in bits [31:27] "
        f"but got 0x{actual_magic:02X}.  "
        "The null-slot-2 gap (all-zero) may have been reintroduced before Boot.Abstr."
    )


def test_custom_config_boot_abstr_immediately_follows_thread_lump():
    """Custom config (ns=128, thread=512): Boot.Abstr is at ns+thread = 0x0280.

    With the null-slot-2 gap removed, physAddr = namespaceLumpWords + threadLumpWords
    in all configurations.  A custom config exercises the general formula.
    """
    cfg   = _custom_cfg()
    ns    = int(cfg["step1"]["namespaceLumpWords"])   # 128
    th    = int(cfg["step1"]["threadLumpWords"])       # 512
    total = int(cfg["step1"]["totalNamespaceWords"])

    expected_phys = ns + th  # 128 + 512 = 640 = 0x0280
    assert expected_phys == 0x0280, (
        f"Test assumption: physAddr should be 0x0280 but got 0x{expected_phys:04X}"
    )

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    _assert_boot_abstr_at(words, ns, th, "custom config (ns=128, thread=512)")


def test_no_null_gap_in_default_image():
    """Comprehensive null-gap regression: no 64-word all-zero block at the old gap address.

    Before Task #1205 a 64-word zeroed block sat at 0x0140–0x017F.
    This test fails if any future change reintroduces such a block.
    """
    cfg   = _default_cfg()
    total = int(cfg["step1"]["totalNamespaceWords"])

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    candidate = words[0x0140 : 0x0180]
    assert any(w != 0 for w in candidate), (
        "Words 0x0140–0x017F (the old null-slot-2 gap region) are entirely zero.  "
        "The null-slot-2 physical reservation has been reintroduced.  "
        "Boot.Abstr must occupy 0x0140–0x017F directly (no gap before it)."
    )


def test_boot_abstr_ns_entry_points_to_0x0140():
    """NS table entry for Boot.Abstr (NS slot 3) must record physAddr = 0x0140.

    The NS entry word0 stores the physical base address.  If the null-slot-2 gap
    were present, the entry would point to 0x0180 instead.
    """
    cfg   = _default_cfg()
    ns    = int(cfg["step1"]["namespaceLumpWords"])    # 64
    th    = int(cfg["step1"]["threadLumpWords"])        # 256
    total = int(cfg["step1"]["totalNamespaceWords"])

    expected_phys = ns + th  # 0x0140

    image = generate_boot_image(cfg, LUMPS_DIR)
    words = _parse_image(image, total)

    ns_table_base = total - NS_TABLE_RESERVE
    slot_base     = ns_table_base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS
    ns_word0      = words[slot_base]   # physAddr stored in word0

    assert ns_word0 == expected_phys, (
        f"NS slot {BOOT_ABSTR_NS_SLOT} (Boot.Abstr) word0 = 0x{ns_word0:04X}; "
        f"expected physAddr 0x{expected_phys:04X} (= ns_size + thread_size).  "
        "If word0 = 0x0180, the null-slot-2 gap has been reintroduced."
    )


def test_dynamic_pool_is_zeroed_at_boot_time():
    """The dynamic pool region (after all resident catalog lumps) is all-zero.

    The pool begins at the word address immediately after the last resident
    catalog lump's physical allocation (_compute_catalog_pool_start) and ends
    just before the two control words that precede the NS table
    (boot_entry_slot at ns_table_base-2, format tag at ns_table_base-1).

    This test is checked for both the default config and the custom config so
    that _compute_catalog_pool_start's formula is exercised with different
    ns/thread sizes.

    Note: the pool does NOT start at 0x0180 — that region is occupied by
    resident service c-list lump bodies (Salvation, Navana, Mint, etc.).
    The pool start depends on the number of non-None catalog entries and
    their sizes.
    """
    for label, cfg in [("default config", _default_cfg()),
                       ("custom config",  _custom_cfg())]:
        ns    = int(cfg["step1"]["namespaceLumpWords"])
        th    = int(cfg["step1"]["threadLumpWords"])
        total = int(cfg["step1"]["totalNamespaceWords"])

        pool_start    = _compute_catalog_pool_start(ns, th)
        ns_table_base = total - NS_TABLE_RESERVE
        # ns_table_base-2 = boot_entry_slot word (non-zero)
        # ns_table_base-1 = BOOT_IMAGE_FORMAT_TAG (non-zero)
        pool_end      = ns_table_base - 2

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
