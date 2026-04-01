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
#   §B:04 LOAD_NUC     → BOOT_PROGRAM[5]  LOAD  AL, CR0, CR6[6]   ; first user E-GT → CR0
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

    # B:04 LOAD_NUC — load first user abstraction E-GT into CR0 from c-list[6]
    # CLOOMC: LOAD AL, CR0, CR6[6]  → make_gt(GT_TYPE_INFORM, E, slot_id=4, gt_seq=0)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=0, cr_src=6, imm=6),

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
# NUC_PROGRAM — first abstraction: LED blink demo via DWRITE/IADD/ISUB/BRANCH
#
# Placed at boot_rom indices 256–511 (byte address 0x400–0x7FC).
# The CPU jumps here when the debug FSM releases it into free-run mode.
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
#   outer = 380   iterations → inner total = 380 × 65532 = 24,902,160 cycles ≈ 0.498 s
#   4 LEDs × 0.498 s ≈ 2.0 s per full revolution.
#
# NUC word-offset table (base = NUC index 0 = rom index 256):
#   0  LOAD  CR3, CR6[8]           — load LED_DEV capability
#   1  IADD  DR1, DR0, #1          — DR1 = 1 (on)
#   ── Phase 0: LED0 ──────────────────────────────────────────────────────────
#   2  DWRITE CR3[0], DR1          — LED0 = 1
#   3  IADD  DR3, DR0, #380        — outer count
#   4  IADD  DR2, DR0, #16383      — inner count  ← outer loop top
#   5  ISUB  DR2, DR2, #1          ← inner loop top
#   6  BRANCH NE, #-1              — → index 5 (inner)
#   7  ISUB  DR3, DR3, #1
#   8  BRANCH NE, #-4              — → index 4 (outer: reset inner count)
#   9  DWRITE CR3[0], DR0          — LED0 = 0
#   ── Phase 1: LED1 ──────────────────────────────────────────────────────────
#  10  DWRITE CR3[1], DR1
#  11  IADD  DR3, DR0, #380
#  12  IADD  DR2, DR0, #16383
#  13  ISUB  DR2, DR2, #1
#  14  BRANCH NE, #-1
#  15  ISUB  DR3, DR3, #1
#  16  BRANCH NE, #-4
#  17  DWRITE CR3[1], DR0
#   ── Phase 2: LED2 ──────────────────────────────────────────────────────────
#  18  DWRITE CR3[2], DR1
#  19  IADD  DR3, DR0, #380
#  20  IADD  DR2, DR0, #16383
#  21  ISUB  DR2, DR2, #1
#  22  BRANCH NE, #-1
#  23  ISUB  DR3, DR3, #1
#  24  BRANCH NE, #-4
#  25  DWRITE CR3[2], DR0
#   ── Phase 3: LED3 ──────────────────────────────────────────────────────────
#  26  DWRITE CR3[3], DR1
#  27  IADD  DR3, DR0, #380
#  28  IADD  DR2, DR0, #16383
#  29  ISUB  DR2, DR2, #1
#  30  BRANCH NE, #-1
#  31  ISUB  DR3, DR3, #1
#  32  BRANCH NE, #-4
#  33  DWRITE CR3[3], DR0
#  34  BRANCH AL, #-32             — loop back to index 2 (LED0 on)
# ---------------------------------------------------------------------------

# BRANCH imm = signed word offset from current instruction's byte address.
# branch_target = nia_reg + sign_extend(imm) * 4
# Inner back-edge: target = index 5, branch at index 6  → offset = 5-6 = -1 → 0x7FFF
# Outer back-edge: target = index 4, branch at index 8  → offset = 4-8 = -4 → 0x7FFC
# Same offsets repeat identically for phases 1-3.
# Final loop: target = index 2, branch at index 34 → offset = 2-34 = -32 → 0x7FE0

