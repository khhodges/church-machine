from amaranth import *
from amaranth.lib.data import StructLayout
from shared.architecture_contracts import GT_WORD0, NS_ENTRY


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
