"""Tests for Abstract GT encoding helpers (Task #406).

Covers:
  - create_abstract_gt() bit layout
  - Device-class constants
  - BOOT_IMAGE_FORMAT_TAG bump
  - 8-slot cold-boot NS table (slots 0-7 only by default)
  - Step-2 resident LUMPs for slots ≥8 get NS entries in boot image
  - DREAD/DWRITE routing via Node simulator (headless)
"""
import atexit
import json
import os
import struct
import subprocess
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (
    BOOT_IMAGE_FORMAT_TAG,
    DEVICE_CLASS_LED, DEVICE_CLASS_UART, DEVICE_CLASS_BUTTON,
    DEVICE_CLASS_TIMER, DEVICE_CLASS_DISPLAY,
    AB_TYPE_IO, AB_TYPE_M_ELEVATION,
    create_abstract_gt, create_gt,
    generate_boot_image,
    NS_TABLE_RESERVE, NS_ENTRY_WORDS,
    DEFAULT_ABSTRACTION_CATALOG,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

# Empty lumps dir (no 00000300.lump) used for all tests that check the
# synthesized default 64w Boot.Abstr c-list content (Task #568 — the real
# server/lumps/ may contain a saved 00000300.lump which would override the
# synthesized lump and change c-list content unexpectedly).
_EMPTY_LUMPS_DIR = tempfile.mkdtemp(prefix="gt_clist_test_")
atexit.register(lambda: __import__('shutil').rmtree(_EMPTY_LUMPS_DIR, ignore_errors=True))


# ── create_abstract_gt bit-level tests ───────────────────────────────────────

def test_abstract_gt_type_field():
    """Abstract GT always has type=0b11 at bits[24:23]."""
    gt = create_abstract_gt(0x00, {"R": 1, "W": 1}, 0, 0x0100)
    assert (gt >> 23) & 0x3 == 3, "type bits must be 0b11"


def test_abstract_gt_ab_type_field():
    """ab_type occupies bits[31:27]."""
    for ab_type in (0x00, 0x01, 0x1F):
        gt = create_abstract_gt(ab_type, {}, 0, 0)
        assert (gt >> 27) & 0x1F == ab_type, f"ab_type mismatch for 0x{ab_type:02X}"


def test_abstract_gt_rw_bits():
    """R → bit[26], W → bit[25]; X/L/S/E/B are ignored (ab_type territory)."""
    gt_r  = create_abstract_gt(0x00, {"R": 1},        0, 0)
    gt_w  = create_abstract_gt(0x00, {"W": 1},        0, 0)
    gt_rw = create_abstract_gt(0x00, {"R": 1, "W": 1}, 0, 0)
    gt_0  = create_abstract_gt(0x00, {},               0, 0)
    assert (gt_r  >> 26) & 1 == 1 and (gt_r  >> 25) & 1 == 0
    assert (gt_w  >> 26) & 1 == 0 and (gt_w  >> 25) & 1 == 1
    assert (gt_rw >> 26) & 1 == 1 and (gt_rw >> 25) & 1 == 1
    assert (gt_0  >> 26) & 1 == 0 and (gt_0  >> 25) & 1 == 0


def test_abstract_gt_gt_seq_field():
    """gt_seq occupies bits[22:16]."""
    for seq in (0, 1, 63, 127):
        gt = create_abstract_gt(0x00, {}, seq, 0)
        assert (gt >> 16) & 0x7F == seq, f"gt_seq mismatch for {seq}"


def test_abstract_gt_ab_data_field():
    """ab_data occupies bits[15:0]."""
    for data in (0x0000, 0x0100, 0x0105, 0xFFFF):
        gt = create_abstract_gt(0x00, {}, 0, data)
        assert gt & 0xFFFF == data, f"ab_data mismatch for 0x{data:04X}"


def test_abstract_gt_io_led_encoding():
    """ab_data=[15:8]=device_class,[7:0]=device_data for I/O GTs."""
    ab_data = (DEVICE_CLASS_LED << 8) | 3     # LED pin 3
    gt = create_abstract_gt(AB_TYPE_IO, {"R": 1, "W": 1}, 0, ab_data)
    assert (gt >> 27) & 0x1F == AB_TYPE_IO
    assert (gt & 0xFF00) >> 8 == DEVICE_CLASS_LED
    assert (gt & 0x00FF) == 3


def test_abstract_gt_is_32bit():
    """All fields fit in 32 bits; no truncation."""
    gt = create_abstract_gt(0x1F, {"R": 1, "W": 1}, 127, 0xFFFF)
    assert 0 <= gt <= 0xFFFFFFFF


def test_abstract_gt_led0_known_value():
    """LED[0] Abstract GT encodes to the documented 0x07800100."""
    ab_data = (DEVICE_CLASS_LED << 8) | 0
    gt = create_abstract_gt(AB_TYPE_IO, {"R": 1, "W": 1}, 0, ab_data)
    assert gt == 0x07800100, f"LED[0] GT = 0x{gt:08X}, expected 0x07800100"


# ── device-class constant values ─────────────────────────────────────────────

def test_device_class_constants():
    assert DEVICE_CLASS_LED     == 0x01
    assert DEVICE_CLASS_UART    == 0x02
    assert DEVICE_CLASS_BUTTON  == 0x03
    assert DEVICE_CLASS_TIMER   == 0x04
    assert DEVICE_CLASS_DISPLAY == 0x05


def test_ab_type_constants():
    assert AB_TYPE_IO          == 0x00
    assert AB_TYPE_M_ELEVATION == 0x01


# ── BOOT_IMAGE_FORMAT_TAG ────────────────────────────────────────────────────

def test_boot_image_format_tag_is_task_568():
    """BOOT_IMAGE_FORMAT_TAG was bumped to 0xB0070563 for Task #568 (dynamic Boot.Abstr)."""
    assert BOOT_IMAGE_FORMAT_TAG == 0xB0070563, (
        f"Expected 0xB0070563, got 0x{BOOT_IMAGE_FORMAT_TAG:08X}"
    )


def test_boot_image_contains_correct_format_tag():
    """Generated boot image has the updated format tag at NS_TABLE_BASE-1."""
    cfg = {"step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
        "threadLumpWords": 256,
    }}
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img)//4}I", img)
    total = len(words)
    tag_idx = total - NS_TABLE_RESERVE - 1
    assert words[tag_idx] == BOOT_IMAGE_FORMAT_TAG