NUC_PROGRAM = [
    # 0: load LED_DEV capability into CR3 from DEMO_CLIST index 8 via CR6 (c-list cap)
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=3, cr_src=6, imm=8),
    # 1: DR1 = 0 + 1 = 1  (DR0 is hardwired to 0)
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1),
    # ── Phase 0: LED0 ─────────────────────────────────────────────────────────
    # 2: LED0 = 1 (on)
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=0),
    # 3: DR3 = outer count = 380
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 4: DR2 = inner count = 16383  ← outer-loop-top (resets inner counter)
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 5: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 6: if DR2 != 0, branch to index 5 (inner loop)
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 7: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 8: if DR3 != 0, branch to index 4 (outer loop: reset inner)
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 9: LED0 = 0 (off)
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=0),
    # ── Phase 1: LED1 ─────────────────────────────────────────────────────────
    # 10: LED1 = 1
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=1),
    # 11: DR3 = 380
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 12: DR2 = 16383  ← outer-loop-top
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 13: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 14: branch to index 13
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 15: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 16: branch to index 12
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 17: LED1 = 0
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=1),
    # ── Phase 2: LED2 ─────────────────────────────────────────────────────────
    # 18: LED2 = 1
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=2),
    # 19: DR3 = 380
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 20: DR2 = 16383  ← outer-loop-top
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 21: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 22: branch to index 21
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 23: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 24: branch to index 20
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 25: LED2 = 0
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=2),
    # ── Phase 3: LED3 ─────────────────────────────────────────────────────────
    # 26: LED3 = 1
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=1, dr_src=3, imm=3),
    # 27: DR3 = 380
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=0, imm=380),
    # 28: DR2 = 16383  ← outer-loop-top
    encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=0, imm=16383),
    # 29: DR2 -= 1  ← inner-loop-top
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=2, dr_src=2, imm=1),
    # 30: branch to index 29
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-1) & 0x7FFF),
    # 31: DR3 -= 1
    encode_turing(TuringOpcode.ISUB, CondCode.AL, dr_dst=3, dr_src=3, imm=1),
    # 32: branch to index 28
    encode_turing(TuringOpcode.BRANCH, CondCode.NE, imm=(-4) & 0x7FFF),
    # 33: LED3 = 0
    encode_turing(TuringOpcode.DWRITE, CondCode.AL, dr_dst=0, dr_src=3, imm=3),
    # ── Repeat ────────────────────────────────────────────────────────────────
    # 34: unconditional branch back to index 2 (LED0 on); offset = 2 - 34 = -32 words
    encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=(-32) & 0x7FFF),
]

# Assemble full ROM: BOOT_PROGRAM (256 words) + NUC_PROGRAM (padded to 256 words)
_NUC_PADDED = list(NUC_PROGRAM)
while len(_NUC_PADDED) < 256:
    _NUC_PADDED.append(0x00000000)
FULL_ROM = BOOT_PROGRAM + _NUC_PADDED


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
# MMIO device GT slot assignments — first available slots after boot/system
#
#   Slot 0:  NS root
#   Slot 1:  Thread Abstraction lump
#   Slot 2:  Boot.Abstr lump
#   Slots 3–6: Programmer abstractions (boot-loaded)
#   Slot 7:  LED_DEV    — 0x40000000, RW, limit=4 (5 words, one per RGB LED)
#             offset 0 = LED 0  bits[2:0]={B,G,R}  (only R drives physical pin)
#             offset 1 = LED 1  bits[2:0]={B,G,R}
#             offset 2 = LED 2  bits[2:0]={B,G,R}
#             offset 3 = LED 3  bits[2:0]={B,G,R}
#             offset 4 = LED 4  bits[2:0]={B,G,R}
#   Slot 8:  UART_DEV   — 0x40000014, RW, limit=2 (3 words: TX, STATUS, RX)
#   Slot 9:  BTN_DEV    — 0x40000028, R,  limit=0 (1 word)
#   Slot 10: TIMER_DEV  — 0x4000002C, RW, limit=4 (5 words):
#             offset 0 = TICKS_LO (R), offset 1 = TICKS_HI (R),
#             offset 2 = TOD_EPOCH (R/W), offset 3 = ALARM_CMP (R/W),
#             offset 4 = ALARM_CTL (R/W: [0]=armed, [1]=fired)
#   Slots 11–15: reserved for future device GTs
#
# Physical LED mapping (R bit = bit 0 of each word):
#   Ti60 F225 (4 LEDs active-HIGH):
#     offset 0→led0, 1→led1, 2→led2, 3→led3; offset 4 = register-only (no pin)
#   Tang Nano 20K (6 LEDs active-LOW, led3 pin absent):
#     offset 0→led0, 1→led1, 2→led2, 3→led4, 4→led5; led3 pin not connected
# ---------------------------------------------------------------------------
MMIO_LED_SLOT   = 7
MMIO_UART_SLOT  = 8
MMIO_BTN_SLOT   = 9
MMIO_TIMER_SLOT = 10

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
# DEMO_NAMESPACE — stub NS table entries (16 slots) used during simulation
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
#   Slot 0: NS root (location=NS_TABLE_BASE, limit encodes full physical space)
#   Slot 1: Thread Abstraction lump (base = 1 × 0x100 = 0x0100)
#   Slot 2: Boot.Abstr lump      (base = 2 × 0x100 = 0x0200)
#   Slots 3–6: Programmer-uploaded abstractions
#   Slots 7–10: MMIO device GTs (LED, UART, BTN, TIMER)  ← set by boot namespace
#   Slots 11–15: reserved
# ---------------------------------------------------------------------------
DEMO_NAMESPACE = []
for _i in range(16):
    if _i in _MMIO_ENTRIES:
        _loc, _sz, _gtype, _perms = _MMIO_ENTRIES[_i]
        _entry = _make_ns_entry(_gtype, _perms, _i, 0, _loc, _sz)
    else:
        _location = NS_TABLE_BASE if _i == 0 else _i * 0x100
        _alloc_size = 64  # FPGA min: 64 words per spec; demo uses 8 in simulation
        _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, 0,
                                _location, _alloc_size)
    DEMO_NAMESPACE.extend(_entry)


