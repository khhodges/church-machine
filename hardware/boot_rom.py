from amaranth import *

from .hw_types import *
from .integrity32 import integrity32


def encode_church(opcode, cond=CondCode.AL, cr_dst=0, cr_src=0, imm=0):
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23) | \
           ((cr_dst & 0xF) << 19) | ((cr_src & 0xF) << 15) | (imm & 0x7FFF)


def encode_turing(opcode, cond=CondCode.AL, dr_dst=0, dr_src=0, imm=0):
    """Encode a Turing-domain instruction (IADD, ISUB, BRANCH, DREAD, DWRITE, …).

    For IADD/ISUB: dr_dst = destination DR, dr_src = source DR, imm = 15-bit signed immediate.
    For BRANCH:    dr_dst/dr_src unused (0), imm = 15-bit signed word offset from current PC.
    For DWRITE:    dr_dst = DR index to read (value), dr_src = CR index (capability), imm = word offset.
    For DREAD:     dr_dst = DR index to write (destination), dr_src = CR index (capability), imm = word offset.
    """
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23) | \
           ((dr_dst & 0xF) << 19) | ((dr_src & 0xF) << 15) | (imm & 0x7FFF)


def make_gt(gt_type=GT_TYPE_NULL, perms=0, slot_id=0, gt_seq=0, b_flag=0):
    """Encode a 32-bit Golden Token word using the v2.0 dom+perm[2:0] format.

    GT Word 0 field layout (v2.0 ★):
      [15:0]  slot_id   — 16-bit namespace slot index
      [24:16] gt_seq    — 9-bit revocation counter (★v2.0 was 7b at [22:16])
      [26:25] gt_type   — 00=NULL  01=Inform  10=Outform  11=Abstract (★v2.0 was [24:23])
      [27]    dom       — 0=Turing {X,W,R}, 1=Church {E,S,L}
      [30:28] perm      — 3-bit payload (dom=0: X/W/R; dom=1: E/S/L)
      [31]    b_flag    — bindable override (IO devices; excluded from CRC seal input)

    Note: f_flag has moved from GT[25] to NS SLOT W1[31] (WORD2_LAYOUT) in v2.0.

    perms: 6-bit logical mask using PERM_MASK_* constants (caller-facing, unchanged API).
    The encoding converts automatically via gt_encode_perm().

    b_flag=1 for IO device GTs (LED, UART, BTN, TIMER): marks the GT as bound to a physical
    resource by the system configurator. Excluded from GT[24:0] CRC input so runtime/debugger
    can set/clear it without recomputing the NS entry seal.

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Secure Boot — Overview"
    """
    dom, perm3 = gt_encode_perm(perms)
    return (b_flag << 31) | (perm3 << 28) | (dom << 27) | \
           (gt_type << 25) | (gt_seq << 16) | slot_id


# ---------------------------------------------------------------------------
# BOOT_PROGRAM — the instruction ROM executed from reset
#
# Three-instruction sequence — hardware boot ROM, fixed in silicon.
# The IDE defines what runs by writing an E-GT into Thread.caps[0] (thread[+244]).
#
#   [0] LOAD   AL, CR15, CR15[0]
#         Load the full namespace capability from NS slot 0 into CR15.
#         Hardware provides a bootstrap CR15 at reset; this refreshes it
#         from the uploaded boot image so the full namespace is live.
#   [1] CHANGE AL, CR12, CR12, #1
#         Switch to Boot.Thread (NS slot 1). Hardware RESTORE_CALL FSM reads
#         CR0–CR11 from thread caps zone (thread[+244..+255]).
#         CR0 ← thread[+244] = IDE-configured Entry E-GT (set by setBootEntrySlot()).
#   [2] CALL   AL, CR0,  CR0
#         Enter the IDE-chosen first abstraction (lightning bolt).
#         Faults NULL_CAP if Thread.caps[0] has not been configured.
#
# To configure: IDE calls setBootEntrySlot(ns_slot) which writes an E-GT for
# the chosen abstraction into thread lump word (thread_base + THREAD_CAPS_OFFSET).
# ---------------------------------------------------------------------------
BOOT_PROGRAM = [
    encode_church(ChurchOpcode.LOAD,   CondCode.AL, cr_dst=15, cr_src=15, imm=0),
    encode_church(ChurchOpcode.CHANGE, CondCode.AL, cr_dst=12, cr_src=15, imm=1),
    encode_church(ChurchOpcode.CALL,   CondCode.AL, cr_dst=0,  cr_src=0),
]

while len(BOOT_PROGRAM) < 256:
    BOOT_PROGRAM.append(0x00000000)



