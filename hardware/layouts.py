from amaranth import *
from amaranth.lib.data import StructLayout
from shared.architecture_contracts import GT_WORD0, NS_ENTRY
from shared.namespace_header import (
    NAMESPACE_ENTRY_WORDS,
    NAMESPACE_HEADER_V2_TAG,
    NAMESPACE_HEADER_V2_VERSION,
    NAMESPACE_HEADER_V2_WORDS,
    SEAL_START_WORD,
    encode_namespace_header,
    namespace_size_words,
    unpack_namespace_word0,
)

# Namespace Header V2 is a physical, little-endian-word boot-image record.
# These integer helpers deliberately sit beside the HDL layouts: image tools and
# hardware-focused tests can use the same bit/geometry decoder without making
# Amaranth ``View`` objects part of their file-format contract.
NAMESPACE_TYPE = 0b01
THREAD_TYPE = 0b10
NAMESPACE_HEADER_V2_MARKER = NAMESPACE_HEADER_V2_TAG
NAMESPACE_HEADER_V2_SEAL_START_WORD = SEAL_START_WORD
NAMESPACE_MIN_SIZE_FIELD = 0
NAMESPACE_MAX_SIZE_FIELD = 9                  # 8 Kiwords through 4 Miwords


def namespace_words_from_size_field(size_field):
    """Return V2 Namespace capacity in words, rejecting reserved exponents."""
    if not isinstance(size_field, int) or not (NAMESPACE_MIN_SIZE_FIELD <= size_field <= NAMESPACE_MAX_SIZE_FIELD):
        raise ValueError("Namespace V2 size field must be in range 0..9")
    return namespace_size_words(size_field)


def encode_namespace_header_v2(base_byte, size_field, slot_count, boot_entry_byte):
    """Encode the canonical 16-word Namespace Header V2 block at allocation base."""
    capacity = namespace_words_from_size_field(size_field)
    return tuple(encode_namespace_header(base_byte, capacity, slot_count, boot_entry_byte))


def decode_namespace_header_v2(words):
    """Strictly decode a Namespace Header V2 block and its fixed geometry."""
    if len(words) < NAMESPACE_HEADER_V2_WORDS:
        raise ValueError("Namespace Header V2 is truncated")
    block = tuple(words[:NAMESPACE_HEADER_V2_WORDS])
    if any(not isinstance(word, int) or not 0 <= word <= 0xFFFFFFFF for word in block):
        raise ValueError("Namespace Header V2 words must be unsigned 32-bit values")
    parsed = unpack_namespace_word0(block[0])
    if block[1] != NAMESPACE_HEADER_V2_MARKER:
        raise ValueError("unsupported or legacy Namespace header format")
    capacity, slot_count = parsed["total_words"], parsed["slots"]
    base_byte, table_offset, boot_entry_byte, seal_start = block[2:6]
    expected_table_offset = capacity - slot_count * NAMESPACE_ENTRY_WORDS
    if table_offset != expected_table_offset or table_offset < NAMESPACE_HEADER_V2_WORDS:
        raise ValueError("Namespace Header V2 table geometry is invalid")
    if base_byte != 0:
        raise ValueError("Namespace Header V2 boot-image base must be zero")
    if seal_start != NAMESPACE_HEADER_V2_SEAL_START_WORD:
        raise ValueError("Namespace Header V2 seal boundary is invalid")
    if any(block[index] != 0 for index in range(NAMESPACE_HEADER_V2_SEAL_START_WORD, NAMESPACE_HEADER_V2_WORDS)):
        raise ValueError("Namespace Header V2 deferred seal words must be zero")
    if boot_entry_byte & 3 or not NAMESPACE_HEADER_V2_WORDS * 4 <= boot_entry_byte < capacity * 4:
        raise ValueError("Namespace Header V2 boot entry is invalid")
    return {
        "version": NAMESPACE_HEADER_V2_VERSION,
        "base_byte": base_byte,
        "size_field": parsed["n_minus_13"],
        "capacity_words": capacity,
        "slot_count": slot_count,
        "table_offset_words": table_offset,
        "boot_entry_byte": boot_entry_byte,
        "seal_start_word": seal_start,
    }


