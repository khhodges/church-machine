from amaranth import *

from .hw_types import *


def crc16_ccitt(gt_bits, location, word1_w2, poly=0x1021, init=0xFFFF):
    """CRC-16/CCITT over GT[24:0] (25 bits, MSB first) + location (32 bits) + word1_w2 (32 bits).
    Total: 89 bits, poly=0x1021, init=0xFFFF.
    gt_bits   : lower 25 bits of the 32-bit GT word (gt_type[1:0] | gt_seq[6:0] | slot_id[15:0])
                perms[30:25] and b_flag[31] are NOT included in the sealed input
    location  : NS word0_location (code base address)
    word1_w2  : NS word1_w2 (limit_offset | gt_seq)

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"GT Seal Verification"
    The hardware recomputes this CRC on LAMBDA, CALL, RETURN, and mLoad; a mismatch fires SEAL_MISMATCH.
    """
    crc = init
    for bit in range(24, -1, -1):
        top = ((crc >> 15) ^ ((gt_bits >> bit) & 1)) & 1
        crc = ((crc << 1) & 0xFFFF) ^ (poly if top else 0)
    for word in (location, word1_w2):
        for bit in range(31, -1, -1):
            top = ((crc >> 15) ^ ((word >> bit) & 1)) & 1
            crc = ((crc << 1) & 0xFFFF) ^ (poly if top else 0)
    return crc & 0xFFFF


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
    """Encode a 32-bit Golden Token word.

    GT Word 0 field layout (current — matches CLOOMC listing in secure_boot_tutorial.js):
      [15:0]  slot_id   — 16-bit namespace slot index
      [22:16] gt_seq    — 7-bit revocation counter (must match NS entry word2[31:25])
      [24:23] gt_type   — 00=NULL  01=Inform (GT_TYPE_INFORM)  10=Outform (GT_TYPE_OUTFORM)  11=Abstract (GT_TYPE_ABSTRACT)
      [30:25] perms     — R W X L S E (one bit each, LSB=R)
      [31]    b_flag    — bindable override (1=IDE-bound peripheral; excluded from CRC seal input)

    b_flag=1 for IO device GTs (LED, UART, BTN, TIMER): marks the GT as bound to a physical
    resource by the system configurator. Excluded from GT[24:0] CRC input so runtime/debugger
    can set/clear it without recomputing the NS entry seal.

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Secure Boot — Overview"
    """
    return (b_flag << 31) | (perms << 25) | (gt_type << 23) | (gt_seq << 16) | slot_id


# ---------------------------------------------------------------------------
# BOOT_PROGRAM — the instruction ROM executed from reset
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js
#   §B:02 INIT_THRD    → BOOT_PROGRAM[0]  CHANGE AL, CR12, CR12, #1
#   §B:03 INIT_ABSTR   → BOOT_PROGRAM[1]  LOAD  AL, CR1, CR6[0]   ; code/constants GT (R|X, Slot 3) → CR1
#                      → BOOT_PROGRAM[2]  LOAD  AL, CR2, CR6[1]   ; boot code GT (X, Slot 4) → CR2
#                      → BOOT_PROGRAM[3]  TPERM AL, CR2, #X       ; restrict to X only
#                      → BOOT_PROGRAM[4]  LAMBDA AL, CR2          ; enter boot code (1st seal checkpoint)
#   §B:04 LOAD_NUC     → BOOT_PROGRAM[5]  LOAD  AL, CR0, CR6[4]   ; Salvation E-GT → CR0
#                      → BOOT_PROGRAM[6]  TPERM AL, CR0, #E       ; restrict to E
#                      → BOOT_PROGRAM[7]  CALL  AL, CR0, CR0      ; enter user abstr (2nd seal checkpoint)
#   §Epilogue          → BOOT_PROGRAM[8]  LOAD  AL, CR7, CR6[1]   ; reload boot code GT (Slot 4)
#                      → BOOT_PROGRAM[9]  TPERM AL, CR7, #X       ; restrict to X
#                      → BOOT_PROGRAM[10] LAMBDA AL, CR7          ; re-enter boot finalisation
#                      → BOOT_PROGRAM[11] RETURN AL, CR5          ; boot complete; mask CR5
#                      → BOOT_PROGRAM[12] SAVE  AL, CR6, CR1, #2  ; persist Thread GT to c-list[2]
# ---------------------------------------------------------------------------
BOOT_PROGRAM = []
if ENABLE_CHANGE_SWITCH:
    # B:02 INIT_THRD — switch to thread context
    # CLOOMC: CHANGE AL, CR12, CR12, #1
    BOOT_PROGRAM.append(
        encode_church(ChurchOpcode.CHANGE, CondCode.AL, cr_dst=12, cr_src=12, imm=1))

