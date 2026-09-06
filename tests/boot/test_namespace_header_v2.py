"""Focused Namespace Header V2 binary-contract boundaries."""
import os
import sys
import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from shared.namespace_header import (
    NAMESPACE_ENTRY_WORDS,
    NAMESPACE_HEADER_V2_TAG,
    NAMESPACE_HEADER_V2_WORDS,
    encode_namespace_header,
    pack_namespace_word0,
    unpack_namespace_word0,
)
from server.boot_image import _locate_namespace_header
from server.boot_image import read_namespace_header_info


@pytest.mark.parametrize("words", (8192, 16384, 32768, 65536, 131072,
                                    262144, 524288, 1048576, 2097152,
                                    4194304))
def test_namespace_word0_size_mapping(words):
    decoded = unpack_namespace_word0(pack_namespace_word0(words, 8191))
    assert decoded["total_words"] == words
    assert decoded["slots"] == 8191


@pytest.mark.parametrize("slots", (0, 1, 255, 256, 1024, 8191))
def test_namespace_word0_plain_slot_count(slots):
    word = pack_namespace_word0(8192, slots)
    assert ((word >> 8) & 3) == 1
    assert word & 0xFF == 0
    assert unpack_namespace_word0(word)["slots"] == slots


@pytest.mark.parametrize("slots", (-1, 8192))
def test_namespace_word0_rejects_slot_count_boundaries(slots):
    with pytest.raises(ValueError, match="slot count"):
        pack_namespace_word0(8192, slots)


def test_physical_block_round_trip_and_geometry_rejections():
    total, slots = 8192, 4
    table = total - slots * NAMESPACE_ENTRY_WORDS
    start = 0
    words = [0] * total
    words[start:start + NAMESPACE_HEADER_V2_WORDS] = encode_namespace_header(
        0, total, slots, 32 * 4)
    # Slot 1 is the selected entry in an inverted four-word table.
    words[total - 2 * NAMESPACE_ENTRY_WORDS] = 32
    physical = _locate_namespace_header(words, "test")
    assert physical["start"] == start
    assert physical["table_base"] == table
    assert physical["boot_entry"] == 32

    words[start] |= 1  # cc is reserved in V2.
    with pytest.raises(ValueError, match="cc"):
        _locate_namespace_header(words, "test")


def test_api_decoder_reports_only_physical_header_facts():
    total, slots, boot_word = 8192, 4, 32
    words = [0] * total
    words[:NAMESPACE_HEADER_V2_WORDS] = encode_namespace_header(
        0, total, slots, boot_word * 4)
    words[total - 2 * NAMESPACE_ENTRY_WORDS] = boot_word

    info = read_namespace_header_info(
        __import__("struct").pack(f"<{total}I", *words))
    assert info == {
        "format_tag": NAMESPACE_HEADER_V2_TAG,
        "version": 2,
        "base_byte": 0,
        "total_words": total,
        "slot_count": slots,
        "table_offset_words": total - slots * NAMESPACE_ENTRY_WORDS,
        "table_offset_byte": (total - slots * NAMESPACE_ENTRY_WORDS) * 4,
        "boot_entry_word": boot_word,
        "boot_entry_byte": boot_word * 4,
        "boot_entry_slot": 1,
        "seal_boundary_word": 6,
    }


def test_legacy_tail_tag_is_not_silently_reinterpreted():
    words = [0] * 8192
    words[-1] = 0xB0073224
    with pytest.raises(ValueError, match="legacy format is unsupported"):
        _locate_namespace_header(words, "test")