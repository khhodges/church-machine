from amaranth import *
import hashlib
import json
import struct
from pathlib import Path

from .hw_types import *
from .integrity32 import integrity32
from shared.architecture_contracts import (
    BOOT as ARCH_BOOT,
    NS_ENTRY as ARCH_NS_ENTRY,
    field_lsb,
    field_width,
    logical_permission_mask,
)


def encode_church(opcode, cond=CondCode.AL, cr_dst=0, cr_src=0, imm=0):
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23) | \
           ((cr_dst & 0xF) << 19) | ((cr_src & 0xF) << 15) | (imm & 0x7FFF)


def encode_turing(opcode, cond=CondCode.AL, dr_dst=0, dr_src=0, imm=0,
                  register_operand=False):
    """Encode a Turing-domain instruction (IADD, ISUB, BRANCH, DREAD, DWRITE, …).

    For IADD/ISUB: dr_dst = destination DR, dr_src = first source DR.
      By default ``imm`` is a 14-bit unsigned immediate and this helper sets
      the imm[14] immediate marker. With ``register_operand=True``, ``imm`` is
      the second source DR index encoded in imm[3:0].
    For BRANCH:    dr_dst/dr_src unused (0), imm = 15-bit signed word offset from current PC.
    For DWRITE:    dr_dst = DR index to read (value), dr_src = CR index (capability), imm = word offset.
    For DREAD:     dr_dst = DR index to write (destination), dr_src = CR index (capability), imm = word offset.
    """
    if opcode in (TuringOpcode.IADD, TuringOpcode.ISUB):
        imm = (imm & 0xF) if register_operand else (0x4000 | (imm & 0x3FFF))
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
#   [1] CHANGE AL, CR12, CR15, #1
#         Switch to Boot.Thread (NS slot 1). CR12 is system-wide; thread save
#         is skipped (no SAVE_DR) to prevent error loops at boot and on fault.
#         Hardware RESTORE_CALL FSM reads CR0–CR11 from thread caps zone
#         (thread[+244..+255]).
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
#   CR3 = LED_DEV capability (loaded from DEMO_CLIST slot 5 via LOAD CR3, CR6[5])
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
    # 0: load LED_DEV capability into CR3 from c-list slot 5 (via CR6)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=3, cr_src=6, imm=5),
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


def _make_ns_entry(gt_type, perms, slot_id, gt_seq, location, alloc_size, cw=0, cc=0,
                   n_minus_6=0, cache_token32=0):
    """Build a 4-word NS entry (stride = slot_id << 4, i.e. 16 bytes per entry).

    Layout:
      word0_location    (+0):  lump base byte address (location)
      word1_authority   (+4):  WORD2_LAYOUT — limit_offset[20:0] | gt_seq[29:21] (9b) | g_bit[30] | f_flag[31] ★v2.0
                               limit_offset = alloc_size - 1  (last valid word index)
                               Identical bit layout to CR W2 (WORD2_LAYOUT).
      word2_integrity   (+8):  integrity32(W0, W1 with g_bit[30] and f_flag[31] masked) ★v2.0
                               Parallel 32-bit check; g_bit excluded so GC can set it freely.
      word3_cache_token (+12): 32-bit issue-blind content cache/index token T — NON-authoritative.
                               Diagnostic/advisory only: never authenticity, ownership,
                               revocation, or writeback authority (Task #2862).  M-bit gated;
                               invisible to user-mode LOAD.  Built-in ROM has no trusted
                               identity source, so cache_token32 defaults to 0 and every
                               resident DEMO_NAMESPACE Word 3 is 0.  Do NOT encode a permission
                               profile / Abstract GT here.

    The lump header (LUMP_HEADER_LAYOUT) is at word 0 of the lump itself (at location),
    not cached in the NS table entry.

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
    GT Word 0 fields: slot_id[15:0], gt_seq[24:16] (9b), gt_type[26:25], dom[27], perm[30:28] ★v2.0
    """
    fields = ARCH_NS_ENTRY["word1"]["fields"]
    mask = lambda name: (1 << field_width(fields[name])) - 1
    limit_offset = max(0, alloc_size - 1) & mask("limit_offset")
    word1_authority = (
        (gt_seq & mask("gt_seq")) << field_lsb(fields["gt_seq"])
    ) | limit_offset

    word2_integrity = integrity32(location, word1_authority)

    return [location, word1_authority, word2_integrity, cache_token32]


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
# Church Hardware Address Range capability slots (slots 19–20).
#
# These S-perm authority caps govern privileged CR12/CR13 writes.
# They are NOT included in DEMO_CLIST (user-space boot c-list).
#
#   Slot 19: CR12_PORT_CAP  — 0xFFFFFF0C, S-perm, limit=0
#             Authority to CHANGE CR12 (thread stack).
#             Distributed to: Scheduler.IRQ c-list AND Thread Manager c-list (E-perm GTs).
#   Slot 20: CR13_PORT_CAP  — 0xFFFFFF0D, S-perm, limit=0
#             Authority to CHANGE CR13 (interrupt handler).
#             Distributed to: Scheduler.IRQ c-list only (E-perm GT; IRQ-manager territory).
# Slot 13 is the single-word M-bit I/O object. Its low 16 bits map CR0..CR15.
# Its capability is held by Namespace and is not present in user c-lists.
#
# Physical LED mapping (R bit = bit 0 of each word):
#   Tang Nano 20K (6 LEDs active-LOW, led3 pin absent):
#     offset 0→led0, 1→led1, 2→led2, 3→led4, 4→led5; led3 pin not connected
# ---------------------------------------------------------------------------

