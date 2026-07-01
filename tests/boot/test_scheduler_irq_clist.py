"""Boot-image test: Scheduler.IRQ c-list Abstract S-perm authority (Task #1918).

SCHEDULER_IRQ_CLIST now holds a single Abstract S-perm GT (0x2E000000) that
encodes CHANGE CR12/CR13 authority without requiring any NS entry.  The
old four E-perm Inform GTs pointing at Church HW Range slots 19-22 have
been removed (Task #1918 Minimal Boot Namespace).

GT word layout (Abstract S-perm):
    [31]    b_flag  = 0
    [30:28] perm3   = 0b010  (S-perm; Church domain)
    [27]    dom     = 1      (Church)
    [26:25] gt_type = 0b11   (Abstract)
    [24:16] gt_seq  = 0      (no NS slot needed)
    [15:0]  slot_id = 0      (Abstract GT — no NS slot index)

Expected word value: 0x2E000000
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from hardware.boot_rom import SCHEDULER_IRQ_CLIST  # noqa: E402
from hardware.hw_types import (  # noqa: E402
    GT_TYPE_ABSTRACT,
    PERM_MASK_S,
    gt_encode_perm,
    make_gt,
)
from server.boot_image import (  # noqa: E402
    generate_boot_image,
    NS_ENTRY_WORDS,
    NS_TABLE_RESERVE,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

SCHEDULER_NS_SLOT = 8   # Scheduler's NS slot index

EXPECTED_ABSTRACT_SPERM_GT = make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S, 0, 0)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _decode_gt(word):
    """Decode a 32-bit GT word into its component fields."""
    word = word & 0xFFFFFFFF
    return {
        "b_flag":  (word >> 31) & 0x1,
        "perm3":   (word >> 28) & 0x7,
        "dom":     (word >> 27) & 0x1,
        "gt_type": (word >> 25) & 0x3,
        "gt_seq":  (word >> 16) & 0x7F,
        "slot_id":  word        & 0xFFFF,
    }


def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def boot_words():
    """Generate a default boot image and return as a list of 32-bit words."""
    img = generate_boot_image(_default_cfg(), LUMPS_DIR)
    total = 16384
    assert len(img) == total * 4
    return list(struct.unpack(f"<{total}I", img))


# ---------------------------------------------------------------------------
# Part 1 — SCHEDULER_IRQ_CLIST constant validation
# ---------------------------------------------------------------------------

def test_scheduler_irq_clist_length():
    """SCHEDULER_IRQ_CLIST has exactly 1 entry (cc = 1): Abstract S-perm GT."""
    assert len(SCHEDULER_IRQ_CLIST) == 1, (
        f"Expected cc=1 entry (Abstract S-perm GT), got {len(SCHEDULER_IRQ_CLIST)}.  "
        "Task #1918 replaced four E-perm Inform GTs with a single Abstract S-perm GT."
    )


def test_scheduler_irq_clist_abstract_sperm_word():
    """SCHEDULER_IRQ_CLIST[0] equals the Abstract S-perm GT word (0x2E000000)."""
    actual   = SCHEDULER_IRQ_CLIST[0] & 0xFFFFFFFF
    expected = EXPECTED_ABSTRACT_SPERM_GT & 0xFFFFFFFF
    assert actual == expected, (
        f"SCHEDULER_IRQ_CLIST[0]: 0x{actual:08X} != expected 0x{expected:08X}.\n"
        f"  Expected Abstract S-perm GT: make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S, 0, 0)."
    )


def test_scheduler_irq_clist_abstract_type():
    """SCHEDULER_IRQ_CLIST[0] is an Abstract GT (gt_type=0b11)."""
    gt = _decode_gt(SCHEDULER_IRQ_CLIST[0])
    assert gt["gt_type"] == GT_TYPE_ABSTRACT, (
        f"SCHEDULER_IRQ_CLIST[0]: gt_type={gt['gt_type']:#04b}, "
        f"expected {GT_TYPE_ABSTRACT:#04b} (Abstract=0b11).\n"
        "  Pass GT_TYPE_ABSTRACT as the first argument to make_gt()."
    )


def test_scheduler_irq_clist_s_perm():
    """SCHEDULER_IRQ_CLIST[0] carries S-perm (Church domain, perm3=0b010)."""
    gt = _decode_gt(SCHEDULER_IRQ_CLIST[0])
    assert gt["dom"] == 1, (
        f"SCHEDULER_IRQ_CLIST[0]: dom={gt['dom']}, expected 1 (Church).\n"
        "  S-perm requires dom=1; use PERM_MASK_S in make_gt()."
    )
    _, expected_perm3 = gt_encode_perm(PERM_MASK_S)
    assert gt["perm3"] == expected_perm3, (
        f"SCHEDULER_IRQ_CLIST[0]: perm3={gt['perm3']:#05b}, "
        f"expected {expected_perm3:#05b} (S-perm = 0b010).\n"
        "  Check PERM_MASK_S is passed to make_gt()."
    )


# ---------------------------------------------------------------------------
# Part 2 — Generated boot image: Scheduler lump (NS slot 8) c-list
#
# Confirms that generate_boot_image() writes the Abstract S-perm GT into
# the Scheduler lump c-list tail at the correct word offset.
#
# Layout (64-word lump, cc=1):
#   Clist index 0: Abstract S-perm GT (0x2E000000)
# ---------------------------------------------------------------------------

def _scheduler_lump_base(boot_words_list):
    """Return the word offset where the Scheduler lump begins."""
    total = len(boot_words_list)
    # NS_TABLE_RESERVE = 4096 (1024 entries × 4 words); format tag at ns_table_base-1
    ns_table_base = total - NS_TABLE_RESERVE
    sched_ns_base = ns_table_base + SCHEDULER_NS_SLOT * NS_ENTRY_WORDS
    return boot_words_list[sched_ns_base]


def _scheduler_lump_cc(boot_words_list, lump_base):
    """Return the cc field from the Scheduler lump header."""
    hdr = boot_words_list[lump_base]
    return hdr & 0xFF


def _scheduler_clist_word(boot_words_list, lump_base, cc, idx):
    """Return the GT word at c-list offset idx inside the Scheduler lump."""
    lump_size = 64
    return boot_words_list[lump_base + lump_size - cc + idx]


@pytest.mark.skip(
    reason=(
        "Scheduler.IRQ is a built-in simulator handler — it has no dedicated lump "
        "in the boot image.  NS slot 8 holds SlideRule in the catalog; the Scheduler "
        "is resolved by _slotByPetName('Scheduler', 8) at runtime.  "
        "SCHEDULER_IRQ_CLIST is a simulator-side constant verified by tests 1-4 above; "
        "the boot image does not embed a separate Scheduler lump with cc=1."
    )
)
def test_scheduler_lump_cc_is_1(boot_words):
    """Scheduler lump (NS slot 8) has cc=1: single Abstract S-perm GT."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    assert cc == 1, (
        f"Scheduler lump at word {lump_base}: cc={cc}, expected 1 "
        "(one Abstract S-perm GT).\n"
        "  Check SERVICE_CLIST_DEFS slot 8 in server/boot_image.py."
    )


@pytest.mark.skip(
    reason=(
        "Scheduler.IRQ is a built-in simulator handler — no Scheduler lump in the "
        "boot image.  See test_scheduler_lump_cc_is_1 skip reason above."
    )
)
def test_scheduler_lump_clist_abstract_sperm_word(boot_words):
    """Generated Scheduler lump c-list[0] equals the Abstract S-perm GT (0x2E000000)."""
    lump_base = _scheduler_lump_base(boot_words)
    cc = _scheduler_lump_cc(boot_words, lump_base)
    actual   = _scheduler_clist_word(boot_words, lump_base, cc, 0) & 0xFFFFFFFF
    expected = EXPECTED_ABSTRACT_SPERM_GT & 0xFFFFFFFF
    assert actual == expected, (
        f"Scheduler lump c-list[0]: 0x{actual:08X} != expected 0x{expected:08X}.\n"
        f"  Expected Abstract S-perm GT (0x2E000000).\n"
        "  Check SERVICE_CLIST_DEFS slot 8 in server/boot_image.py."
    )
