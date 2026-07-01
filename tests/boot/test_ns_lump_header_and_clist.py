"""Round-trip test: NS lump header and c-list encoding (Task #695, updated #1918).

Verifies that generate_boot_image() writes:

  * A valid lump header at memory[0] for the NS lump (Boot.NS, slot 0):
      magic=0x1F, n_minus_6=0, cw=0, cc=44, typ=0

  * The full c-list tail at words ns_size-44 .. ns_size-1  (= words 20..63
    for the default 64-word NS lump), with each slot containing the correct
    Golden Token for that catalog entry.

Task #1918 reduced the catalog from 53 to 44 entries (8-slot minimal boot
namespace: slots 0-7 for boot, 8-43 for extended abstractions).
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
    _ns_n_minus_6,
    DEFAULT_ABSTRACTION_CATALOG,
)

# ---------------------------------------------------------------------------
# Constants for the default config
# ---------------------------------------------------------------------------

NS_LUMP_SIZE    = 64    # step1.namespaceLumpWords
CATALOG_COUNT   = len(DEFAULT_ABSTRACTION_CATALOG)   # 44
CLIST_BASE      = NS_LUMP_SIZE - CATALOG_COUNT        # 64 - 44 = 20


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

    With 44 catalog entries and a 64-word NS lump the c-list base is
    64 - 44 = 20.  (Task #1918 reduced the catalog from 53 to 44 entries.)
    """
    expected = NS_LUMP_SIZE - CATALOG_COUNT
    assert CLIST_BASE == expected, (
        f"CLIST_BASE={CLIST_BASE}; expected {expected} for a {NS_LUMP_SIZE}-word lump "
        f"with {CATALOG_COUNT} catalog entries"
    )


# ---------------------------------------------------------------------------
# 3.  First few c-list entries (minimal boot slots 0-7)
# ---------------------------------------------------------------------------

def test_mem_mgr_gt_at_clist_0(boot_words):
    """clist[0] == R|W Inform GT for NS slot 0 (Boot.NS memory manager)."""
    expected = create_gt(0, 0, {"R": 1, "W": 1}, 1)
    actual = boot_words[CLIST_BASE + 0]
    assert actual == expected, (
        f"clist[0] (mem_mgr_gt) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_boot_thread_gt_at_clist_1(boot_words):
    """clist[1] == null-perm Inform GT for NS slot 1 (Boot.Thread)."""
    expected = create_gt(0, 1, {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, 1)
    actual = boot_words[CLIST_BASE + 1]
    assert actual == expected, (
        f"clist[1] (Boot.Thread GT) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_uart_dev_gt_at_clist_2(boot_words):
    """clist[2] == R|W Inform GT for NS slot 2 (UART_DEV MMIO)."""
    expected = create_gt(0, 2, {"R": 1, "W": 1}, 1)
    actual = boot_words[CLIST_BASE + 2]
    assert actual == expected, (
        f"clist[2] (UART_DEV) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_led_dev_gt_at_clist_3(boot_words):
    """clist[3] == R|W Inform GT for NS slot 3 (LED_DEV MMIO)."""
    expected = create_gt(0, 3, {"R": 1, "W": 1}, 1)
    actual = boot_words[CLIST_BASE + 3]
    assert actual == expected, (
        f"clist[3] (LED_DEV) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_btn_dev_gt_at_clist_4(boot_words):
    """clist[4] == R-perm Inform GT for NS slot 4 (BTN_DEV MMIO)."""
    expected = create_gt(0, 4, {"R": 1}, 1)
    actual = boot_words[CLIST_BASE + 4]
    assert actual == expected, (
        f"clist[4] (BTN_DEV) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_timer_dev_gt_at_clist_5(boot_words):
    """clist[5] == R|W Inform GT for NS slot 5 (TIMER_DEV MMIO)."""
    expected = create_gt(0, 5, {"R": 1, "W": 1}, 1)
    actual = boot_words[CLIST_BASE + 5]
    assert actual == expected, (
        f"clist[5] (TIMER_DEV) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_selftest_gt_at_clist_6(boot_words):
    """clist[6] == E-perm Inform GT for NS slot 6 (SelfTest / Boot.Abstr)."""
    expected = create_gt(0, 6, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 6]
    assert actual == expected, (
        f"clist[6] (SelfTest) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_slot7_gt_at_clist_7_is_null(boot_words):
    """clist[7] == null GT (slot 7 = programmable/free)."""
    actual = boot_words[CLIST_BASE + 7]
    assert actual == 0, (
        f"clist[7] (programmable slot 7) should be null (0x00000000), got 0x{actual:08X}"
    )


# ---------------------------------------------------------------------------
# 4.  Extended abstraction slots (8+)
# ---------------------------------------------------------------------------

def test_slide_rule_gt_at_clist_8(boot_words):
    """clist[8] == E-perm Inform GT for NS slot 8 (SlideRule)."""
    expected = create_gt(0, 8, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 8]
    assert actual == expected, (
        f"clist[8] (SlideRule) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_tunnel_gt_at_clist_22(boot_words):
    """clist[22] == E-perm Inform GT for NS slot 22 (Tunnel)."""
    expected = create_gt(0, 22, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 22]
    assert actual == expected, (
        f"clist[22] (Tunnel) 0x{actual:08X} != expected 0x{expected:08X}"
    )


def test_keystone_gt_at_clist_23(boot_words):
    """clist[23] == E-perm Inform GT for NS slot 23 (Keystone)."""
    expected = create_gt(0, 23, {"E": 1}, 1)
    actual = boot_words[CLIST_BASE + 23]
    assert actual == expected, (
        f"clist[23] (Keystone) 0x{actual:08X} != expected 0x{expected:08X}"
    )


@pytest.mark.parametrize("slot,name,perms", [
    (35, "GC",     {"E": 1}),
    (36, "Thread", {"E": 1}),
])
def test_gc_thread_clist_entries(boot_words, slot, name, perms):
    """clist[35] and clist[36] == E-perm Inform GTs for GC and Thread."""
    expected = create_gt(0, slot, perms, 1)
    actual = boot_words[CLIST_BASE + slot]
    assert actual == expected, (
        f"clist[{slot}] ({name}) 0x{actual:08X} != expected 0x{expected:08X}"
    )


# ---------------------------------------------------------------------------
# 5.  Full c-list span — every word in words 20..63 is accounted for
# ---------------------------------------------------------------------------

def test_clist_span_length(boot_words):
    """The c-list tail occupies exactly CATALOG_COUNT words (20..63 inclusive)."""
    clist = boot_words[CLIST_BASE: CLIST_BASE + CATALOG_COUNT]
    assert len(clist) == CATALOG_COUNT, (
        f"c-list slice length {len(clist)} != {CATALOG_COUNT}"
    )
    assert CLIST_BASE + CATALOG_COUNT == NS_LUMP_SIZE, (
        f"c-list tail does not end exactly at word {NS_LUMP_SIZE - 1}"
    )