# Complete descriptor for the Namespace-held M-bit I/O object.
NAMESPACE_MBIT_CAPABILITY = (
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W,
            M_BIT_DEVICE_NS_SLOT, 0, b_flag=0),
    M_BIT_PORT,
    0,
)

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

MMIO_LED_ADDR   = ARCH_BOOT["devices"]["LED_DEV"]["address"]
MMIO_UART_ADDR  = ARCH_BOOT["devices"]["UART_DEV"]["address"]
MMIO_BTN_ADDR   = ARCH_BOOT["devices"]["BTN_DEV"]["address"]
MMIO_TIMER_ADDR = ARCH_BOOT["devices"]["TIMER_DEV"]["address"]

_MMIO_ENTRIES = {
    MMIO_LED_SLOT:   (MMIO_LED_ADDR,   ARCH_BOOT["devices"]["LED_DEV"]["words"], GT_TYPE_INFORM, logical_permission_mask(ARCH_BOOT["devices"]["LED_DEV"]["permissions"])),
    MMIO_UART_SLOT:  (MMIO_UART_ADDR,  ARCH_BOOT["devices"]["UART_DEV"]["words"], GT_TYPE_INFORM, logical_permission_mask(ARCH_BOOT["devices"]["UART_DEV"]["permissions"])),
    MMIO_BTN_SLOT:   (MMIO_BTN_ADDR,   ARCH_BOOT["devices"]["BTN_DEV"]["words"], GT_TYPE_INFORM, logical_permission_mask(ARCH_BOOT["devices"]["BTN_DEV"]["permissions"])),
    MMIO_TIMER_SLOT: (MMIO_TIMER_ADDR, ARCH_BOOT["devices"]["TIMER_DEV"]["words"], GT_TYPE_INFORM, logical_permission_mask(ARCH_BOOT["devices"]["TIMER_DEV"]["permissions"])),
    MMIO_M_BIT_SLOT: (M_BIT_PORT, 1, GT_TYPE_INFORM,
                      PERM_MASK_R | PERM_MASK_W),
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
WUKONG_CALLHOME_NS_SLOT = ARCH_BOOT["minimalSlots"]["WukongCallHome"]
_SYSTEM_ABSTRACTION_SLOTS = {
    SELFTEST_NS_SLOT:         ('SelfTest',       PERM_MASK_E),  # boot entry point (slot 6)
    WUKONG_CALLHOME_NS_SLOT:  ('WukongCallHome', PERM_MASK_E),  # Wukong coordinator (slot 7)
}

NS_SLOT_COUNT = max(ARCH_BOOT["minimalSlots"].values()) + 1

# ---------------------------------------------------------------------------
# DEMO_NAMESPACE — minimal 8-slot NS table for hardware boot
#
#   Slot 0: Boot.NS        — NS root (location=NS_TABLE_BASE, limit=64)
#   Slot 1: Boot.Thread    — Thread lump (base=0x0100, limit=63)
#   Slot 2: UART_DEV       — MMIO 0x40000014, RW, limit=2 (3 words: TX/STATUS/RX)
#   Slot 3: LED_DEV        — MMIO 0x40000000, RW, limit=4 (5 words)
#   Slot 4: BTN_DEV        — MMIO 0x40000028, R,  limit=0 (1 word)
#   Slot 5: TIMER_DEV      — MMIO 0x4000002C, RW, limit=4 (5 words)
#   Slot 6: SelfTest       — LUMP (base=0x0600, limit=511), E-perm; default ⚡ boot entry
#   Slot 7: WukongCallHome — LUMP (base=0x1200, limit=127), E-perm; selectable diagnostic entry
#   Slot 13: M_BIT_DEV     — 0xFFFFFF1C, RW, one 32-bit word; bits 0..15 map CR0.M..CR15.M
# ---------------------------------------------------------------------------
# Every resident W3 cache token is 0: built-in ROM has no trusted full identity
# source, so it never invents authenticity (Task #2862).  cache_token32 defaults
# to 0 in _make_ns_entry and is intentionally left unset for all boot slots.
DEMO_NAMESPACE = []
for _i in range(NS_SLOT_COUNT):
    if _i == 0:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                NS_TABLE_BASE, 64)
    elif _i in _MMIO_ENTRIES:
        _loc, _sz, _gtype, _perms = _MMIO_ENTRIES[_i]
        _entry = _make_ns_entry(_gtype, _perms, _i, 0, _loc, _sz)
    elif _i in _SYSTEM_ABSTRACTION_SLOTS:
        _name, _perms = _SYSTEM_ABSTRACTION_SLOTS[_i]
        _entry = _make_ns_entry(GT_TYPE_INFORM, _perms, _i, 0,
                                _i * 0x100, 64)
    else:
        # Slot 1: Boot.Thread — A7 v1.2 layout: Thread LUMP at word 0x0000.
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                0, 64)
    DEMO_NAMESPACE.extend(_entry)