# ---------------------------------------------------------------------------
# NUC_PROGRAM — first abstraction: LED0 blink demo via DWRITE/IADD/ISUB/BRANCH
#
# Placed at boot_rom indices 256–511 (byte address 0x400–0x7FC).
# The debug FSM transitions here automatically after boot completes.
# This program blinks LED0 at ~1 Hz — visibly distinct from the hardware
# walking-LED boot demo (which drives all four LEDs in sequence).
#
# Register use:
#   DR0 = hardwired 0 (zero register)
#   DR1 = 1  ("on" value for DWRITE, set once at startup via IADD)
#   DR2 = inner delay counter (0..16383)
#   DR3 = outer delay counter (0..380)
#   CR3 = LED_DEV capability (loaded from DEMO_CLIST slot 8 via LOAD CR3, CR6[8])
#
# Timing (50 MHz):  each ISUB+BRANCH pair = 4 cycles.
#   inner = 16383 iterations × 4 cycles = 65532 cycles
#   outer = 380   iterations → 380 × 65532 = 24,902,160 cycles ≈ 0.498 s per phase
#   LED0 on ~0.498 s, off ~0.498 s → ~1 Hz blink (vs 4-LED hardware demo rotation)
#
# NUC word-offset table (base = NUC index 0 = rom index 256 = byte 0x400):
#   0  LOAD  CR3, CR6[8]      — load LED_DEV capability into CR3
#   1  IADD  DR1, DR0, #1     — DR1 = 1 (on value)
#   ── LED0 ON phase ──────────────────────────────────────────────────────────
#   2  DWRITE CR3[0], DR1     — LED0 = 1
#   3  IADD  DR3, DR0, #380   — outer count
#   4  IADD  DR2, DR0, #16383 — inner count  ← outer-loop-top
#   5  ISUB  DR2, DR2, #1     ← inner-loop-top
#   6  BRANCH NE, #-1         — → index 5
#   7  ISUB  DR3, DR3, #1
#   8  BRANCH NE, #-4         — → index 4
#   ── LED0 OFF phase ─────────────────────────────────────────────────────────
#   9  DWRITE CR3[0], DR0     — LED0 = 0
#  10  IADD  DR3, DR0, #380   — outer count
#  11  IADD  DR2, DR0, #16383 — inner count  ← outer-loop-top
#  12  ISUB  DR2, DR2, #1     ← inner-loop-top
#  13  BRANCH NE, #-1         — → index 12
#  14  ISUB  DR3, DR3, #1
#  15  BRANCH NE, #-4         — → index 11
#  16  BRANCH AL, #-14        — → index 2 (loop: LED0 on again)
# ---------------------------------------------------------------------------

# BRANCH imm = signed word offset from current instruction's address.
# branch_target = nia_reg + sign_extend(imm) * 4
# Inner back-edge (on phase):  target=5,  branch at 6  → -1  → 0x7FFF
# Outer back-edge (on phase):  target=4,  branch at 8  → -4  → 0x7FFC
# Inner back-edge (off phase): target=12, branch at 13 → -1  → 0x7FFF
# Outer back-edge (off phase): target=11, branch at 15 → -4  → 0x7FFC
# Top-of-loop:                 target=2,  branch at 16 → -14 → 0x7FF2

NUC_PROGRAM = [
    # 0: load LED_DEV capability into CR3 from c-list slot 8 (via CR6)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=3, cr_src=6, imm=8),
    # 1: DR1 = 1 (DWRITE "on" value)
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1),
    # ── LED0 ON phase ──────────────────────────────────────────────────────────
    # 2: LED0 = 1
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=0),
    # 3: DR3 = 380 (outer delay count)
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 4: DR2 = 16383 (inner delay count)  ← outer-loop-top
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 5: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 6: branch to index 5 if DR2 != 0
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 7: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 8: branch to index 4 if DR3 != 0
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # ── LED0 OFF phase ─────────────────────────────────────────────────────────
    # 9: LED0 = 0
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=0),
    # 10: DR3 = 380
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 11: DR2 = 16383  ← outer-loop-top
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 12: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 13: branch to index 12 if DR2 != 0
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 14: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 15: branch to index 11 if DR3 != 0
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 16: unconditional branch back to index 2 (LED0 on); offset = 2-16 = -14 words
    encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=(-14) & 0x7FFF),
]

# Assemble full ROM: BOOT_PROGRAM (256 words) + NUC_PROGRAM (padded to 256 words)
_NUC_PADDED = list(NUC_PROGRAM)
while len(_NUC_PADDED) < 256:
    _NUC_PADDED.append(0x00000000)