BOOT_PROGRAM += [
    # B:03 INIT_ABSTR — load code/constants GT into CR1 from c-list[0]
    # CLOOMC: LOAD AL, CR1, CR6[0]  → make_gt(GT_TYPE_INFORM, R|X, slot_id=3, gt_seq=0)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=1, cr_src=6, imm=0),

    # B:03 — load boot code GT into CR2 from c-list[1]
    # CLOOMC: LOAD AL, CR2, CR6[1]  → make_gt(GT_TYPE_INFORM, X, slot_id=4, gt_seq=0)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=2, cr_src=6, imm=1),

    # B:03 — restrict CR2 to X permission only (TPERM does not check seal)
    # CLOOMC: TPERM AL, CR2, #X
    encode_church(ChurchOpcode.TPERM, CondCode.AL, cr_dst=2, imm=TpermPreset.X),

    # B:03 INIT_ABSTR — enter boot code via LAMBDA (1-word frame; CR6 unchanged)
    # CLOOMC: LAMBDA AL, CR2
    # SECURITY CHECKPOINT 1: hardware re-validates CRC-16 seal of NS Slot 4 here.
    # A SEAL_MISMATCH fault fires if NS Slot 4 (boot code) has been tampered with.
    encode_church(ChurchOpcode.LAMBDA, CondCode.AL, cr_dst=2),

    # B:04 LOAD_NUC — load Salvation E-GT into CR0 from c-list[4]
    # CLOOMC: LOAD AL, CR0, CR6[4]  → make_gt(GT_TYPE_INFORM, E, slot_id=4, gt_seq=0)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=0, cr_src=6, imm=4),

    # B:04 — restrict CR0 to E permission only before CALL
    # CLOOMC: TPERM AL, CR0, #E
    encode_church(ChurchOpcode.TPERM, CondCode.AL, cr_dst=0, imm=TpermPreset.E),

    # B:04 LOAD_NUC — CALL into the first user abstraction
    # CLOOMC: CALL AL, CR0, CR0
    # SECURITY CHECKPOINT 2: hardware re-validates CRC-16 seal of NS Slot 4 here.
    # On success:
    #   CR14 derived from NS Slot 4: base=word0_location, limit=word1[16:0], perm=RX only (no W)
    #   CR6  derived from NS Slot 4: base=clistStart, limit=clistCount-1, perm=L
    #   2-word CALL frame pushed onto thread LIFO stack (STO += 2)
    #   PC = 0 — user abstraction begins executing
    encode_church(ChurchOpcode.CALL, CondCode.AL, cr_dst=0, cr_src=0),

    # Epilogue (after user RETURN) — reload Boot.Abstr code GT
    # CLOOMC: LOAD AL, CR7, CR6[1]
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=7, cr_src=6, imm=1),

    # Epilogue — restrict CR14 to X permission only
    # CLOOMC: TPERM AL, CR7, #X
    encode_church(ChurchOpcode.TPERM, CondCode.AL, cr_dst=7, imm=TpermPreset.X),

    # Epilogue — re-enter boot finalisation via LAMBDA
    # CLOOMC: LAMBDA AL, CR7
    encode_church(ChurchOpcode.LAMBDA, CondCode.AL, cr_dst=7),

    # Epilogue — boot complete; RETURN with capability mask clearing CR5
    # CLOOMC: RETURN AL, CR5  (mask bit 5 = 0b100000 clears CR5)
    encode_church(ChurchOpcode.RETURN, CondCode.AL, cr_src=5),

    # Epilogue — persist Thread GT (CR1) into c-list slot 2 for runtime use
    # CLOOMC: SAVE AL, CR6, CR1, #2
    encode_church(ChurchOpcode.SAVE, CondCode.AL, cr_dst=6, cr_src=1, imm=2),
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
SLIDERULE_SLOT    = 16
CONSTANTS_SLOT    = 18

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