# ---------------------------------------------------------------------------
# make_demo_clist — factory for the boot abstraction c-list (SelfTest, Slot 6)
#
# Aligned with simulator boot c-list (simulator.js _initNamespaceTable).
# Minimal boot c-list. M_BIT_DEV is intentionally absent: only Namespace owns it.
#
#   idx  0: make_gt(Inform, R|X, slot_id=6, gt_seq=0)         — boot-internal: SelfTest code/constants R|X
#   idx  1: make_gt(Inform, E,   next_slot, gt_seq=0)         — Next.GT: SelfTest calls here at done:
#            Default next_slot = SELFTEST_NS_SLOT: ELOADCALL self-loop; configured: chosen abstraction.
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
def make_demo_clist(next_slot=None):
    """Build the 11-entry boot c-list for the boot abstraction (SelfTest, Slot 6).

    idx 1 = Next.GT: SelfTest's ``done:`` label calls through c-list[1] with
    ``CALL AL, CR1, CR1`` when all tests pass.  Default (next_slot=None,
    i.e. SELFTEST_NS_SLOT): self-loop back into SelfTest via ELOADCALL.
    Configured: the abstraction chosen by the "→ Next" secondary ⚡ in the IDE.
    """
    if next_slot is None:
        next_slot = SELFTEST_NS_SLOT
    return [
        make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, SELFTEST_NS_SLOT, 0),   # idx 0: SelfTest R|X
        make_gt(GT_TYPE_INFORM, PERM_MASK_E, next_slot, 0),                          # idx 1: Next.GT — SelfTest chains here at done:
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

DEMO_CLIST = make_demo_clist()   # default: SelfTest self-loop at idx 1

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


# ---------------------------------------------------------------------------
# WUKONG_DEMO_NAMESPACE — 8-slot NS table for Wukong standalone boot
#
# Identical to DEMO_NAMESPACE except slot 0 (Boot.NS) has location = 0:
#   NS table placed at DMEM byte 0 (hw_init writes it there)
#
# The integrity seal on slot 0 word2 is recomputed from the new location.
# All other slots are byte-for-byte identical to DEMO_NAMESPACE.
# ---------------------------------------------------------------------------
WUKONG_DEMO_NAMESPACE = list(DEMO_NAMESPACE)
_wukong_ns0_loc  = 0                        # NS table at DMEM byte 0
# Word 1 is NS slot 0's word1 = the namespace LIMIT word (CR15.w2 after the
# boot LOAD).  It must stay a plain limit (0x3F = 64 c-list entries): a GT's
# slot_id occupies the same bits[15:0], so it cannot double as the Thread GT.
# BOOT_PROGRAM[1] = CHANGE CR12, CR15[1] instead resolves NS slot 1 via the
# boot-window direct-GT path in hardware/change.py (mirrors the CALL fix).
_wukong_ns0_auth = 0x0000003F               # limit word — 64 NS/c-list entries
WUKONG_DEMO_NAMESPACE[0] = _wukong_ns0_loc
WUKONG_DEMO_NAMESPACE[1] = _wukong_ns0_auth
WUKONG_DEMO_NAMESPACE[2] = integrity32(_wukong_ns0_loc, _wukong_ns0_auth)

# The canonical SelfTest LUMP is the 512-word image used by the simulator and
# boot-image generator. It must be present in factory DMEM because the
# lightning-bolt default is a real executable entry.
# Slot 6 occupies byte range 0x600..0xDFF.
WUKONG_SELFTEST_BASE_BYTE = 0x0600
WUKONG_SELFTEST_BASE_WORD = WUKONG_SELFTEST_BASE_BYTE // 4
WUKONG_SELFTEST_ALLOC = 512
_selftest_word1 = WUKONG_SELFTEST_ALLOC - 1
WUKONG_DEMO_NAMESPACE[SELFTEST_NS_SLOT * 4 + 0] = WUKONG_SELFTEST_BASE_BYTE
WUKONG_DEMO_NAMESPACE[SELFTEST_NS_SLOT * 4 + 1] = _selftest_word1
WUKONG_DEMO_NAMESPACE[SELFTEST_NS_SLOT * 4 + 2] = integrity32(
    WUKONG_SELFTEST_BASE_BYTE, _selftest_word1
)