# ── perm validation (Task #406 requirement) ──────────────────────────────────

@pytest.mark.parametrize("bad_perm", ["X", "L", "S", "E", "B"])
def test_create_abstract_gt_rejects_illegal_perms(bad_perm):
    """create_abstract_gt raises ValueError for X/L/S/E/B perm bits."""
    with pytest.raises(ValueError, match=bad_perm):
        create_abstract_gt(AB_TYPE_IO, {bad_perm: 1}, 0, 0x0100)


def test_create_abstract_gt_accepts_only_rw():
    """create_abstract_gt accepts R and W without raising."""
    gt = create_abstract_gt(AB_TYPE_IO, {"R": 1, "W": 1}, 0, 0x0100)
    assert (gt >> 26) & 1 == 1   # R at bit[26]
    assert (gt >> 25) & 1 == 1   # W at bit[25]


def test_create_abstract_gt_no_perms_ok():
    """create_abstract_gt with empty perms dict is valid."""
    gt = create_abstract_gt(AB_TYPE_IO, {}, 0, 0x0100)
    assert (gt >> 25) & 0x3 == 0   # neither R nor W


# ── LED NS slot 12 freed (Task #406 requirement) ─────────────────────────────

def test_led_ns_slot_12_is_freed():
    """NS slot 12 (LED) must have an all-zero NS table entry (freed, not allocated)."""
    cfg = {"step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
        "threadLumpWords": 256,
    }}
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img) // 4}I", img)
    total = len(words)
    ns_table_base = total - NS_TABLE_RESERVE
    # NS slot 12: 4 words starting at ns_table_base + 12 * NS_ENTRY_WORDS
    slot12_base = ns_table_base + 12 * NS_ENTRY_WORDS
    entry_words = [words[slot12_base + i] for i in range(NS_ENTRY_WORDS)]
    assert all(w == 0 for w in entry_words), (
        f"NS slot 12 should be all zeros (freed), got {[hex(w) for w in entry_words]}"
    )


