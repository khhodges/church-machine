"""Hardware-facing Namespace Header V2 binary-contract tests."""
import pytest

from hardware.layouts import (
    NAMESPACE_ENTRY_WORDS,
    NAMESPACE_HEADER_V2_MARKER,
    NAMESPACE_HEADER_V2_SEAL_START_WORD,
    NAMESPACE_HEADER_V2_WORDS,
    decode_namespace_header_v2,
    encode_namespace_header_v2,
)
from shared.namespace_header import encode_namespace_header


@pytest.mark.parametrize("size_field", range(10))
def test_namespace_v2_size_mapping_8k_through_4m(size_field):
    words = encode_namespace_header_v2(0, size_field, 0, NAMESPACE_HEADER_V2_WORDS * 4)
    decoded = decode_namespace_header_v2(words)
    assert decoded["capacity_words"] == 1 << (size_field + 13)
    assert decoded["table_offset_words"] == decoded["capacity_words"]


@pytest.mark.parametrize("slot_count", (0, 1, 8191))
def test_namespace_v2_plain_slot_count_and_four_word_tail(slot_count):
    words = encode_namespace_header_v2(0, 9, slot_count, NAMESPACE_HEADER_V2_WORDS * 4)
    decoded = decode_namespace_header_v2(words)
    assert decoded["slot_count"] == slot_count
    assert decoded["table_offset_words"] == (1 << 22) - slot_count * NAMESPACE_ENTRY_WORDS


def test_namespace_v2_boot_entry_round_trip_and_deferred_seal_boundary():
    words = encode_namespace_header_v2(0, 0, 17, 0x140)
    decoded = decode_namespace_header_v2(words)
    assert decoded["boot_entry_byte"] == 0x140
    assert words[1] == NAMESPACE_HEADER_V2_MARKER
    assert decoded["seal_start_word"] == NAMESPACE_HEADER_V2_SEAL_START_WORD
    assert len(words) == NAMESPACE_HEADER_V2_WORDS
    assert all(word == 0 for word in words[NAMESPACE_HEADER_V2_SEAL_START_WORD:])
    assert words == tuple(encode_namespace_header(0, 8192, 17, 0x140))


@pytest.mark.parametrize("mutate", (
    lambda words: words.__setitem__(0, words[0] | 1),             # cc != 0
    lambda words: words.__setitem__(1, 0),                         # legacy/unknown
    lambda words: words.__setitem__(3, words[3] - 1),              # non-tail table
    lambda words: words.__setitem__(4, 2),                         # unaligned boot entry
    lambda words: words.__setitem__(6, 1),                         # premature seal data
))
def test_namespace_v2_rejects_malformed_header_boundaries(mutate):
    words = list(encode_namespace_header_v2(0, 0, 0, NAMESPACE_HEADER_V2_WORDS * 4))
    mutate(words)
    with pytest.raises(ValueError):
        decode_namespace_header_v2(words)


def test_namespace_v2_rejects_impossible_capacity_and_slot_boundaries():
    with pytest.raises(ValueError):
        encode_namespace_header_v2(0, 10, 0, 64)
    with pytest.raises(ValueError):
        encode_namespace_header_v2(0, 9, 8192, 64)
    # An 8K allocation cannot hold 8,191 four-word entries plus the header.
    with pytest.raises(ValueError):
        encode_namespace_header_v2(0, 0, 8191, 64)