# Canonical 512-word SelfTest image (server/lumps/00000600.lump), stored
# big-endian on disk.  The Wukong synthesis runs from this repository, so use
# the canonical binary directly instead of maintaining a second copied image.
_selftest_path = Path(__file__).resolve().parents[1] / "server" / "lumps" / "00000600.lump"
try:
    _selftest_raw = _selftest_path.read_bytes()
except OSError as exc:
    raise RuntimeError(
        f"Wukong factory image requires canonical SelfTest lump: {_selftest_path}"
    ) from exc
WUKONG_SELFTEST_WORDS = tuple(struct.unpack(">512I", _selftest_raw))
assert WUKONG_SELFTEST_WORDS[0] == 0xF987CC02  # cc=2 (Next.GT in slot 1); update when 00000600.lump is recompiled
# c-list[0] is at word[512-cc] = word[510]; word[511] is c-list[1] (Next.GT, runtime-patched)
assert WUKONG_SELFTEST_WORDS[510] == 0x4A000006  # c-list[0]: SelfTest E-GT (Church domain, E-perm, NS slot 6) — baked in at compile time

# The standalone image includes the CapabilityTest currently selected by the
# IDE for Namespace slot 10.  This is a replaceable boot default, not a
# factory-owned artifact: its filename, issue, token, and allocation come from
# ns-state.json and the matching manifest/sidecar records.
CAPABILITY_TEST_NS_SLOT = 10
WUKONG_CAPABILITY_TEST_BASE_BYTE = 0x1400
WUKONG_CAPABILITY_TEST_BASE_WORD = WUKONG_CAPABILITY_TEST_BASE_BYTE // 4
_lumps_dir = Path(__file__).resolve().parents[1] / "server" / "lumps"
_capability_test_ns_state_path = _lumps_dir / "ns-state.json"
_capability_test_manifest_path = _lumps_dir / "manifest.json"
with _capability_test_ns_state_path.open("r", encoding="utf-8") as _fh:
    _capability_test_ns_state = json.load(_fh)
_capability_test_ns_matches = [
    _entry for _entry in _capability_test_ns_state.get("abstractions", [])
    if _entry.get("name") == "CapabilityTest"
    and _entry.get("slot") == CAPABILITY_TEST_NS_SLOT
]
if len(_capability_test_ns_matches) != 1:
    raise RuntimeError(
        "IDE Namespace must select exactly one CapabilityTest at slot 10; "
        f"found {len(_capability_test_ns_matches)}"
    )
_capability_test_ns_entry = _capability_test_ns_matches[0]
_capability_test_filename = _capability_test_ns_entry.get("filename")
if not isinstance(_capability_test_filename, str) or not _capability_test_filename:
    raise RuntimeError(
        "IDE-selected CapabilityTest at slot 10 has no LUMP filename"
    )
WUKONG_CAPABILITY_TEST_FILENAME = _capability_test_filename
_capability_test_sidecar_filename = str(
    Path(_capability_test_filename).with_suffix(".json")
)
_capability_test_path = _lumps_dir / _capability_test_filename
_capability_test_sidecar_path = _lumps_dir / _capability_test_sidecar_filename
try:
    _capability_test_raw = _capability_test_path.read_bytes()
except OSError as exc:
    raise RuntimeError(
        f"Wukong default image requires the IDE-selected CapabilityTest LUMP: "
        f"{_capability_test_path}"
    ) from exc
if not _capability_test_raw or len(_capability_test_raw) % 4:
    raise RuntimeError(
        "IDE-selected CapabilityTest must be a non-empty whole-word LUMP; "
        f"got {len(_capability_test_raw)} bytes"
    )
WUKONG_CAPABILITY_TEST_ALLOC = len(_capability_test_raw) // 4
WUKONG_CAPABILITY_TEST_WORDS = tuple(
    struct.unpack(f">{WUKONG_CAPABILITY_TEST_ALLOC}I", _capability_test_raw)
)
_capability_test_header = WUKONG_CAPABILITY_TEST_WORDS[0]
_capability_test_declared_alloc = 1 << (((_capability_test_header >> 23) & 0xF) + 6)
_capability_test_cw = (_capability_test_header >> 10) & 0x1FFF
_capability_test_cc = _capability_test_header & 0xFF
if (
    ((_capability_test_header >> 27) & 0x1F) != 0x1F
    or _capability_test_declared_alloc != WUKONG_CAPABILITY_TEST_ALLOC
    or 1 + _capability_test_cw + _capability_test_cc
       > WUKONG_CAPABILITY_TEST_ALLOC
):
    raise RuntimeError(
        "IDE-selected CapabilityTest has an invalid LUMP header or allocation: "
        f"{_capability_test_filename}"
    )
