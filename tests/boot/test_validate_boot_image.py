"""Test that validate_boot_image() catches a zeroed NS slot before the simulator runs.

Task #375: The runtime BOOT fault path (simulator B:04 LOAD_NUC) is already
covered by test_boot_fault_null_ns_slot.py.  This module verifies the new
pre-flight validator that surfaces the same problem as a clear Python-level
ValueError before any image is handed to the harness.
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    BOOT_IMAGE_FORMAT_TAG,
    generate_boot_image,
    validate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _zero_ns_slot(image_bytes, cfg, slot):
    """Return a copy of image_bytes with word0 and word1 of NS slot `slot` zeroed."""
    total = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base = total - NS_TABLE_RESERVE
    slot_base = ns_table_base + slot * NS_ENTRY_WORDS
    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[slot_base]     = 0
    words[slot_base + 1] = 0
    return struct.pack(f"<{total}I", *words)


def _set_format_tag(image_bytes, cfg, tag_value):
    """Return a copy of image_bytes with the format-version tag set to tag_value."""
    total = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base = total - NS_TABLE_RESERVE
    tag_idx = ns_table_base - 1
    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[tag_idx] = tag_value & 0xFFFFFFFF
    return struct.pack(f"<{total}I", *words)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_validate_boot_image_rejects_zeroed_slot3():
    """validate_boot_image raises ValueError when BOOT_ABSTR_NS_SLOT (3) is zeroed."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    null_image = _zero_ns_slot(image, cfg, BOOT_ABSTR_NS_SLOT)
    total = int(cfg["step1"]["totalNamespaceWords"])
    with pytest.raises(ValueError, match=r"mandatory NS slot 6"):
        validate_boot_image(null_image, total)


def test_validate_boot_image_rejects_zeroed_slot0():
    """validate_boot_image raises ValueError when the NS root slot (0) is zeroed."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    null_image = _zero_ns_slot(image, cfg, 0)
    total = int(cfg["step1"]["totalNamespaceWords"])
    with pytest.raises(ValueError, match=r"mandatory NS slot 0"):
        validate_boot_image(null_image, total)


def test_validate_boot_image_rejects_zeroed_slot1():
    """validate_boot_image raises ValueError when the Thread lump slot (1) is zeroed."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    null_image = _zero_ns_slot(image, cfg, 1)
    total = int(cfg["step1"]["totalNamespaceWords"])
    with pytest.raises(ValueError, match=r"mandatory NS slot 1"):
        validate_boot_image(null_image, total)


def test_validate_boot_image_accepts_valid_image():
    """validate_boot_image does not raise for a well-formed boot image."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    total = int(cfg["step1"]["totalNamespaceWords"])
    validate_boot_image(image, total)


def test_validate_boot_image_infers_total_from_length():
    """validate_boot_image works when total_namespace_words is omitted."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    validate_boot_image(image)


def test_validate_boot_image_slot2_is_freed():
    """Slot 2 is freed (Task #989, Startup.Config removed) — zeroing it must NOT raise."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    null_image = _zero_ns_slot(image, cfg, 2)
    total = int(cfg["step1"]["totalNamespaceWords"])
    validate_boot_image(null_image, total)  # must not raise


def test_validate_boot_image_error_message_is_descriptive():
    """The ValueError message names the bad slot and mentions 'BOOT fault'."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    null_image = _zero_ns_slot(image, cfg, BOOT_ABSTR_NS_SLOT)
    total = int(cfg["step1"]["totalNamespaceWords"])
    with pytest.raises(ValueError, match=r"BOOT fault"):
        validate_boot_image(null_image, total)


def test_validate_boot_image_rejects_zero_format_tag():
    """validate_boot_image raises ValueError when format-version tag is zero (stale image)."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    stale_image = _set_format_tag(image, cfg, 0)
    total = int(cfg["step1"]["totalNamespaceWords"])
    # Backwards-scan (Task #1244) cannot find the tag → error says "not found"
    with pytest.raises(ValueError, match=r"BOOT_IMAGE_FORMAT_TAG not found"):
        validate_boot_image(stale_image, total)


def test_validate_boot_image_rejects_wrong_format_tag():
    """validate_boot_image raises ValueError when format-version tag is wrong (old version)."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    stale_image = _set_format_tag(image, cfg, 0xB0070247)
    total = int(cfg["step1"]["totalNamespaceWords"])
    # Backwards-scan (Task #1244) cannot find the tag → error says "not found"
    with pytest.raises(ValueError, match=r"BOOT_IMAGE_FORMAT_TAG not found"):
        validate_boot_image(stale_image, total)


def test_validate_boot_image_format_tag_error_message_is_descriptive():
    """The ValueError for a bad tag is descriptive about the corrupt/stale state."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    stale_image = _set_format_tag(image, cfg, 0xDEADBEEF)
    total = int(cfg["step1"]["totalNamespaceWords"])
    # Backwards-scan (Task #1244): tag not found → error describes situation clearly
    with pytest.raises(ValueError, match=r"stale or corrupt"):
        validate_boot_image(stale_image, total)


def test_validate_boot_image_format_tag_error_mentions_stale():
    """The ValueError for a bad tag mentions regeneration."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    stale_image = _set_format_tag(image, cfg, 0)
    total = int(cfg["step1"]["totalNamespaceWords"])
    with pytest.raises(ValueError, match=r"stale"):
        validate_boot_image(stale_image, total)


def test_validate_boot_image_correct_format_tag_passes():
    """validate_boot_image does not raise when the format tag is the current BOOT_IMAGE_FORMAT_TAG."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    total = int(cfg["step1"]["totalNamespaceWords"])
    validate_boot_image(image, total)
