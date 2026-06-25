from amaranth import *
from amaranth.lib.data import StructLayout

GT_LAYOUT = StructLayout({
    "slot_id": unsigned(16),   # [15:0]  — namespace slot index
    "gt_seq":  unsigned(9),    # [24:16] — revocation counter (9-bit; 0–511) ★v2.0
    "gt_type": unsigned(2),    # [26:25] — 00=NULL 01=Inform 10=Outform 11=Abstract ★v2.0
    "dom":     unsigned(1),    # [27]    — domain: 0=Turing {X,W,R}, 1=Church {E,S,L}
    "perm":    unsigned(3),    # [30:28] — 3-bit payload (dom=0: X/W/R; dom=1: E/S/L)
    "b_flag":  unsigned(1),    # [31]    — bindable override (I/O devices; excluded from CRC)
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
    "limit_offset": unsigned(21),  # [20:0]  — lump size boundary
    "gt_seq":       unsigned(9),   # [29:21] — revocation counter (9-bit; matches GT.gt_seq) ★v2.0
    "g_bit":        unsigned(1),   # [30]    — GC mark bit (mutable without reseal) ★v2.0
    "f_flag":       unsigned(1),   # [31]    — Far indicator (moved from GT[25]) ★v2.0
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
#   word1_authority   (+4):  WORD2_LAYOUT — limit_offset[20:0] | gt_seq[29:21] | g_bit[30] | f_flag[31]
#                            Identical bit layout to CR W2.  g_bit[30] and f_flag[31] are both
#                            masked before integrity32 so they are mutable without reseal. ★v2.0
#   word2_integrity   (+8):  integrity32(W0, W1 with g_bit[30] and f_flag[31] cleared) — 32-bit parallel check.
#   word3_abstract_gt (+12): Abstract GT — advisory annotation for the NS abstraction only.
#                            Uses full GT_LAYOUT encoding (dom+perm[2:0] at [30:27], gt_type[26:25]);
#                            slot_id=0, gt_seq=0, gt_type=0b00 (NULL), b_flag=0 in this advisory word.
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