# ── UART/Button/Timer NS slots 11/13/14 freed (Task #431 requirement) ─────────

def test_uart_btn_timer_ns_slots_are_freed():
    """NS slots 11 (UART), 13 (Button), 14 (Timer) must be all-zero (freed)."""
    cfg = {"step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
        "threadLumpWords": 256,
    }}
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img) // 4}I", img)
    total = len(words)
    ns_table_base = total - NS_TABLE_RESERVE
    for slot_idx in (11, 13, 14):
        base = ns_table_base + slot_idx * NS_ENTRY_WORDS
        entry_words = [words[base + i] for i in range(NS_ENTRY_WORDS)]
        assert all(w == 0 for w in entry_words), (
            f"NS slot {slot_idx} should be all zeros (freed), "
            f"got {[hex(w) for w in entry_words]}"
        )


# ── 8-slot cold-boot baseline (Task #1930) ────────────────────────────────────

def test_cold_boot_slot_8_is_empty():
    """NS slot 8 must be all-zero at cold boot (no Step 2 config)."""
    cfg = {"step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
        "threadLumpWords": 256,
    }}
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img) // 4}I", img)
    total = len(words)
    ns_table_base = total - NS_TABLE_RESERVE
    base = ns_table_base + 8 * NS_ENTRY_WORDS
    entry_words = [words[base + i] for i in range(NS_ENTRY_WORDS)]
    assert all(w == 0 for w in entry_words), (
        f"NS slot 8 should be all zeros at cold boot, got {[hex(w) for w in entry_words]}"
    )


def test_step2_resident_slot_8_gets_ns_entry():
    """A Step-2 resident LUMP at slot 8 must produce a non-zero NS entry."""
    SLOT8_PHYS = 0x0800
    SLOT8_SIZE = 64
    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords": 64,
            "threadLumpWords": 256,
        },
        "step2": {
            "lumps": [{"nsSlot": 8, "resident": True, "physAddr": SLOT8_PHYS, "lumpSize": SLOT8_SIZE}]
        },
    }
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img) // 4}I", img)
    total = len(words)
    ns_table_base = total - NS_TABLE_RESERVE
    base = ns_table_base + 8 * NS_ENTRY_WORDS
    loc_word = words[base + 0]
    assert loc_word == SLOT8_PHYS, (
        f"NS slot 8 location word should be 0x{SLOT8_PHYS:04X}, got 0x{loc_word:08X}"
    )
    word1 = words[base + 1]
    lim17 = word1 & 0x1FFFF
    assert lim17 == SLOT8_SIZE - 1, (
        f"NS slot 8 lim17 should be {SLOT8_SIZE - 1}, got {lim17}"
    )


def test_step2_lazy_slot_8_stays_empty():
    """A Step-2 lazy (resident=False) LUMP at slot 8 must leave its NS entry all-zero."""
    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords": 64,
            "threadLumpWords": 256,
        },
        "step2": {
            "lumps": [{"nsSlot": 8, "resident": False}]
        },
    }
    img = generate_boot_image(cfg, _EMPTY_LUMPS_DIR)
    words = struct.unpack(f"<{len(img) // 4}I", img)
    total = len(words)
    ns_table_base = total - NS_TABLE_RESERVE
    base = ns_table_base + 8 * NS_ENTRY_WORDS
    entry_words = [words[base + i] for i in range(NS_ENTRY_WORDS)]
    assert all(w == 0 for w in entry_words), (
        f"NS slot 8 (lazy) should be all zeros; got {[hex(w) for w in entry_words]}"
    )