# Bind the standalone default to the IDE-selected Namespace record and its
# exact sidecar/manifest data, without imposing an implementation or size.
_capability_test_hash = hashlib.sha256(_capability_test_raw).hexdigest()
with _capability_test_sidecar_path.open("r", encoding="utf-8") as _fh:
    _capability_test_sidecar = json.load(_fh)
with _capability_test_manifest_path.open("r", encoding="utf-8") as _fh:
    _capability_test_manifest = json.load(_fh)
_capability_test_manifest_entries = (
    _capability_test_manifest
    if isinstance(_capability_test_manifest, list)
    else _capability_test_manifest.get("lumps", [])
)
_capability_test_manifest_entry = next(
    (
        _entry for _entry in _capability_test_manifest_entries
        if _entry.get("filename") == _capability_test_filename
    ),
    None,
)
if (
    _capability_test_sidecar.get("filename") != _capability_test_filename
    or _capability_test_sidecar.get("sidecar_file") != _capability_test_sidecar_filename
    or _capability_test_sidecar.get("token") != _capability_test_ns_entry.get("token")
    or _capability_test_sidecar.get("ns_slot") != CAPABILITY_TEST_NS_SLOT
    or _capability_test_sidecar.get("binary_hash") != _capability_test_hash
    or _capability_test_manifest_entry is None
    or _capability_test_manifest_entry.get("sidecar_file")
       != _capability_test_sidecar_filename
    or _capability_test_manifest_entry.get("token")
       != _capability_test_ns_entry.get("token")
    or _capability_test_manifest_entry.get("ns_slot")
       != CAPABILITY_TEST_NS_SLOT
    or _capability_test_manifest_entry.get("binary_hash")
       != _capability_test_hash
):
    raise RuntimeError(
        "IDE-selected CapabilityTest binding is stale or inconsistent: "
        f"{_capability_test_filename}"
    )

# The generic standalone namespace has eight minimal slots. Wukong also carries
# CapabilityTest at slot 10, so extend its forward table through that slot.
while len(WUKONG_DEMO_NAMESPACE) < (CAPABILITY_TEST_NS_SLOT + 1) * 4:
    WUKONG_DEMO_NAMESPACE.append(0)
_capability_test_word1 = WUKONG_CAPABILITY_TEST_ALLOC - 1
WUKONG_DEMO_NAMESPACE[CAPABILITY_TEST_NS_SLOT * 4 + 0] = WUKONG_CAPABILITY_TEST_BASE_BYTE
WUKONG_DEMO_NAMESPACE[CAPABILITY_TEST_NS_SLOT * 4 + 1] = _capability_test_word1
WUKONG_DEMO_NAMESPACE[CAPABILITY_TEST_NS_SLOT * 4 + 2] = integrity32(
    WUKONG_CAPABILITY_TEST_BASE_BYTE, _capability_test_word1
)

# Fix slot 7 (WukongCallHome) alloc from 64 → 128 words and move it after
# the relocated Thread lump. The old 0x700 location overlapped SelfTest,
# and the old 0x900 location overlaps the 256-word Thread.
# DEMO_NAMESPACE was built with alloc=64 (lim17=63=0x3F) for all abstraction slots.
# The WukongCallHome LUMP body is header + WUKONG_NUC_PROGRAM (73 words) = 74 words,
# padded to 128 (next power of 2 ≥ 74).  Patch word1 (lim17=127) and recompute the
# integrity seal so the CM's NS range-check passes during LUMP execution.
_wch_word1_new = 0x0000007F               # lim17 = 127  →  alloc = 128 words
WUKONG_CALLHOME_BASE_BYTE = 0x1200
WUKONG_CALLHOME_BASE_WORD = WUKONG_CALLHOME_BASE_BYTE // 4
_wch_loc_byte  = WUKONG_CALLHOME_BASE_BYTE
WUKONG_DEMO_NAMESPACE[WUKONG_CALLHOME_NS_SLOT * 4 + 0] = _wch_loc_byte
WUKONG_DEMO_NAMESPACE[WUKONG_CALLHOME_NS_SLOT * 4 + 1] = _wch_word1_new
WUKONG_DEMO_NAMESPACE[WUKONG_CALLHOME_NS_SLOT * 4 + 2] = integrity32(_wch_loc_byte, _wch_word1_new)