# ---------------------------------------------------------------------------
# SLIDERULE ABSTRACTION — Layer 3 Mathematics (NS Slot 16)
#
# Compiled CLOOMC machine code from simulator/cloomc/SlideRule.json.
# 8 methods: Add(0), Sub(1), Mul(2), Div(3), Sqrt(4), Pow(5),
#            ToDegrees(6), ToRadians(7).
#
# Method dispatch convention: caller sets DR3 = method index before CALL.
# The code block begins with a 16-word dispatch table (8 × ISUB+BRANCH pairs)
# that compares DR3 against each method index and branches to the method body.
# DR2 is used as scratch for the comparison; DR0/DR1 carry method arguments.
#
# Boot ROM layout:
#   [0:255]   BOOT_PROGRAM
#   [256:511] NUC_PROGRAM (padded)
#   [512:680] SlideRule dispatch table (16) + method code (153) = 169 words
# ---------------------------------------------------------------------------

_SR_ADD  = [0x7f600000, 0x7f660000, 0x7f260000, 0x7f020000, 0x1f000000]
_SR_SUB  = [0x87600000, 0x7f260000, 0x7f020000, 0x1f000000]
_SR_MUL  = [
    0x7f600000, 0x7f260000, 0x7f600000, 0x7f2e0000, 0x7f600000,
    0x770e0000, 0x8d00000c, 0x7f600000, 0x87660000, 0x7f0e0000,
    0x7f600001, 0x7f2e0000, 0x7f600000, 0x770e0000, 0x8e807fff,
    0x67608001, 0x7f360000, 0x7f600001, 0x77360000, 0x88800017,
    0x7f620000, 0x7f660000, 0x7f260000, 0x97600001, 0x7f060000,
    0x9f608001, 0x7f0e0000, 0x7f600001, 0x772e0000, 0x88800021,
    0x7f600000, 0x87660000, 0x7f260000, 0x7f020000, 0x1f000000,
]
_SR_DIV  = [
    0x7f600000, 0x770e0000, 0x88800006, 0x7f600000, 0x7f060000,
    0x1f000000, 0x7f600000, 0x7f260000, 0x7f600000, 0x77060000,
    0x8d000010, 0x7f600000, 0x87660000, 0x7f060000, 0x7f620001,
    0x7f260000, 0x7f600000, 0x770e0000, 0x8d000018, 0x7f600000,
    0x87660000, 0x7f0e0000, 0x7f620001, 0x7f260000, 0x7f600000,
    0x7f2e0000, 0x77008000, 0x8d807fff, 0x87600000, 0x7f060000,
    0x7f628001, 0x7f2e0000, 0x7f600001, 0x77260000, 0x88800026,
    0x7f600000, 0x87660000, 0x7f2e0000, 0x7f028000, 0x1f000000,
]
_SR_SQRT = [
    0x7f600000, 0x77060000, 0x88800006, 0x7f600000, 0x7f060000,
    0x1f000000, 0x7f600001, 0x77060000, 0x8880000c, 0x7f600001,
    0x7f060000, 0x1f000000, 0x9f600001, 0x7f260000, 0x7f600000,
    0x7f2e0000, 0x7f600014, 0x772e0000, 0x8d007fff, 0x7f600000,
    0x7f360000, 0x7f380000, 0x773a0000, 0x8d807fff, 0x87638000,
    0x7f3e0000, 0x7f630001, 0x7f360000, 0x7f620000, 0x7f660000,
    0x7f460000, 0x9f640001, 0x7f460000, 0x7f240000, 0x7f628001,
    0x7f2e0000, 0x7f020000, 0x1f000000,
]
_SR_POW  = [
    0x7f600001, 0x7f260000, 0x7f600000, 0x770e0000, 0x8e807fff,
    0x7f600000, 0x7f2e0000, 0x7f300000, 0x7f3a0000, 0x7f600000,
    0x773e0000, 0x8e807fff, 0x67638001, 0x7f460000, 0x7f600001,
    0x77460000, 0x88800014, 0x7f628000, 0x7f660000, 0x7f2e0000,
    0x97630001, 0x7f360000, 0x9f638001, 0x7f3e0000, 0x7f228000,
    0x87608001, 0x7f0e0000, 0x7f020000, 0x1f000000,
]
_SR_TODEG = [0x1f000000]
_SR_TORAD = [0x1f000000]

_SR_METHODS = [_SR_ADD, _SR_SUB, _SR_MUL, _SR_DIV, _SR_SQRT, _SR_POW, _SR_TODEG, _SR_TORAD]
_SR_METHOD_NAMES = ['Add', 'Sub', 'Mul', 'Div', 'Sqrt', 'Pow', 'ToDegrees', 'ToRadians']
_SR_DISPATCH_SIZE = len(_SR_METHODS) * 2

_sr_offsets = []
_sr_pos = _SR_DISPATCH_SIZE
for _m in _SR_METHODS:
    _sr_offsets.append(_sr_pos)
    _sr_pos += len(_m)

_SR_DISPATCH = []
for _idx, _off in enumerate(_sr_offsets):
    _SR_DISPATCH.append(encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=3, imm=_idx))
    _branch_pos = _idx * 2 + 1
    _branch_offset = _off - _branch_pos
    _SR_DISPATCH.append(encode_turing(TuringOpcode.BRANCH, CondCode.EQ, imm=_branch_offset & 0x7FFF))

