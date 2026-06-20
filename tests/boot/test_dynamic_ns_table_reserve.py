"""Tests for dynamic NS table reserve size (Task #1244).

Verifies that ns_table_reserve_words() returns nextPow2(slots * 4) and that
generate_boot_image() places the format tag at the correct position when
nsSlotsMax is explicitly configured.

Key expectation: a config with nsSlotsMax=102 produces a 512-word NS table
reserve (nextPow2(102 * 4 = 408) = 512) instead of the old 1024-word constant.
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    BOOT_IMAGE_FORMAT_TAG,
    NS_ENTRY_WORDS,
    generate_boot_image,
    ns_table_reserve_words,
    validate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ---------------------------------------------------------------------------
# ns_table_reserve_words() unit tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ns_slots_max,expected_reserve", [
    (16,   64),    # minimum clamp: 16 * 4 = 64 → 64
    (1,    64),    # below minimum: 1 * 4 = 4 → clamp to 64
    (52,  256),    # math test: 52 * 4 = 208 → 256 (kept; catalog is now 53 entries)
    (53,  256),    # catalog size: 53 * 4 = 212 → 256
    (64,  256),    # 64 * 4 = 256 → 256
    (65,  512),    # 65 * 4 = 260 → 512
    (102, 512),    # real case: 102 * 4 = 408 → 512
    (128, 512),    # 128 * 4 = 512 → 512
    (129, 1024),   # 129 * 4 = 516 → 1024
    (256, 1024),   # default: 256 * 4 = 1024 → 1024
    (257, 2048),   # 257 * 4 = 1028 → 2048
    (512, 2048),   # 512 * 4 = 2048 → 2048
    (513, 4096),   # 513 * 4 = 2052 → 4096
])
def test_ns_table_reserve_words(ns_slots_max, expected_reserve):
    """ns_table_reserve_words returns nextPow2(slots * 4) clamped to [64, 8192]."""
    assert ns_table_reserve_words(ns_slots_max) == expected_reserve


def test_ns_table_reserve_is_power_of_two():
    """ns_table_reserve_words always returns a power of two."""
    for slots in range(1, 600, 7):
        r = ns_table_reserve_words(slots)
        assert r >= 64
        assert (r & (r - 1)) == 0, f"Result {r} for slots={slots} is not a power of 2"


def test_ns_table_reserve_default_matches_module_constant():
    """With nsSlotsMax=256, reserve == module-level NS_TABLE_RESERVE (1024)."""
    from server.boot_image import NS_TABLE_RESERVE as MODULE_RESERVE
    assert ns_table_reserve_words(256) == MODULE_RESERVE == 1024


# ---------------------------------------------------------------------------
# generate_boot_image() + validate_boot_image() integration tests
# ---------------------------------------------------------------------------

def _cfg(total, ns_slots_max=None):
    cfg = {
        "step1": {
            "totalNamespaceWords": total,
            "namespaceLumpWords":    64,
            "threadLumpWords":      256,
        }
    }
    if ns_slots_max is not None:
        cfg["step1"]["nsSlotsMax"] = ns_slots_max
    return cfg


def _find_tag_pos(image_bytes, total):
    """Scan backwards for BOOT_IMAGE_FORMAT_TAG and return its word index."""
    words = struct.unpack(f"<{total}I", image_bytes[:total * 4])
    for i in range(1, min(2048, total) + 1):
        pos = total - i
        if words[pos] == BOOT_IMAGE_FORMAT_TAG:
            return pos
    return -1


def test_default_config_reserve_is_1024():
    """Without nsSlotsMax, the NS table reserve defaults to 1024 words."""
    total = 16384
    cfg   = _cfg(total)
    image = generate_boot_image(cfg, LUMPS_DIR)
    tag   = _find_tag_pos(image, total)
    assert tag >= 0, "Format tag not found in default boot image"
    reserve = total - (tag + 1)
    assert reserve == 1024, f"Expected 1024-word reserve, got {reserve}"


def test_ns_slots_max_102_reserve_is_512():
    """nsSlotsMax=102 → nextPow2(408)=512 → reserve is 512 words."""
    total = 32768
    cfg   = _cfg(total, ns_slots_max=102)
    image = generate_boot_image(cfg, LUMPS_DIR)
    assert len(image) == total * 4

    tag = _find_tag_pos(image, total)
    assert tag >= 0, "Format tag not found in 102-slot boot image"
    reserve = total - (tag + 1)
    assert reserve == 512, f"Expected 512-word reserve for nsSlotsMax=102, got {reserve}"


def test_ns_slots_max_256_reserve_is_1024():
    """Explicitly setting nsSlotsMax=256 gives the same 1024-word reserve as the default."""
    total = 16384
    cfg   = _cfg(total, ns_slots_max=256)
    image = generate_boot_image(cfg, LUMPS_DIR)

    tag = _find_tag_pos(image, total)
    reserve = total - (tag + 1)
    assert reserve == 1024


def test_smaller_reserve_leaves_larger_pool():
    """512-word reserve (nsSlotsMax=102) gives 512 more pool words than 1024-word reserve."""
    total = 32768
    img_default = generate_boot_image(_cfg(total),              LUMPS_DIR)
    img_102     = generate_boot_image(_cfg(total, ns_slots_max=102), LUMPS_DIR)

    tag_default = _find_tag_pos(img_default, total)
    tag_102     = _find_tag_pos(img_102,     total)

    reserve_default = total - (tag_default + 1)
    reserve_102     = total - (tag_102     + 1)

    assert reserve_default == 1024
    assert reserve_102     == 512
    assert reserve_default - reserve_102 == 512


def test_validate_accepts_dynamic_reserve_image():
    """validate_boot_image passes a boot image built with nsSlotsMax=102."""
    total = 32768
    cfg   = _cfg(total, ns_slots_max=102)
    image = generate_boot_image(cfg, LUMPS_DIR)
    validate_boot_image(image, total)   # must not raise


def test_validate_accepts_default_reserve_image():
    """validate_boot_image passes a boot image built with default reserve."""
    total = 16384
    cfg   = _cfg(total)
    image = generate_boot_image(cfg, LUMPS_DIR)
    validate_boot_image(image, total)   # must not raise


def test_ns_entry_count_below_ns_slots_max_raises():
    """generate_boot_image raises when nsSlotsMax < catalog count."""
    from server.boot_image import DEFAULT_ABSTRACTION_CATALOG
    catalog_size = len(DEFAULT_ABSTRACTION_CATALOG)
    cfg = _cfg(16384, ns_slots_max=catalog_size - 1)
    with pytest.raises(ValueError, match=r"nsSlotsMax"):
        generate_boot_image(cfg, LUMPS_DIR)


def test_ns_slots_max_exactly_at_catalog_size_passes():
    """generate_boot_image succeeds when nsSlotsMax == catalog count."""
    from server.boot_image import DEFAULT_ABSTRACTION_CATALOG
    catalog_size = len(DEFAULT_ABSTRACTION_CATALOG)
    # Reserve = nextPow2(catalog_size * 4); must fit inside a 16384-word namespace
    reserve = ns_table_reserve_words(catalog_size)
    total   = max(16384, 512 + reserve)
    cfg = _cfg(total, ns_slots_max=catalog_size)
    generate_boot_image(cfg, LUMPS_DIR)   # must not raise