# ---------------------------------------------------------------------------
# DEMO_CLIST — initial C-List for the boot abstraction (Slot 2)
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Full Secure Boot CLOOMC Listing"
#   idx 0: make_gt(Inform, R|X, slot_id=3, gt_seq=0)         — code/constants read+exec GT
#   idx 1: make_gt(Inform, X,   slot_id=4, gt_seq=0)         — Boot code exec-only GT
#   idx 2: make_gt(NULL,   0,   0,         0)                 — empty; filled by SAVE epilogue (Thread GT)
#   idx 3: make_gt(Inform, E,   slot_id=2, gt_seq=0)         — Boot.Abstr E-GT (return channel)
#   idx 4: make_gt(Inform, E,   slot_id=5, gt_seq=0)         — secondary abstraction E-GT
#   idx 5: make_gt(Inform, L,   slot_id=6, gt_seq=0)         — C-List L-GT (for BIND)
#   idx 6: make_gt(Inform, E,   slot_id=4, gt_seq=0)         — first user abstraction E-GT ← B:04
#   idx 7: make_gt(NULL,   0,   0,         0)                 — reserved
#   idx 8: make_gt(Inform, R|W, slot_id=7, b_flag=1)         — LED_DEV  (MMIO, bindable)
#   idx 9: make_gt(Inform, R|W, slot_id=8, b_flag=1)         — UART_DEV (MMIO, bindable)
#   idx10: make_gt(Inform, R,   slot_id=9, b_flag=1)         — BTN_DEV  (MMIO, bindable)
#   idx11: make_gt(Inform, R|W, slot_id=10,b_flag=1)         — TIMER_DEV(MMIO, bindable)
#
# b_flag=1 marks each IO device GT as IDE-bound to a physical peripheral.  The flag is
# excluded from the CRC seal input so the runtime can clear it on un-bind without
# recomputing the NS entry.
# ---------------------------------------------------------------------------
DEMO_CLIST = [
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, 3, 0),        # idx 0: code/constants R|X, Slot 3
    make_gt(GT_TYPE_INFORM, PERM_MASK_X, 4, 0),                       # idx 1: Boot code X-only, Slot 4
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                    # idx 2: empty → Thread GT after SAVE
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 2, 0),                       # idx 3: Boot.Abstr E-GT, Slot 2
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 5, 0),                       # idx 4: secondary abstraction E, Slot 5
    make_gt(GT_TYPE_INFORM, PERM_MASK_L, 6, 0),                       # idx 5: C-List L-GT, Slot 6
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 4, 0),                       # idx 6: first user E-GT, Slot 4 (B:04)
    make_gt(GT_TYPE_NULL, 0, 0, 0),                                    # idx 7: reserved
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_LED_SLOT,   0, b_flag=1),  # idx 8:  LED_DEV
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_UART_SLOT,  0, b_flag=1),  # idx 9:  UART_DEV
    make_gt(GT_TYPE_INFORM, PERM_MASK_R,                MMIO_BTN_SLOT,   0, b_flag=1),  # idx 10: BTN_DEV
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, MMIO_TIMER_SLOT, 0, b_flag=1),  # idx 11: TIMER_DEV
]

while len(DEMO_CLIST) < 64:
    DEMO_CLIST.append(0)


class BootRom(Elaboratable):
    """Instruction ROM for Church Machine boot and demo program.

    Uses Array constants for reliable iCE40 initialization.
    Only non-zero entries are stored; default is 0.
    Registered output maintains 1-cycle read latency matching original BRAM behavior.

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js
    The BOOT_PROGRAM words above correspond 1-to-1 with the annotated CLOOMC
    listing in the "Full Secure Boot CLOOMC Listing" and "Boot ROM Cross-Reference"
    slides of the Secure Boot tutorial in the IDE (Tutorial → Secure Boot).
    """

    def __init__(self, program=None):
        if program is None:
            program = BOOT_PROGRAM
        self.program = program[:512]
        while len(self.program) < 512:
            self.program.append(0)

        self.addr = Signal(9)
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