SLIDERULE_CODE = list(_SR_DISPATCH)
for _m in _SR_METHODS:
    SLIDERULE_CODE.extend(_m)

SLIDERULE_CW = len(SLIDERULE_CODE)
SLIDERULE_N_MINUS_6 = 2
SLIDERULE_LUMP_BASE = 511 * 4
SLIDERULE_LUMP_HEADER = (0x1F << 27) | (SLIDERULE_N_MINUS_6 << 23) | (SLIDERULE_CW << 10)

SLIDERULE_METHOD_OFFSETS = {name: off for name, off in zip(_SR_METHOD_NAMES, _sr_offsets)}

FULL_ROM = BOOT_PROGRAM + _NUC_PADDED + list(SLIDERULE_CODE)
while len(FULL_ROM) < 1024:
    FULL_ROM.append(0x00000000)

# ---------------------------------------------------------------------------
# Navana lump header + method table (Task #17 / D-5 close)
#
# NS slot 5, lump base byte address 0x0500, ROM word index 320.
# Placed in the zero-padded tail of _NUC_PADDED (NUC_PROGRAM ends at word 272).
#
# Minimal lump layout (cw=2, cc=0, n_minus_6=0, typ=0):
#   word 0 (+0): lump header  — magic=0x1F, n_minus_6=0, cw=2, typ=00, cc=0
#   word 1 (+1): method_table[1] = 2  (Init at method index 1; body at lump word 2)
#   word 2 (+2): Init body — RETURN AL (simulator logic runs via abstraction registry)
#
# Hardware CALL dispatch (simulator.js lines 3233-3243):
#   method index 0 → PC = 1 (single-entry shorthand, hardcoded by CALL hardware).
#   method index 1 → tableEntry = memory[lump_base_word + 1] = 2;
#                    PC = 2 → executes RETURN AL.
#   method index 1 with tableEntry = 0 → PRIVATE_METHOD fault (now fixed).
# ---------------------------------------------------------------------------
_NAVANA_LUMP_WORD        = 5 * 0x100 // 4   # = 320 (ROM word index of Navana lump base)
_NAVANA_INIT_BODY_OFFSET = 2                 # lump-base-relative word offset to Init body
_NAVANA_CW               = 2                 # code words: [1]=method table entry, [2]=Init body
_NAVANA_LUMP_HEADER = (0x1F << 27) | (_NAVANA_CW << 10)  # magic=0x1F, n_minus_6=0, cw=2, typ=0, cc=0

FULL_ROM[_NAVANA_LUMP_WORD + 0] = _NAVANA_LUMP_HEADER            # lump header
FULL_ROM[_NAVANA_LUMP_WORD + 1] = _NAVANA_INIT_BODY_OFFSET       # method_table[1] → Init body at lump word 2
FULL_ROM[_NAVANA_LUMP_WORD + 2] = encode_church(ChurchOpcode.RETURN, CondCode.AL)  # Init body: RETURN AL

# ---------------------------------------------------------------------------
# NUC_PROGRAM lump header constants — derived entirely from NUC_PROGRAM contents.
#
# NUC_LUMP_BASE: DMEM byte address of the NUC_PROGRAM lump header.
#   Placed at the last word of the NS table region (DMEM word 255 = byte 0x3FC),
#   immediately before the NUC_PROGRAM instructions in IMEM (byte 0x400).
#
# NUC_LUMP_HEADER: 32-bit lump header word (LUMP_HEADER_LAYOUT).
#   magic=0x1F, n_minus_6=0 (alloc=64 words), cw=len(NUC_PROGRAM), typ=0, cc=0
#
# NS slot 4 uses NUC_LUMP_BASE as word0_location so cload reads the header from
# DMEM byte 0x3FC and derives CR14.word1_location = 0x3FC + 4 = 0x400 (first
# NUC_PROGRAM instruction in IMEM).
# ---------------------------------------------------------------------------
NUC_PROGRAM_CW = len(NUC_PROGRAM)
NUC_LUMP_BASE  = (len(BOOT_PROGRAM) - 1) * 4          # = 0x3FC (DMEM byte address of lump header)
NUC_LUMP_HEADER = (0x1F << 27) | (NUC_PROGRAM_CW << 10)  # magic=0x1F, cw=17, n_minus_6=0, typ=0, cc=0


def _abstract_gt_word(perms):
    """Encode a permission mask as an Abstract GT word using the v1.1 dom+perm encoding.

    Abstract GTs are advisory annotations stored in NS entry word3.  They encode
    only the permission intent for the slot; slot_id, gt_seq, gt_type, and
    b_flag are all zero.  Hardware never checks this field; ChurchMLoad gates its
    output on M-bit so user-mode LOAD cannot observe it.

    Layout: [30:28]=perm[2:0], [27]=dom, all other bits zero.
    """
    dom, perm3 = gt_encode_perm(perms)
    return (perm3 << 28) | (dom << 27)