def _make_ns_entry(gt_type, perms, slot_id, gt_seq, location, alloc_size, cw=0, cc=0, n_minus_6=0):
    """Build a 3-word NS entry (stride = slot_id * 12, i.e. 12 bytes per entry).

    Layout:
      word0_location (+0): lump base byte address (location)
      word1_w2       (+4): limit_offset[20:0] | gt_seq[6:0] | spare[3:0]
                           limit_offset = alloc_size - 1  (last valid index)
      word2_w3       (+8): crc[15:0] | g_bit | spare[14:0]
                           crc = CRC-16/CCITT over GT[24:0] + location + word1_w2

    The lump header (LUMP_HEADER_LAYOUT) is at word 0 of the lump itself (at location),
    not cached in the NS table entry.

    The GT bits used in the CRC are the lower 25 bits of the GT word (no b_flag or top perms).

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
    GT Word 0 fields: slot_id[15:0], gt_seq[22:16], gt_type[24:23], perms[30:25]
    """
    gt_word0 = make_gt(gt_type, perms, slot_id, gt_seq)
    gt25 = gt_word0 & 0x1FFFFFF

    limit_offset = max(0, alloc_size - 1) & 0x1FFFFF
    word1_w2 = ((gt_seq & 0x7F) << 21) | limit_offset

    crc = crc16_ccitt(gt25, location, word1_w2)
    word2_w3 = crc & 0xFFFF

    return [location, word1_w2, word2_w3]


# ---------------------------------------------------------------------------
# MMIO device GT slot assignments — aligned with simulator DEVICE_NS_SLOTS
#
#   Slot 0:  Boot.NS (NS root)
#   Slot 1:  Boot.Thread
#   Slot 2:  Boot.Abstr
#   Slot 3:  (empty)
#   Slot 4:  Salvation (E)     — first user abstraction; NUC_PROGRAM on hardware
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
#
# Physical LED mapping (R bit = bit 0 of each word):
#   Ti60 F225 (4 LEDs active-HIGH):
#     offset 0→led0, 1→led1, 2→led2, 3→led3; offset 4 = register-only (no pin)
#   Tang Nano 20K (6 LEDs active-LOW, led3 pin absent):
#     offset 0→led0, 1→led1, 2→led2, 3→led4, 4→led5; led3 pin not connected
# ---------------------------------------------------------------------------
MMIO_LED_SLOT   = 12
MMIO_UART_SLOT  = 11
MMIO_BTN_SLOT   = 13
MMIO_TIMER_SLOT = 14

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
#   Slot  2: Boot.Abstr   — Boot Abstraction lump   (base = 0x0200)
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
_SYSTEM_ABSTRACTION_SLOTS = {
    5:  ('Navana',       PERM_MASK_E),
    6:  ('Mint',         PERM_MASK_E),
    7:  ('Memory',       PERM_MASK_E),
    8:  ('Scheduler',    PERM_MASK_E),
    9:  ('Stack',        PERM_MASK_E),
    10: ('DijkstraFlag', PERM_MASK_E),
    15: ('Display',      PERM_MASK_E),
}

NS_SLOT_COUNT = 19

DEMO_NAMESPACE = []
for _i in range(NS_SLOT_COUNT):
    if _i in _MMIO_ENTRIES:
        _loc, _sz, _gtype, _perms = _MMIO_ENTRIES[_i]
        _entry = _make_ns_entry(_gtype, _perms, _i, 0, _loc, _sz)
    elif _i == 0:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                NS_TABLE_BASE, 64)
    elif _i == 4:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_E, _i, 0,
                                NUC_LUMP_BASE, 64)
    elif _i == SLIDERULE_SLOT:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_E, _i, 0,
                                SLIDERULE_LUMP_BASE, 256)
    elif _i == CONSTANTS_SLOT:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R, _i, 0,
                                CONSTANTS_SLOT * 0x100, 64)
    elif _i in _SYSTEM_ABSTRACTION_SLOTS:
        _name, _perms = _SYSTEM_ABSTRACTION_SLOTS[_i]
        _entry = _make_ns_entry(GT_TYPE_INFORM, _perms, _i, 0,
                                _i * 0x100, 64)
    elif _i == 3:
        _entry = _make_ns_entry(GT_TYPE_NULL, 0, _i, 0, 0, 0)
    else:
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                _i * 0x100, 64)
    DEMO_NAMESPACE.extend(_entry)


