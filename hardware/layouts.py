from amaranth import *
from amaranth.lib.data import StructLayout

GT_LAYOUT = StructLayout({
    "slot_id": unsigned(16),
    "gt_seq":  unsigned(7),
    "gt_type": unsigned(2),
    "perms":   unsigned(6),
    "b_flag":  unsigned(1),
})

CAP_REG_LAYOUT = StructLayout({
    "word0_gt":       GT_LAYOUT,
    "word1_location": unsigned(32),
    "word2_w2":       unsigned(32),
})

WORD2_LAYOUT = StructLayout({
    "limit_offset": unsigned(21),
    "gt_seq":       unsigned(7),
    "g_bit":        unsigned(1),
    "spare":        unsigned(3),
})

LUMP_HEADER_LAYOUT = StructLayout({
    "cc":        unsigned(8),    # bits  [7:0]  — c-list slot count (0..255); for typ=10 Thread: repurposed as heapWords (IDE-set max heap words; caps zone architecture-fixed at 12)
    "typ":       unsigned(2),    # bits  [9:8]  — object type: 00=lump, 01=data, 10=clist-only, 11=Outform
    "cw":        unsigned(13),   # bits [22:10] — code word count (0..8191)
    "n_minus_6": unsigned(4),    # bits [26:23] — lumpSize = 2^(val+6), valid range 0..8
    "magic":     unsigned(5),    # bits [31:27] — always 0x1F; traps if executed
})

# 4-word Namespace Entry layout (stride = slot_id << 4, i.e. 16 bytes per entry):
#   word0_location    (+0):  lump base byte address (32-bit pointer)
#   word1_authority   (+4):  WORD2_LAYOUT — limit_offset[20:0] | gt_seq[6:0] | g_bit[28] | spare[31:29]
#                            Identical bit layout to CR W2.  g_bit[28] may be set by GC without
#                            invalidating W2 (integrity32 masks g_bit before computing the check).
#   word2_integrity   (+8):  integrity32(W0, W1 with g_bit cleared) — 32-bit parallel check.
#   word3_abstract_gt (+12): Abstract GT — advisory annotation for the NS abstraction only.
#                            Encodes the permission profile expected for this slot (perms[30:25];
#                            slot_id, gt_seq, gt_type, b_flag are all zero in this word).
#                            NOT covered by integrity32 (advisory; NS abstraction trusts it,
#                            user-mode LOAD cannot observe it — ChurchMLoad gates on M-bit).
#
# The lump header (LUMP_HEADER_LAYOUT) lives at word 0 of the lump itself (at word0_location),
# not in the NS table.  Hardware reads it via a separate memory fetch from word0_location.
NS_ENTRY_LAYOUT = StructLayout({
    "word0_location":    unsigned(32),
    "word1_authority":   unsigned(32),
    "word2_integrity":   unsigned(32),
    "word3_abstract_gt": GT_LAYOUT,
})

COND_FLAGS_LAYOUT = StructLayout({
    "N": unsigned(1),
    "Z": unsigned(1),
    "C": unsigned(1),
    "V": unsigned(1),
})