def _make_ns_entry(gt_type, perms, slot_id, gt_seq, location, alloc_size, cw=0, cc=0,
                   n_minus_6=0, abstract_gt=0):
    """Build a 4-word NS entry (stride = slot_id << 4, i.e. 16 bytes per entry).

    Layout:
      word0_location    (+0):  lump base byte address (location)
      word1_authority   (+4):  WORD2_LAYOUT — limit_offset[20:0] | gt_seq[29:21] (9b) | g_bit[30] | f_flag[31] ★v2.0
                               limit_offset = alloc_size - 1  (last valid word index)
                               Identical bit layout to CR W2 (WORD2_LAYOUT).
      word2_integrity   (+8):  integrity32(W0, W1 with g_bit[30] and f_flag[31] masked) ★v2.0
                               Parallel 32-bit check; g_bit excluded so GC can set it freely.
      word3_abstract_gt (+12): Abstract GT annotation — permission-profile word for the NS
                               abstraction (M-bit gated; invisible to user-mode LOAD).
                               Use _abstract_gt_word(perms) to encode; 0 for null/empty slots.

    The lump header (LUMP_HEADER_LAYOUT) is at word 0 of the lump itself (at location),
    not cached in the NS table entry.

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
    GT Word 0 fields: slot_id[15:0], gt_seq[24:16] (9b), gt_type[26:25], dom[27], perm[30:28] ★v2.0
    """
    limit_offset = max(0, alloc_size - 1) & 0x1FFFFF
    word1_authority = ((gt_seq & 0x1FF) << 21) | limit_offset  # gt_seq 9b at [29:21] ★v2.0

    word2_integrity = integrity32(location, word1_authority)

    return [location, word1_authority, word2_integrity, abstract_gt]


# ---------------------------------------------------------------------------
# MMIO device GT slot assignments — aligned with simulator DEVICE_NS_SLOTS
#
#   Slot 0:  Boot.NS (NS root)
#   Slot 1:  Boot.Thread
#   Slot 2:  (first available catalog slot — null NS entry; no physical lump)
#   Slot 3:  Boot code domain — hardware-privileged; CR14 points here during
#             BOOT_PROGRAM execution; no user-visible NS table entry.
#   Slot 4:  Salvation (E)     — Application LUMP; NUC_PROGRAM on hardware demo
#   Slot 5:  Navana (E)        — namespace controller
#   Slot 6:  Mint (E)          — capability minting
#   Slot 7:  Memory (E)        — memory management
#   Slot 8:  Scheduler (E)     — thread scheduling
#   Slot 9:  Stack (E)         — LIFO stack abstraction
#   Slot 10: DijkstraFlag (E)  — synchronisation primitive
#   Slot 11: UART_DEV  — 0x40000014, RW, limit=2 (3 words: TX, STATUS, RX)
#   Slot 12: LED_DEV   — 0x40000000, RW, limit=4 (5 words, one per RGB LED)
#             offset 0 = LED 0  bits[2:0]={B,G,R}  (only R drives physical pin)
#             offset 1 = LED 1  bits[2:0]={B,G,R}
#             offset 2 = LED 2  bits[2:0]={B,G,R}
#             offset 3 = LED 3  bits[2:0]={B,G,R}
#             offset 4 = LED 4  bits[2:0]={B,G,R}
#   Slot 13: BTN_DEV   — 0x40000028, R,  limit=0 (1 word)
#   Slot 14: TIMER_DEV — 0x4000002C, RW, limit=4 (5 words):
#             offset 0 = TICKS_LO (R), offset 1 = TICKS_HI (R),
#             offset 2 = TOD_EPOCH (R/W), offset 3 = ALARM_CMP (R/W),
#             offset 4 = ALARM_CTL (R/W: [0]=armed, [1]=fired)
#   Slot 15: Display   — reserved for future display device
#   Slot 16: SlideRule (E)  — Layer 3 Mathematics (8 methods)
#   Slot 17: (empty)
#   Slot 18: Constants (R)  — Layer 3 read-only constants
#
# Church Hardware Address Range capability slots (slots 19–22).
#
# These S-perm authority caps govern privileged CR12/CR13 writes.
# They are NOT included in DEMO_CLIST (user-space boot c-list).
# Scheduler.IRQ (NS slot 8) receives E-perm GTs for all four authority
# objects (slots 19–22) so it can invoke CHANGE CR12/CR13 and M-bit-set.
# Thread Manager (NS slot 45) receives E-perm GTs for the CR12 caps only
# (slots 19 and 21); CR13 caps remain IRQ-manager territory.
# See SCHEDULER_IRQ_CLIST and THREAD_MANAGER_CLIST below.
#
#   Slot 19: CR12_PORT_CAP  — 0xFFFFFF0C, S-perm, limit=0
#             Authority to CHANGE CR12 (thread stack).
#             Distributed to: Scheduler.IRQ c-list AND Thread Manager c-list (E-perm GTs).
#   Slot 20: CR13_PORT_CAP  — 0xFFFFFF0D, S-perm, limit=0
#             Authority to CHANGE CR13 (interrupt handler).
#             Distributed to: Scheduler.IRQ c-list only (E-perm GT; IRQ-manager territory).
#   Slot 21: CR12_MBIT_CAP  — 0xFFFFFF1C, S-perm, limit=0
#             Authority to set the M bit on a GT installed into CR12.
#             Distributed to: Scheduler.IRQ c-list AND Thread Manager c-list (E-perm GTs).
#   Slot 22: CR13_MBIT_CAP  — 0xFFFFFF1D, S-perm, limit=0
#             Authority to set the M bit on a GT installed into CR13.
#             Distributed to: Scheduler.IRQ c-list only (E-perm GT; IRQ-manager territory).
#
# Physical LED mapping (R bit = bit 0 of each word):
#   Ti60 F225 (4 LEDs active-HIGH):
#     offset 0→led0, 1→led1, 2→led2, 3→led3; offset 4 = register-only (no pin)
#   Tang Nano 20K (6 LEDs active-LOW, led3 pin absent):
#     offset 0→led0, 1→led1, 2→led2, 3→led4, 4→led5; led3 pin not connected
# ---------------------------------------------------------------------------

