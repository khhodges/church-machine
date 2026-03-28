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
    "word3_w3":       unsigned(32),
})

WORD2_LAYOUT = StructLayout({
    "limit_offset": unsigned(21),
    "gt_seq":       unsigned(7),
    "spare":        unsigned(4),
})

WORD3_LAYOUT = StructLayout({
    "crc":   unsigned(16),
    "g_bit": unsigned(1),
    "spare": unsigned(15),
})

LUMP_HEADER_LAYOUT = StructLayout({
    "cc":        unsigned(8),    # bits  [7:0]  — c-list slot count (0..255); for typ=10 Thread: repurposed as heapWords (IDE-set max heap words; caps zone architecture-fixed at 12)
    "typ":       unsigned(2),    # bits  [9:8]  — object type: 00=lump, 01=data, 10=clist-only, 11=Outform
    "cw":        unsigned(13),   # bits [22:10] — code word count (0..8191)
    "n_minus_6": unsigned(4),    # bits [26:23] — lumpSize = 2^(val+6), valid range 0..8
    "magic":     unsigned(5),    # bits [31:27] — always 0x1F; traps if executed
})

# 3-word Namespace Entry layout (stride = slot_id * 12, i.e. 12 bytes):
#   word0_location (+0):  lump base byte address (32-bit pointer)
#   word1_w2       (+4):  WORD2_LAYOUT  — limit_offset[20:0] | gt_seq[6:0] | spare[3:0]
#   word2_w3       (+8):  WORD3_LAYOUT  — crc[15:0] | g_bit | spare[14:0]
# The lump header (LUMP_HEADER_LAYOUT) lives at word 0 of the lump itself (at word0_location),
# not in the NS table.  Hardware reads it via a separate memory fetch from word0_location.
NS_ENTRY_LAYOUT = StructLayout({
    "word0_location": unsigned(32),
    "word1_w2":       unsigned(32),
    "word2_w3":       unsigned(32),
})

COND_FLAGS_LAYOUT = StructLayout({
    "N": unsigned(1),
    "Z": unsigned(1),
    "C": unsigned(1),
    "V": unsigned(1),
})