# ---------------------------------------------------------------------------
# Wukong Boot.Thread lump relocation — slot 1 loc 0x000 → 0xE00
#
# With the NS table at DMEM byte 0, a Thread lump that also aliases byte 0
# collides with the table: protected STO (thread word 17, read and written by
# CALL/RETURN) is NS slot 4's word1. The boot CALL then reads
# STO=0 → STACK_OVERFLOW, and any CALL/RETURN would corrupt slot 4.
# Relocate the Thread lump to byte 0xE00 (word 896) — after the full SelfTest
# image (words 384-895) and before WukongCallHome (words 1152-1279).
#   header  word 896      : magic, size=256 words, sw(cw)=32, typ=2, cc=12
#   STO     word 896+17   : 243 (= sp_max = 256 − 12 − 1)
#   caps[0] word 896+244  : boot-entry E-GT (⚡ CapabilityTest)
#   caps[12]word 896+256  : S-perm Boot.Thread GT (slot 1) for CR12
# Slot 1 word1 limit widened to 0xFF (256-word alloc); seal recomputed.
# ---------------------------------------------------------------------------
WUKONG_THREAD_BASE_WORD = 896                # byte 0xE00
WUKONG_THREAD_HEADER = (
    (0x1F << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12
)  # n_minus_6=2 (256 words), sw=32, typ=2, cc=12 — mirrors boot_image.py
WUKONG_THREAD_STO_WORD  = WUKONG_THREAD_BASE_WORD + 17    # protected STO
WUKONG_THREAD_STO_INIT  = 243                             # sp_max
WUKONG_THREAD_CAPS0_WORD  = WUKONG_THREAD_BASE_WORD + 244  # Thread.caps[0]
WUKONG_THREAD_CAPS12_WORD = WUKONG_THREAD_BASE_WORD + 256  # Thread.caps[12]
_wukong_thr_loc  = WUKONG_THREAD_BASE_WORD * 4   # 0xE00
_wukong_thr_w1   = 0x000000FF                    # lim17 = 255 → 256-word alloc
WUKONG_DEMO_NAMESPACE[1 * 4 + 0] = _wukong_thr_loc
WUKONG_DEMO_NAMESPACE[1 * 4 + 1] = _wukong_thr_w1
WUKONG_DEMO_NAMESPACE[1 * 4 + 2] = integrity32(_wukong_thr_loc, _wukong_thr_w1)


# ---------------------------------------------------------------------------
# WUKONG_DEMO_CLIST — c-list for Wukong boot (8-slot namespace subset)
#
# Derived from DEMO_CLIST with three overrides:
#
#   idx  0 — SelfTest E-GT: the factory CALL target and the same abstraction
#             selected by the simulator's default lightning bolt. An IDE
#             boot-image upload may overwrite Thread.caps[0] with another
#             selected entry, but a cold standalone board must not silently
#             enter WukongCallHome.
#
#   idx  9 — SlideRule E-GT cleared: NS slot 8 absent in Wukong 8-slot NS
#   idx 10 — Constants R-GT cleared: NS slot 9 absent in Wukong 8-slot NS
# ---------------------------------------------------------------------------
WUKONG_DEMO_CLIST = make_demo_clist()   # idx 1 = Next.GT (SelfTest self-loop by default)
WUKONG_DEMO_CLIST[0]  = make_gt(GT_TYPE_INFORM, PERM_MASK_E, CAPABILITY_TEST_NS_SLOT, 0)
WUKONG_DEMO_CLIST[9]  = 0           # SlideRule E-GT cleared: NS slot 8 absent in Wukong 8-slot NS
WUKONG_DEMO_CLIST[10] = 0           # Constants R-GT cleared: NS slot 9 absent in Wukong 8-slot NS

# ---------------------------------------------------------------------------
# WukongCallHome LUMP c-list tail — cc=8, entries at the lump's last 8 words.
#
# The hardware CALL derives CR6 from the CALLED lump's own header: cc=0 makes
# SET_CR6_BASE write a NULL GT into CR6, and WCH's first instruction
# (LOAD CR3, CR6[5]) then faults NULL_CAP.  Give the lump a real c-list:
# base = lump_base + (alloc − cc)·4 = 0x1200 + 120·4 = 0x13E0 (words 1272-1279).
# Entries mirror the boot c-list slots WCH uses: [5]=LED_DEV, [6]=UART_DEV.
# cc=8 (not 7): CR6.limit = cc−1 and mLoad's bounds check is strict '<', so
# the highest usable index is cc−2; index 6 (UART) needs cc≥8.
# ---------------------------------------------------------------------------
WUKONG_WCH_BASE_WORD  = WUKONG_CALLHOME_BASE_WORD  # byte 0x1200
WUKONG_WCH_ALLOC      = 128          # words (lim17=127 patched above)
WUKONG_WCH_CC         = 8
WUKONG_WCH_CLIST_WORD = WUKONG_WCH_BASE_WORD + WUKONG_WCH_ALLOC - WUKONG_WCH_CC  # 1272
WUKONG_WCH_CLIST = [0, 0, 0, 0, 0,
                    WUKONG_DEMO_CLIST[5],   # LED_DEV Inform GT
                    WUKONG_DEMO_CLIST[6],   # UART_DEV Inform GT
                    0]


def wukong_wch_header(cw):
    """WCH lump header: magic, n_minus_6=1 (128 words), cw code words, cc=8."""
    return (0x1F << 27) | (1 << 23) | (cw << 10) | WUKONG_WCH_CC


# ---------------------------------------------------------------------------
# WUKONG_NUC_PROGRAM — Wukong V2 callhome boot program
#
# Human-readable CLOOMC source: simulator/examples/wukong_callhome.cloomc
# Divergence CI guard:          scripts/check_wukong_callhome_divergence.js
# Architecture doc:             docs/wukong-boot.md
#
# Executed from ROM[0] immediately after hw_init and boot_start.
# Sequence (every ~1 Hz loop iteration):
#   1. Load LED_DEV (c-list slot 5 → CR3) and UART_DEV (c-list slot 6 → CR4)
#   2. ── loop top ──
#      a. Turn LED0 on
#      b. Transmit banner "CM:WUKONG\r\n" over UART at 57600 baud, polling
#         STATUS (UART MMIO word 1) between bytes
#      c. Delay ~0.498 s (on phase)
#      d. Turn LED0 off
#      e. Delay ~0.498 s (off phase)
#      f. Branch back to loop top
#
# Moving the banner into the blink loop means the banner repeats once per
# second (~1 Hz) continuously.  Connecting the serial port at any time
# causes the next "CM:WUKONG\r\n" to arrive within 1 second.
#
# MMIO layout (base = 0x40000000, word-addressed via DWRITE/DREAD):
#   CR3 (LED_DEV,  NS slot 3): word 0 = LED0 {B,G,R}; bit 0 = R → physical pin
#   CR4 (UART_DEV, NS slot 2): word 0 = TX (write), word 1 = STATUS (read, bit0=busy)
#
# Register allocation:
#   DR0 = 0 (zero register, never written)
#   DR1 = 1 (LED "on" value)
#   DR2 = inner delay counter
#   DR3 = outer delay counter
#   DR5 = UART byte value
#   DR6 = UART STATUS read
#   DR7 = STATUS - 1 scratch (EQ=0 means busy)
#
# UART busy-poll per byte (5 instructions):
#   IADD  DR5, DR0, #byte       — load byte value
#   DWRITE CR4[0], DR5          — write to UART TX
#   DREAD  DR6, CR4[1]          — read STATUS (bit0=tx_busy)
#   ISUB   DR7, DR6, #1         — DR7=0 if busy (→ EQ flag set)
#   BRANCH EQ, #-2              — loop back to DREAD while busy
#
# LED blink timing (50 MHz clock):
#   inner = 16383 iterations × 4 cycles = ~65532 cycles
#   outer = 380   iterations  → 380 × 65532 ≈ 24,902,160 cycles ≈ 0.498 s per phase
#   → LED0 on ~0.498 s, off ~0.498 s  →  ~1 Hz blink
#
# Word-offset table (base = ROM word 0):
#   0  LOAD  CR3, CR6[5]        — LED_DEV → CR3
#   1  LOAD  CR4, CR6[6]        — UART_DEV → CR4
#   2  IADD  DR1, DR0, #1       — DR1 = 1
#   ── loop top ──────────────────────────────────────────────── index 3
#   3  DWRITE CR3[0], DR1       — LED0 = on
#   4-58  banner "CM:WUKONG\r\n"  (11 bytes × 5 instrs = 55 words)
#  59  IADD  DR3, DR0, #380     — on-phase outer count
#  60  IADD  DR2, DR0, #16383   — on-phase inner count  ← outer-on-top
#  61  ISUB  DR2, DR2, #1       ← inner-on-top
#  62  BRANCH NE, #-1           → 61
#  63  ISUB  DR3, DR3, #1
#  64  BRANCH NE, #-4           → 60
#  65  DWRITE CR3[0], DR0       — LED0 = off
#  66  IADD  DR3, DR0, #380     — off-phase outer count
#  67  IADD  DR2, DR0, #16383   — off-phase inner count  ← outer-off-top
#  68  ISUB  DR2, DR2, #1       ← inner-off-top
#  69  BRANCH NE, #-1           → 68
#  70  ISUB  DR3, DR3, #1
#  71  BRANCH NE, #-4           → 67
#  72  BRANCH AL, #-69          → 3 (loop top: LED on + banner)
# ---------------------------------------------------------------------------

def _uart_send_byte(char_val):
    """Return 5-instruction sequence: load byte → DWRITE TX → poll STATUS."""
    return [
        encode_turing(TuringOpcode.IADD,   CondCode.AL, dr_dst=5, dr_src=0, imm=char_val),
        encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=5, dr_src=4, imm=0),
        encode_turing(TuringOpcode.DREAD,  CondCode.AL, dr_dst=6, dr_src=4, imm=1),
        encode_turing(TuringOpcode.ISUB,   CondCode.AL, dr_dst=7, dr_src=6, imm=1),
        encode_turing(TuringOpcode.BRANCH, CondCode.EQ, imm=(-2) & 0x7FFF),
    ]