# Church Hardware Address Range NS slot assignments
# CR12 caps (slots 19, 21) distributed to Scheduler.IRQ AND Thread Manager c-lists.
# CR13 caps (slots 20, 22) distributed to Scheduler.IRQ c-list only (IRQ-manager territory).

# ---------------------------------------------------------------------------
# SCHEDULER_IRQ_CLIST — capability list for the Scheduler.IRQ lump (NS slot 8)
#
# Scheduler.IRQ is the sole hardware IRQ dispatcher.
# Its c-list carries a single Abstract S-perm GT that encodes CHANGE CR12/CR13
# authority directly in the token — no NS entries required.
#
# Abstract S-perm GT: type=0b11 (Abstract), dom=1 (Church), perm3=0b010 (S)
# Word value: (0b010<<28)|(1<<27)|(0b11<<25) = 0x2E000000
#
# Layout (cc = 1; lump tail word [lump_size-1]):
#   idx 0: Abstract S-perm GT — authority to CHANGE CR12/CR13
# ---------------------------------------------------------------------------
SCHEDULER_IRQ_CLIST = [
    make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S, 0, 0),  # idx 0: Abstract S-perm GT (0x2E000000)
]

# ---------------------------------------------------------------------------
# THREAD_MANAGER_CLIST — capability list entries for Thread Manager (NS slot 36)
#
# Thread Manager needs cooperative-scheduling authority over CR12 (thread
# stacks).  A single Abstract S-perm GT encodes this authority without
# requiring any NS entry.
#
# Layout (cc = 1; lump tail word [lump_size-1]):
#   idx 0: Abstract S-perm GT — authority to CHANGE CR12
# ---------------------------------------------------------------------------
THREAD_MANAGER_CLIST = [
    make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S, 0, 0),  # idx 0: Abstract S-perm GT (0x2E000000)
]

MMIO_LED_ADDR   = 0x40000000   # offsets 0–4: LED0–LED4, bits[2:0]={B,G,R}
MMIO_UART_ADDR  = 0x40000014   # TX=+0, STATUS=+4, RX=+8 bytes → offsets 0,1,2 words
MMIO_BTN_ADDR   = 0x40000028
MMIO_TIMER_ADDR = 0x4000002C

_MMIO_ENTRIES = {
    MMIO_LED_SLOT:   (MMIO_LED_ADDR,   5,  GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W),
    MMIO_UART_SLOT:  (MMIO_UART_ADDR,  3,  GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W),
    MMIO_BTN_SLOT:   (MMIO_BTN_ADDR,   1,  GT_TYPE_INFORM, PERM_MASK_R),
    MMIO_TIMER_SLOT: (MMIO_TIMER_ADDR, 5,  GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W),
}