def _width(field):
    return field[1] - field[0] + 1

GT_LAYOUT = StructLayout({
    name: unsigned(_width(bits))
    for name, bits in GT_WORD0["fields"].items()
})

# GT encoding reference:
#   Turing domain (dom=0): perm[2]=X, perm[1]=W, perm[0]=R
#   Church  domain (dom=1): perm[2]=E, perm[1]=S, perm[0]=L
#
# Hardcoded GT word cross-ref (slot=2, INFORM, E-perm):
#   Old: 0x40800002 (perms[5:0]@[30:25], E=bit30)
#   v1.x: 0x48800002 (dom=1@[27], perm=0b100(E)@[30:28], gt_type@[24:23])
#   v2.0: 0x4A000002 (dom=1@[27], perm=0b100(E)@[30:28], gt_type@[26:25], gt_seq 9b@[24:16]) ★v2.0

CAP_REG_LAYOUT = StructLayout({
    "word0_gt":       GT_LAYOUT,
    "word1_location": unsigned(32),
    "word2_w2":       unsigned(32),
})

WORD2_LAYOUT = StructLayout({
    name: unsigned(_width(bits))
    for name, bits in NS_ENTRY["word1"]["fields"].items()
})

LUMP_HEADER_LAYOUT = StructLayout({
    "cc":        unsigned(8),    # bits  [7:0]  — c-list slot count (0..255); Thread requires exactly 12 persisted CR0-CR11 homes at its tail
    "typ":       unsigned(2),    # bits  [9:8]  — object type: 00=lump, 01=data, 10=clist-only, 11=Outform
    "cw":        unsigned(13),   # bits [22:10] — code words (0..8191); Thread interprets this as stack words
    "n_minus_6": unsigned(4),    # bits [26:23] — lumpSize = 2^(val+6), valid range 0..8
    "magic":     unsigned(5),    # bits [31:27] — always 0x1F; traps if executed
})

# 4-word Namespace Entry layout (stride = slot_id << 4, i.e. 16 bytes per entry):
#   word0_location    (+0):  lump base byte address (32-bit pointer)
#   word1_authority   (+4):  WORD2_LAYOUT — limit_offset[20:0] | gt_seq[29:21] | g_bit[30] | f_flag[31]
#                            Identical bit layout to CR W2.  g_bit[30] and f_flag[31] are both
#                            masked before integrity32 so they are mutable without reseal. ★v2.0
#   word2_integrity   (+8):  integrity32(W0, W1 with g_bit[30] and f_flag[31] cleared) — 32-bit parallel check.
#   word3_cache_token (+12): 32-bit issue-blind content cache/index token T — NON-authoritative.
#                            Diagnostic/advisory hint only: never authenticity, ownership,
#                            revocation, or writeback authority.  NOT covered by integrity32.
#                            Built-in ROM has no trusted identity source, so every resident
#                            DEMO_NAMESPACE W3 is 0.  Hardware NEVER uses W3 to gate or authorise
#                            any M-window writeback (Task #2862).  User-mode LOAD cannot observe
#                            it — ChurchMLoad gates on the M-bit.  raw W3 may still surface in
#                            DR15 for diagnostics.
#                            (`word3_abstract_gt` is a deprecated compatibility alias only.)
#
# The lump header (LUMP_HEADER_LAYOUT) lives at word 0 of the lump itself (at word0_location),
# not in the NS table.  Hardware reads it via a separate memory fetch from word0_location.
NS_ENTRY_LAYOUT = StructLayout({
    "word0_location":    unsigned(32),
    "word1_authority":   unsigned(32),
    "word2_integrity":   unsigned(32),
    "word3_cache_token": unsigned(32),
})

SEALS_LAYOUT = StructLayout({
    "seal":    unsigned(25),
    "version": unsigned(7),
})

COND_FLAGS_LAYOUT = StructLayout({
    "N": unsigned(1),
    "Z": unsigned(1),
    "C": unsigned(1),
    "V": unsigned(1),
})
