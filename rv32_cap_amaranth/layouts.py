from amaranth import *
from amaranth.lib.data import StructLayout

GT_LAYOUT = StructLayout({
    "gt_type": unsigned(2),
    "perms":   unsigned(6),
    "index":   unsigned(17),
    "version": unsigned(7),
})

CAP_REG_LAYOUT = StructLayout({
    "word0_gt":       GT_LAYOUT,
    "word1_location": unsigned(32),
    "word2_limit":    unsigned(32),
    "word3_seals":    unsigned(32),
})

NS_ENTRY_LAYOUT = StructLayout({
    "word0_location": unsigned(32),
    "word1_limit":    unsigned(32),
    "word2_seals":    unsigned(32),
})

NS_LIMIT_LAYOUT = StructLayout({
    "limit":    unsigned(17),
    "reserved": unsigned(13),
    "f_flag":   unsigned(1),
    "b_flag":   unsigned(1),
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