# ---------------------------------------------------------------------------
# DEMO_NAMESPACE — stub NS table entries (16 slots) aligned with simulator
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
#   Slot  0: Boot.NS      — NS root (location=NS_TABLE_BASE, limit = full phys space)
#   Slot  1: Boot.Thread  — Thread Abstraction lump (base = 0x0100)
#   Slot  2: (freed — Startup.Config removed, Task #989; boot via Thread.CR[0] directly)
#   Slot  3: (empty)      — placeholder
#   Slot  4: Salvation     — first user abstraction (NUC_PROGRAM on hardware), E-perm
#   Slot  5: Navana        — namespace controller, E-perm
#   Slot  6: Mint          — capability minting, E-perm
#   Slot  7: Memory        — memory management, E-perm
#   Slot  8: Scheduler     — thread scheduling, E-perm
#   Slot  9: Stack         — LIFO stack abstraction, E-perm
#   Slot 10: DijkstraFlag  — synchronisation primitive, E-perm
#   Slot 11: UART_DEV      — MMIO 0x40000014, RW, 3 words
#   Slot 12: LED_DEV       — MMIO 0x40000000, RW, 5 words
#   Slot 13: BTN_DEV       — MMIO 0x40000028, R,  1 word
#   Slot 14: TIMER_DEV     — MMIO 0x4000002C, RW, 5 words
#   Slot 15: Display       — reserved for future display device
#   Slot 16: SlideRule     — Layer 3 Mathematics (8 methods, E-perm)
#   Slot 17: (empty)       — reserved
#   Slot 18: Constants     — Layer 3 read-only constants (R-perm)
# ---------------------------------------------------------------------------
# Minimal 8-slot boot namespace.
# Church HW Range authority slots 19-22 removed — authority is now a
# pre-baked Abstract S-perm GT (0x2E000000) in SCHEDULER_IRQ_CLIST.
_SYSTEM_ABSTRACTION_SLOTS = {
    SELFTEST_NS_SLOT: ('SelfTest', PERM_MASK_E),  # boot entry point (slot 6)
}

NS_SLOT_COUNT = 8   # minimal boot namespace: slots 0-7

# ---------------------------------------------------------------------------
# DEMO_NAMESPACE — minimal 8-slot NS table for hardware boot
#
#   Slot 0: Boot.NS      — NS root (location=NS_TABLE_BASE, limit=64)
#   Slot 1: Boot.Thread  — Thread lump (base=0x0100, limit=63)
#   Slot 2: UART_DEV     — MMIO 0x40000014, RW, limit=2 (3 words: TX/STATUS/RX)
#   Slot 3: LED_DEV      — MMIO 0x40000000, RW, limit=4 (5 words)
#   Slot 4: BTN_DEV      — MMIO 0x40000028, R,  limit=0 (1 word)
#   Slot 5: TIMER_DEV    — MMIO 0x4000002C, RW, limit=4 (5 words)
#   Slot 6: SelfTest     — lazy lump (base=0x0600, limit=63), E-perm
#   Slot 7: [programmable] — null NS entry
# ---------------------------------------------------------------------------
DEMO_NAMESPACE = []
for _i in range(NS_SLOT_COUNT):
    if _i == 0:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                NS_TABLE_BASE, 64,
                                abstract_gt=_abstract_gt_word(PERM_MASK_R | PERM_MASK_W))
    elif _i in _MMIO_ENTRIES:
        _loc, _sz, _gtype, _perms = _MMIO_ENTRIES[_i]
        _entry = _make_ns_entry(_gtype, _perms, _i, 0, _loc, _sz,
                                abstract_gt=_abstract_gt_word(_perms))
    elif _i in _SYSTEM_ABSTRACTION_SLOTS:
        _name, _perms = _SYSTEM_ABSTRACTION_SLOTS[_i]
        _entry = _make_ns_entry(GT_TYPE_INFORM, _perms, _i, 0,
                                _i * 0x100, 64,
                                abstract_gt=_abstract_gt_word(_perms))
    elif _i == 7:
        _entry = _make_ns_entry(GT_TYPE_NULL, 0, _i, 0, 0, 0)  # [programmable]
    else:
        # Slot 1: Boot.Thread (default: location=0x100, alloc=64 words, RW)
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                _i * 0x100, 64,
                                abstract_gt=_abstract_gt_word(PERM_MASK_R | PERM_MASK_W))
    DEMO_NAMESPACE.extend(_entry)


