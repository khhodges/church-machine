"""Namespace Header V2 physical boot-image contract.

The Namespace header is a sixteen-word block at Namespace allocation word zero.
It is deliberately separate from resident Thread bodies: the Thread body begins
after this physical header block. The four-word Namespace table is tail-anchored.

Table offsets are 32-bit word offsets; base and boot-entry locations are 32-bit
byte addresses. Images are serialized little-endian.
"""

NAMESPACE_HEADER_V2_TAG = 0x4E534832  # ASCII "NSH2"
NAMESPACE_HEADER_V2_WORDS = 16
NAMESPACE_HEADER_V2_VERSION = 2
NAMESPACE_HEADER_V2_MIN_WORDS = 1 << 13       # 8 Ki words
NAMESPACE_HEADER_V2_MAX_SLOTS = 0x1FFF        # cw is a plain 13-bit count
NAMESPACE_ENTRY_WORDS = 4

# Word indices within the physical block.
WORD0, FORMAT, BASE, TABLE_OFFSET, BOOT_ENTRY, SEAL_BOUNDARY = range(6)
SEAL_START_WORD = 6


def namespace_size_field(total_words):
    """Encode a V2 Namespace allocation: field N means 2**(N + 13) words."""
    if (isinstance(total_words, bool) or not isinstance(total_words, int)
            or total_words < NAMESPACE_HEADER_V2_MIN_WORDS
            or total_words & (total_words - 1)):
        raise ValueError("Namespace RAM allocation must be a power of two from 8K words")
    field = total_words.bit_length() - 1 - 13
    if not 0 <= field <= 9:
        raise ValueError("Namespace RAM allocation is outside the V2 header range")
    return field


def namespace_size_words(field):
    """Decode the V2 Namespace allocation field."""
    if isinstance(field, bool) or not isinstance(field, int) or not 0 <= field <= 9:
        raise ValueError("Namespace size field must be a 4-bit integer")
    return 1 << (field + 13)


def pack_namespace_word0(total_words, slots):
    """Pack V2 Word 0: magic, Namespace N-13, plain cw slot count, typ=01, cc=0."""
    if isinstance(slots, bool) or not isinstance(slots, int) or not 0 <= slots <= NAMESPACE_HEADER_V2_MAX_SLOTS:
        raise ValueError("Namespace slot count must be an integer in 0..8191")
    return ((0x1F << 27) | (namespace_size_field(total_words) << 23)
            | (slots << 10) | (1 << 8))


def unpack_namespace_word0(word):
    """Decode and validate a V2 Namespace Word 0."""
    if isinstance(word, bool) or not isinstance(word, int):
        raise ValueError("Namespace header word must be an integer")
    if ((word >> 27) & 0x1F) != 0x1F:
        raise ValueError("Namespace header has invalid magic")
    if ((word >> 8) & 0x3) != 1:
        raise ValueError("Namespace header typ must be 01")
    if word & 0xFF:
        raise ValueError("Namespace header cc is reserved and must be zero")
    return {
        "n_minus_13": (word >> 23) & 0xF,
        "total_words": namespace_size_words((word >> 23) & 0xF),
        "slots": (word >> 10) & 0x1FFF,
    }


def encode_namespace_header(base_byte, total_words, slots, boot_entry_byte):
    """Return the canonical 16-word V2 physical header block."""
    if base_byte != 0:
        raise ValueError("Namespace V2 boot-image base must be zero")
    if isinstance(boot_entry_byte, bool) or not isinstance(boot_entry_byte, int) or boot_entry_byte & 3:
        raise ValueError("Namespace V2 boot entry must be word aligned")
    table_offset = total_words - slots * NAMESPACE_ENTRY_WORDS
    if table_offset < NAMESPACE_HEADER_V2_WORDS:
        raise ValueError("Namespace V2 table overlaps its header block")
    if not NAMESPACE_HEADER_V2_WORDS * 4 <= boot_entry_byte < total_words * 4:
        raise ValueError("Namespace V2 boot entry is outside resident body area")
    return [pack_namespace_word0(total_words, slots), NAMESPACE_HEADER_V2_TAG,
            base_byte, table_offset, boot_entry_byte, SEAL_START_WORD,
            *([0] * (NAMESPACE_HEADER_V2_WORDS - SEAL_START_WORD))]


def header_start(table_offset):
    """V2 header is at the Namespace allocation base, word zero."""
    return 0