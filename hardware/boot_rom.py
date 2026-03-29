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


def make_gt(gt_type=GT_TYPE_NULL, perms=0, slot_id=0, gt_seq=0):
    """Encode a 32-bit Golden Token word.

    GT Word 0 field layout (current — matches CLOOMC listing in secure_boot_tutorial.js):
      [15:0]  slot_id   — 16-bit namespace slot index
      [22:16] gt_seq    — 7-bit revocation counter (must match NS entry word2[31:25])
      [24:23] gt_type   — 00=NULL  01=Inform (GT_TYPE_INFORM)  10=Outform (GT_TYPE_OUTFORM)  11=Abstract (GT_TYPE_ABSTRACT)
      [30:25] perms     — R W X L S E (one bit each, LSB=R)
      [31]    b_flag    — bindable override (set by IDE; excluded from CRC seal input)

    CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Secure Boot — Overview"
    """
    return (perms << 25) | (gt_type << 23) | (gt_seq << 16) | slot_id


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
    #   CR14 derived from NS Slot 4: base=word0_location, limit=word1[16:0], perm=XR
    #   CR6  derived from NS Slot 4: base=clistStart, limit=clistCount-1, perm=L
    #   2-word CALL frame pushed onto thread LIFO stack (STO += 2)
    #   PC = 0 — user abstraction begins executing
    encode_church(ChurchOpcode.CALL, CondCode.AL, cr_dst=0, cr_src=0),

    # Epilogue (after user RETURN) — reload Boot.Abstr code GT
    # CLOOMC: LOAD AL, CR7, CR6[1]
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=7, cr_src=6, imm=1),

    # Epilogue — restrict CR7 to X permission only
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
# DEMO_NAMESPACE — stub NS table entries (16 slots) used during simulation
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Boot ROM Cross-Reference"
#   Slot 0: NS root (location=NS_TABLE_BASE, limit encodes full physical space)
#   Slot 1: Thread Abstraction lump (base = 1 × 0x100 = 0x0100)
#   Slot 2: Boot.Abstr lump      (base = 2 × 0x100 = 0x0200)
#   Slot 3+: Programmer-uploaded abstractions
# ---------------------------------------------------------------------------
DEMO_NAMESPACE = []
for _i in range(16):
    _location = NS_TABLE_BASE if _i == 0 else _i * 0x100
    _alloc_size = 64  # FPGA minimum: 2^6 = 64 words per spec. Demo uses 8 words in simulation.
    _gt_seq = 0
    _entry = _make_ns_entry(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, _i, _gt_seq,
                            _location, _alloc_size)
    DEMO_NAMESPACE.extend(_entry)


# ---------------------------------------------------------------------------
# DEMO_CLIST — initial C-List for the boot abstraction (Slot 2)
#
# CLOOMC listing cross-ref: simulator/secure_boot_tutorial.js §"Full Secure Boot CLOOMC Listing"
#   idx 0: make_gt(Real, R|X, slot_id=3, gt_seq=0) — code/constants read+exec GT
#   idx 1: make_gt(Real, X,   slot_id=4, gt_seq=0) — Boot code exec-only GT
#   idx 2: make_gt(Null, 0,   0,         0)         — empty; filled by SAVE epilogue (Thread GT)
#   idx 3: make_gt(Real, E,   slot_id=2, gt_seq=0) — Boot.Abstr E-GT (return channel)
#   idx 4: make_gt(Real, E,   slot_id=5, gt_seq=0) — secondary abstraction E-GT
#   idx 5: make_gt(Real, L,   slot_id=6, gt_seq=0) — C-List L-GT (for BIND)
#   idx 6: make_gt(Real, E,   slot_id=4, gt_seq=0) — first user abstraction E-GT  ← B:04 LOAD_NUC
#   idx 7: make_gt(Null, 0,   0,         0)         — reserved
# ---------------------------------------------------------------------------
DEMO_CLIST = [
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, 3, 0),  # idx 0: code/constants R|X, Slot 3
    make_gt(GT_TYPE_INFORM, PERM_MASK_X, 4, 0),                 # idx 1: Boot code X-only, Slot 4
    make_gt(GT_TYPE_NULL, 0, 0, 0),                           # idx 2: empty → Thread GT after SAVE
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 2, 0),                 # idx 3: Boot.Abstr E-GT, Slot 2
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 5, 0),                 # idx 4: secondary abstraction E, Slot 5
    make_gt(GT_TYPE_INFORM, PERM_MASK_L, 6, 0),                 # idx 5: C-List L-GT, Slot 6
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 4, 0),                 # idx 6: first user E-GT, Slot 4 (B:04)
    make_gt(GT_TYPE_NULL, 0, 0, 0),                           # idx 7: reserved
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