# ---------------------------------------------------------------------------
# DEMO_CLIST — initial C-List for the boot abstraction (SelfTest, Slot 6)
#
# Aligned with simulator boot c-list (simulator.js _initBootState).
# Minimal 11-entry layout matching the 8-slot namespace.
#
#   idx  0: make_gt(Inform, R|X, slot_id=6, gt_seq=0)         — boot-internal: SelfTest code/constants R|X
#   idx  1: make_gt(NULL,   0,   0,         0)                 — freed (Salvation/NUC_PROGRAM removed)
#   idx  2: make_gt(NULL,   0,   0,         0)                 — boot-internal: filled by SAVE epilogue (Thread GT)
#   idx  3: make_gt(Inform, E,   slot_id=6, gt_seq=0)         — boot-internal: SelfTest E-GT (return channel)
#   idx  4: make_gt(NULL,   0,   0,         0)                 — freed
#   idx  5: make_gt(Inform, R|W, slot_id=3, b_flag=1)         — LED_DEV  (MMIO NS slot 3, bindable)
#   idx  6: make_gt(Inform, R|W, slot_id=2, b_flag=1)         — UART_DEV (MMIO NS slot 2, bindable)
#   idx  7: make_gt(Inform, R,   slot_id=4, b_flag=1)         — BTN_DEV  (MMIO NS slot 4, bindable)
#   idx  8: make_gt(Inform, R|W, slot_id=5, b_flag=1)         — TIMER_DEV(MMIO NS slot 5, bindable)
#   idx  9: make_gt(Inform, E,   slot_id=8, gt_seq=0)         — SlideRule E-GT (NS slot 8)
#   idx 10: make_gt(Inform, R,   slot_id=9, gt_seq=0)         — Constants R-GT (NS slot 9)
#
# Indices 0–3 are boot-internal (used by BOOT_PROGRAM firmware only).
# Indices 5–10 are the user-visible c-list (idx 4 freed).
#
# b_flag=1 marks each IO device GT as IDE-bound to a physical peripheral.
# ---------------------------------------------------------------------------
DEMO_CLIST = [
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, SELFTEST_NS_SLOT, 0),   # idx 0: SelfTest R|X
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                              # idx 1: freed (Salvation removed)
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                              # idx 2: Thread GT (SAVE epilogue)
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, SELFTEST_NS_SLOT, 0),                  # idx 3: SelfTest E-GT return channel
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                              # idx 4: freed
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_LED_SLOT,   0, b_flag=1),  # idx 5:  LED_DEV  → NS 3
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_UART_SLOT,  0, b_flag=1),  # idx 6:  UART_DEV → NS 2
    make_gt(GT_TYPE_INFORM, PERM_MASK_R,                MMIO_BTN_SLOT,   0, b_flag=1),  # idx 7:  BTN_DEV  → NS 4
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_TIMER_SLOT, 0, b_flag=1),  # idx 8:  TIMER_DEV→ NS 5
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, SLIDERULE_SLOT, 0),                    # idx 9:  SlideRule E-GT → NS 8
    make_gt(GT_TYPE_INFORM, PERM_MASK_R, CONSTANTS_SLOT, 0),                    # idx 10: Constants R-GT → NS 9
]

while len(DEMO_CLIST) < 64:
    DEMO_CLIST.append(0)


# ---------------------------------------------------------------------------
# DEMO_CLIST_NAMED_SLOTS — the set of c-list slot indices that carry a
# well-known named capability in the boot c-list.
#
# A slot is named iff it has a defined identity at design time, even if its
# value is NULL at reset (e.g. idx 2 is the Thread GT slot, populated lazily
# by the SAVE epilogue — it IS named).  Freed or truly anonymous slots are
# excluded so that a NULL GT access there still produces a hard NULL_CAP fault
# instead of triggering LAZY_RESOLVE.
#
# Excluded from DEMO_CLIST_NAMED_SLOTS:
#   idx 1 — freed (Salvation/NUC_PROGRAM removed)
#   idx 4 — freed
# ---------------------------------------------------------------------------
DEMO_CLIST_NAMED_SLOTS = frozenset({0, 1, 2, 3, 5, 6, 7, 8, 9, 10})


class BootRom(Elaboratable):
    """Instruction ROM for Church Machine boot, demo, and abstraction code.

    Uses Array constants for reliable iCE40/EBR initialization.
    Only non-zero entries are stored; default is 0.
    Registered output maintains 1-cycle read latency matching original BRAM behavior.

    Layout (1024 words):
      [0:255]   BOOT_PROGRAM  — secure boot firmware
      [256:511] NUC_PROGRAM   — LED blink demo (Salvation, Slot 4)
      [512:680] SlideRule     — dispatch table (16) + 8 method bodies (153)
      [681:1023] (reserved)   — future abstractions

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js
    The BOOT_PROGRAM words above correspond 1-to-1 with the annotated CLOOMC
    listing in the "Full Secure Boot CLOOMC Listing" and "Boot ROM Cross-Reference"
    slides of the Secure Boot tutorial in the IDE (Tutorial → Secure Boot).
    """

    def __init__(self, program=None):
        if program is None:
            program = BOOT_PROGRAM
        self.program = program[:1024]
        while len(self.program) < 1024:
            self.program.append(0)

        self.addr = Signal(10)
        self.data = Signal(32)

    def elaborate(self, platform):
        m = Module()

        rom_comb = Signal(32)
        with m.Switch(self.addr):
            for i, word in enumerate(self.program):
                if word != 0:
                    with m.Case(i):
                        m.d.comb += rom_comb.eq(word)
            with m.Default():
                m.d.comb += rom_comb.eq(0)

        m.d.sync += self.data.eq(rom_comb)

        return m