# ---------------------------------------------------------------------------
# DEMO_CLIST — initial C-List for the boot abstraction (Slot 2)
#
# Aligned with simulator boot c-list (simulator.js _initBootState).
#
#   idx  0: make_gt(Inform, R|X, slot_id=3, gt_seq=0)          — boot-internal: code/constants R|X GT
#   idx  1: make_gt(Inform, X,   slot_id=4, gt_seq=0)          — boot-internal: boot code exec-only GT
#   idx  2: make_gt(NULL,   0,   0,         0)                  — boot-internal: filled by SAVE epilogue (Thread GT)
#   idx  3: make_gt(Inform, E,   slot_id=2, gt_seq=0)          — boot-internal: Boot.Abstr E-GT (return channel)
#   idx  4: make_gt(Inform, E,   slot_id=4, gt_seq=0)          — Salvation E-GT (first user abstr) ← B:04
#   idx  5: make_gt(Inform, E,   slot_id=5, gt_seq=0)          — Navana E-GT
#   idx  6: make_gt(Inform, E,   slot_id=6, gt_seq=0)          — Mint E-GT
#   idx  7: make_gt(Inform, E,   slot_id=7, gt_seq=0)          — Memory E-GT
#   idx  8: make_gt(Inform, R|W, slot_id=12, b_flag=1)         — LED_DEV  (MMIO, bindable)
#   idx  9: make_gt(Inform, R|W, slot_id=11, b_flag=1)         — UART_DEV (MMIO, bindable)
#   idx 10: make_gt(Inform, R,   slot_id=13, b_flag=1)         — BTN_DEV  (MMIO, bindable)
#   idx 11: make_gt(Inform, R|W, slot_id=14, b_flag=1)         — TIMER_DEV(MMIO, bindable)
#   idx 12: make_gt(Inform, E,   slot_id=16, gt_seq=0)         — SlideRule E-GT (Layer 3)
#   idx 13: make_gt(Inform, R,   slot_id=18, gt_seq=0)         — Constants R-GT (Layer 3)
#
# Indices 0–3 are boot-internal (used by BOOT_PROGRAM firmware only).
# Indices 4–13 are the user-visible c-list, matching simulator layout exactly.
#
# b_flag=1 marks each IO device GT as IDE-bound to a physical peripheral.  The flag is
# excluded from the CRC seal input so the runtime can clear it on un-bind without
# recomputing the NS entry.
# ---------------------------------------------------------------------------
DEMO_CLIST = [
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, 3, 0),        # idx 0: boot-internal code/constants R|X
    make_gt(GT_TYPE_INFORM, PERM_MASK_X, 4, 0),                       # idx 1: boot-internal boot code X-only
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                    # idx 2: boot-internal → Thread GT after SAVE
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 2, 0),                       # idx 3: boot-internal Boot.Abstr E-GT
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 4, 0),                       # idx 4: Salvation E-GT, Slot 4 (B:04)
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 5, 0),                       # idx 5: Navana E-GT, Slot 5
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 6, 0),                       # idx 6: Mint E-GT, Slot 6
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 7, 0),                       # idx 7: Memory E-GT, Slot 7
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_LED_SLOT,   0, b_flag=1),  # idx 8:  LED_DEV  → NS 12
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_UART_SLOT,  0, b_flag=1),  # idx 9:  UART_DEV → NS 11
    make_gt(GT_TYPE_INFORM, PERM_MASK_R,                MMIO_BTN_SLOT,   0, b_flag=1),  # idx 10: BTN_DEV  → NS 13
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_TIMER_SLOT, 0, b_flag=1),  # idx 11: TIMER_DEV→ NS 14
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, SLIDERULE_SLOT, 0),            # idx 12: SlideRule E-GT, Slot 16
    make_gt(GT_TYPE_INFORM, PERM_MASK_R, CONSTANTS_SLOT, 0),            # idx 13: Constants R-GT, Slot 18
]

while len(DEMO_CLIST) < 64:
    DEMO_CLIST.append(0)


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
