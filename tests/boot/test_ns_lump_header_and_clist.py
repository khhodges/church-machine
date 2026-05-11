"""Round-trip test: NS lump header and c-list encoding (Task #695).

Verifies that generate_boot_image() writes:

  * A valid lump header at memory[0] for the NS lump (Boot.NS, slot 0):
      magic=0x1F, n_minus_6=0, cw=0, cc=47, typ=0

  * The full c-list tail at words ns_size-47 .. ns_size-1  (= words 17..63
    for the default 64-word NS lump), with each slot containing the correct
    Golden Token for that catalog entry.

This is distinct from test_boot_image_matches_simulator.py which only confirms
Python and simulator agree byte-for-byte but does not name or assert
individual field values.  A failure here points directly at the broken field.
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    generate_boot_image,
    pack_lump_header,
    create_gt,
    create_abstract_gt,
    _ns_n_minus_6,
    DEFAULT_ABSTRACTION_CATALOG,
    AB_TYPE_IO,
    DEVICE_CLASS_LED,
    DEVICE_CLASS_UART,
    DEVICE_CLASS_BUTTON,
    DEVICE_CLASS_TIMER,
)

# ---------------------------------------------------------------------------
# Constants for the default config
# ---------------------------------------------------------------------------

NS_LUMP_SIZE    = 64    # step1.namespaceLumpWords
CATALOG_COUNT   = len(DEFAULT_ABSTRACTION_CATALOG)   # 47
CLIST_BASE      = NS_LUMP_SIZE - CATALOG_COUNT        # 64 - 47 = 17


def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


# ---------------------------------------------------------------------------
# Shared fixture: generate one boot image and unpack as word list
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def boot_words(tmp_path_factory):
    """Generate the default boot image once; return as a list of 32-bit ints."""
    tmp = tmp_path_factory.mktemp("lumps_ns_lump")
    img = generate_boot_image(_default_cfg(), str(tmp))
    total = 16384
    assert len(img) == total * 4
    return list(struct.unpack(f"<{total}I", img))


# ---------------------------------------------------------------------------
# 1.  NS lump header at memory[0]
# ---------------------------------------------------------------------------

def test_ns_lump_header_magic(boot_words):
    """memory[0] bits[31:27] == 0x1F (lump-trap magic)."""
    hdr = boot_words[0]
    magic = (hdr >> 27) & 0x1F
    assert magic == 0x1F, f"magic=0x{magic:02X} expected 0x1F"


def test_ns_lump_header_n_minus_6(boot_words):
    """memory[0] bits[26:23] == 0  (64-word lump: log2(64) − 6 = 0)."""
    hdr = boot_words[0]
    n_minus_6 = (hdr >> 23) & 0xF
    assert n_minus_6 == 0, (
        f"n_minus_6={n_minus_6} expected 0 for a {NS_LUMP_SIZE}-word NS lump"
    )


def test_ns_lump_header_cw(boot_words):
    """memory[0] bits[22:10] == 0  (NS lump has no code words)."""
    hdr = boot_words[0]
    cw = (hdr >> 10) & 0x1FFF
    assert cw == 0, f"cw={cw} expected 0"


def test_ns_lump_header_typ(boot_words):
    """memory[0] bits[9:8] == 0  (typ=0 = ordinary lump)."""
    hdr = boot_words[0]
    typ = (hdr >> 8) & 0x3
    assert typ == 0, f"typ={typ} expected 0"


def test_ns_lump_header_cc(boot_words):
    """memory[0] bits[7:0] == CATALOG_COUNT (one c-list slot per catalog entry)."""
    hdr = boot_words[0]
    cc = hdr & 0xFF
    assert cc == CATALOG_COUNT, f"cc={cc} expected {CATALOG_COUNT}"


def test_ns_lump_header_full_word(boot_words):
    """memory[0] equals pack_lump_header(n_minus_6=0, cw=0, cc=CATALOG_COUNT, typ=0)."""
    expected = pack_lump_header(_ns_n_minus_6(NS_LUMP_SIZE), 0, CATALOG_COUNT, 0)
    assert boot_words[0] == expected, (
        f"memory[0]=0x{boot_words[0]:08X}  expected 0x{expected:08X}"
    )


# ---------------------------------------------------------------------------
# 2.  C-list base offset sanity
# ---------------------------------------------------------------------------

def test_clist_base_offset():
    """C-list starts at word NS_LUMP_SIZE - CATALOG_COUNT for the default NS lump.

    With 50 catalog entries and a 64-word NS lump the c-list base is
    64 - 50 = 14.  (Task #760 Stage 1 grew the catalog from 47 to 50.)
    """
    expected = NS_LUMP_SIZE - CATALOG_COUNT
    assert CLIST_BASE == expected, (
        f"CLIST_BASE={CLIST_BASE}; expected {expected} for a {NS_LUMP_SIZE}-word lump "
        f"with {CATALOG_COUNT} catalog entries"
    )


# ---------------------------------------------------------------------------
# 3.  First few c-list entries (named GT words at words 17–20)
# ---------------------------------------------------------------------------

def test_mem_mgr_gt_at_clist_0(boot_words):
    """memory[17] clist[0] == R|W Inform GT for NS slot 0 (memory manager)."""
    expected = create_gt(0, 0, {"R": 1, "W": 1}, 1)
    actual = boot_words[CLIST_BASE + 0]
    assert actual == expected, (
        f"clist[0] (mem_mgr_gt) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_boot_thread_gt_at_clist_1(boot_words):
    """memory[18] clist[1] == null-perm Inform GT for NS slot 1 (Boot.Thread)."""
    expected = create_gt(0, 1, {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, 1)
    actual = boot_words[CLIST_BASE + 1]
    assert actual == expected, (
        f"clist[1] (Boot.Thread GT) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_slot2_gt_at_clist_2_is_null(boot_words):
    """clist[2] == null GT (slot 2 freed — Startup.Config removed, Task #989)."""
    actual = boot_words[CLIST_BASE + 2]
    assert actual == 0, (
        f"clist[2] (freed slot 2) should be null (0x00000000), got 0x{actual:08X}"
    )


def test_boot_abstr_gt_at_clist_3(boot_words):
    """memory[20] clist[3] == E-perm Inform GT for NS slot 3 (Boot.Abstr / LED flash)."""
    expected = create_gt(0, 3, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 3]
    assert actual == expected, (
        f"clist[3] (Boot.Abstr GT) 0x{actual:08X} != expected 0x{expected:08X}"
    )


# ---------------------------------------------------------------------------
# 4.  Hardware device Abstract GTs (clist slots 8–17)
# ---------------------------------------------------------------------------

def test_led_abstract_gts_at_clist_8_13(boot_words):
    """clist[8..13] == 6 Abstract LED GTs (R|W, device class LED, index 0..5)."""
    rw = {"R": 1, "W": 1}
    for led_idx in range(6):
        ab_data = ((DEVICE_CLASS_LED & 0xFF) << 8) | led_idx
        expected = create_abstract_gt(AB_TYPE_IO, rw, 0, ab_data)
        actual = boot_words[CLIST_BASE + 8 + led_idx]
        assert actual == expected, (
            f"clist[{8 + led_idx}] (LED[{led_idx}]) "
            f"0x{actual:08X} != expected 0x{expected:08X}"
        )


def test_uart_gt_at_clist_14(boot_words):
    """clist[14] == Abstract UART GT (R|W, reg0=TX)."""
    expected = create_abstract_gt(
        AB_TYPE_IO, {"R": 1, "W": 1}, 0, (DEVICE_CLASS_UART << 8) | 0
    )
    actual = boot_words[CLIST_BASE + 14]
    assert actual == expected, (
        f"clist[14] (UART) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_button_gt_at_clist_15(boot_words):
    """clist[15] == Abstract Button GT (R-only, reg0=state)."""
    expected = create_abstract_gt(
        AB_TYPE_IO, {"R": 1}, 0, (DEVICE_CLASS_BUTTON << 8) | 0
    )
    actual = boot_words[CLIST_BASE + 15]
    assert actual == expected, (
        f"clist[15] (Button) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_slide_rule_gt_at_clist_16(boot_words):
    """clist[16] == E-perm Inform GT for NS slot 16 (SlideRule)."""
    expected = create_gt(0, 16, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 16]
    assert actual == expected, (
        f"clist[16] (SlideRule) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_timer_gt_at_clist_17(boot_words):
    """clist[17] == Abstract Timer GT (R|W, reg0=TICKS_LO)."""
    expected = create_abstract_gt(
        AB_TYPE_IO, {"R": 1, "W": 1}, 0, (DEVICE_CLASS_TIMER << 8) | 0
    )
    actual = boot_words[CLIST_BASE + 17]
    assert actual == expected, (
        f"clist[17] (Timer) 0x{actual:08X} != expected 0x{expected:08X}"
    )


# ---------------------------------------------------------------------------
# 5.  Last few c-list entries (catalog slots 44–45) and freed slot 46
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("slot,name,perms", [
    (44, "GC",     {"E": 1}),
    (45, "Thread", {"E": 1}),
])
def test_last_clist_entries(boot_words, slot, name, perms):
    """clist[44..45] == E-perm Inform GTs for GC and Thread."""
    expected = create_gt(0, slot, perms, 1)
    actual = boot_words[CLIST_BASE + slot]
    assert actual == expected, (
        f"clist[{slot}] ({name}) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_clist_slot46_freed(boot_words):
    """clist[46] == 0 — slot 46 (Circle) was freed in Task #970."""
    actual = boot_words[CLIST_BASE + 46]
    assert actual == 0, (
        f"clist[46] (freed Circle slot) 0x{actual:08X} != expected 0x00000000"
    )


# ---------------------------------------------------------------------------
# 7.  Full c-list span — every word in words 17..63 is accounted for
# ---------------------------------------------------------------------------

def test_clist_span_length(boot_words):
    """The c-list tail occupies exactly CATALOG_COUNT words (17..63 inclusive)."""
    clist = boot_words[CLIST_BASE: CLIST_BASE + CATALOG_COUNT]
    assert len(clist) == CATALOG_COUNT, (
        f"c-list slice length {len(clist)} != {CATALOG_COUNT}"
    )
    assert CLIST_BASE + CATALOG_COUNT == NS_LUMP_SIZE, (
        f"c-list tail does not end exactly at word {NS_LUMP_SIZE - 1}"
    )