_WUKONG_BANNER = b"CM:WUKONG\r\n"

WUKONG_NUC_PROGRAM = [
    # ── Setup (indices 0-2) — one-time capability loads ──────────────────────
    # 0: load LED_DEV capability into CR3 (c-list slot 5)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=3, cr_src=6, imm=5),
    # 1: load UART_DEV capability into CR4 (c-list slot 6)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=4, cr_src=6, imm=6),
    # 2: DR1 = 1  (LED "on" value)
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1),
    # ── Loop top (index 3) — repeated every ~1 Hz ────────────────────────────
    # 3: LED0 = on  ← unconditional branch target from index 72
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=0),
]

# ── UART callhome banner: "CM:WUKONG\r\n" inside the loop ────────────────────
# Indices 4-58 inclusive (11 bytes × 5 instructions = 55 words).
for _wukong_ch in _WUKONG_BANNER:
    WUKONG_NUC_PROGRAM.extend(_uart_send_byte(_wukong_ch))

# ── On-delay + LED off + off-delay + loop branch (indices 59-72) ─────────────
_WUKONG_LOOP_TOP = 3   # index of "LED0 = on" — branch target for BRANCH AL

WUKONG_NUC_PROGRAM += [
    # 59: on-phase outer count
    encode_turing(TuringOpcode.IADD,   CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 60: on-phase inner count  ← outer-on-top
    encode_turing(TuringOpcode.IADD,   CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 61: inner decrement  ← inner-on-top
    encode_turing(TuringOpcode.ISUB,   CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 62: BRANCH NE → inner-on-top (61)   offset = 61-62 = -1
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 63: outer decrement
    encode_turing(TuringOpcode.ISUB,   CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 64: BRANCH NE → outer-on-top (60)   offset = 60-64 = -4
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 65: LED0 = off
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=0),
    # 66: off-phase outer count
    encode_turing(TuringOpcode.IADD,   CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 67: off-phase inner count  ← outer-off-top
    encode_turing(TuringOpcode.IADD,   CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 68: inner decrement  ← inner-off-top
    encode_turing(TuringOpcode.ISUB,   CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 69: BRANCH NE → inner-off-top (68)  offset = 68-69 = -1
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 70: outer decrement
    encode_turing(TuringOpcode.ISUB,   CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 71: BRANCH NE → outer-off-top (67)  offset = 67-71 = -4
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 72: BRANCH AL → loop top (3)        offset = 3-72 = -69
    encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=(-69) & 0x7FFF),
]

assert len(WUKONG_NUC_PROGRAM) == 73, f"WUKONG_NUC_PROGRAM length = {len(WUKONG_NUC_PROGRAM)}, expected 73"

# Structurally verify the final BRANCH AL encodes the correct loop-back offset.
# This catches silent drift when new banner bytes are added: the branch index
# shifts forward but _WUKONG_LOOP_TOP stays at 3, making the hardcoded imm wrong.
# The check is expressed in terms of the named constant so it self-corrects as
# the program grows — the assertion itself never needs updating.
_WUKONG_BRANCH_INDEX = len(WUKONG_NUC_PROGRAM) - 1  # currently 72
_expected_branch_offset = _WUKONG_LOOP_TOP - _WUKONG_BRANCH_INDEX  # currently -69
_branch_word = WUKONG_NUC_PROGRAM[_WUKONG_BRANCH_INDEX]
_encoded_imm15 = _branch_word & 0x7FFF
# Sign-extend 15-bit two's-complement value (bit 14 is the sign bit).
_decoded_branch_offset = _encoded_imm15 if _encoded_imm15 < 0x4000 else _encoded_imm15 - 0x8000
assert _decoded_branch_offset == _expected_branch_offset, (
    f"WUKONG_NUC_PROGRAM[{_WUKONG_BRANCH_INDEX}] loop-back branch offset "
    f"{_decoded_branch_offset} != {_expected_branch_offset} "
    f"(_WUKONG_LOOP_TOP={_WUKONG_LOOP_TOP}, branch_index={_WUKONG_BRANCH_INDEX}). "
    f"New banner bytes were added (or _WUKONG_LOOP_TOP changed) without updating "
    f"the BRANCH AL offset at the end of WUKONG_NUC_PROGRAM."
)


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
