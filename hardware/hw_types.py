from enum import IntEnum

PERM_R = 0
PERM_W = 1
PERM_X = 2
PERM_L = 3
PERM_S = 4
PERM_E = 5

PERM_MASK_R = 1 << PERM_R
PERM_MASK_W = 1 << PERM_W
PERM_MASK_X = 1 << PERM_X
PERM_MASK_L = 1 << PERM_L
PERM_MASK_S = 1 << PERM_S
PERM_MASK_E = 1 << PERM_E

DATA_PERMS = PERM_MASK_R | PERM_MASK_W | PERM_MASK_X
CAP_PERMS  = PERM_MASK_L | PERM_MASK_S | PERM_MASK_E

GT_TYPE_NULL     = 0b00
GT_TYPE_INFORM   = 0b01
GT_TYPE_OUTFORM  = 0b10
GT_TYPE_ABSTRACT = 0b11

NUM_CAP_REGS = 16
NUM_DATA_REGS = 16

CR_HEAP         = 5
CR_CLIST        = 6
CR_NUCLEUS      = 7
CR_THREAD_STACK = 12   # CR12: thread stack capability (canonical name)
CR_INTERRUPT    = 13
CR_CLOOMC       = 14   # CR14: code register / CLOOMC (canonical name)
CR_NAMESPACE    = 15

GT_SEQ_BITS     = 9
GT_SLOT_ID_BITS = 16
GT_PERM_BITS    = 4    # dom(1) + perm[2:0](3) — was 6; compressed via Turing/Church mutual exclusion
GT_TYPE_BITS    = 2
GT_WIDTH        = 32

GT_TYPE_SHIFT   = 25   # bit position of gt_type[26:25] in GT word
GT_DOM_BIT      = 27   # bit position of dom   in GT word


def gt_encode_perm(perms_mask: int) -> tuple:
    """Encode 6-bit logical perms_mask → (dom: int, perm3: int) for the new GT_LAYOUT.

    perms_mask bit indices: R=0, W=1, X=2, L=3, S=4, E=5 (PERM_MASK_* constants).
    Returns (dom, perm3) where dom=0 means Turing {X,W,R}, dom=1 means Church {E,S,L}.
    Church bits take priority if any are set (domain-purity is caller's responsibility).
    """
    R = (perms_mask >> PERM_R) & 1
    W = (perms_mask >> PERM_W) & 1
    X = (perms_mask >> PERM_X) & 1
    L = (perms_mask >> PERM_L) & 1
    S = (perms_mask >> PERM_S) & 1
    E = (perms_mask >> PERM_E) & 1
    if L or S or E:
        return 1, (E << 2) | (S << 1) | L
    else:
        return 0, (X << 2) | (W << 1) | R


def gt_decode_perm(dom: int, perm3: int) -> int:
    """Decode (dom, perm3) back to the 6-bit logical perms_mask used by PERM_MASK_* constants."""
    if dom:
        L = (perm3 >> 0) & 1
        S = (perm3 >> 1) & 1
        E = (perm3 >> 2) & 1
        return (L << PERM_L) | (S << PERM_S) | (E << PERM_E)
    else:
        R = (perm3 >> 0) & 1
        W = (perm3 >> 1) & 1
        X = (perm3 >> 2) & 1
        return (R << PERM_R) | (W << PERM_W) | (X << PERM_X)


def make_gt(gt_type=GT_TYPE_NULL, perms=0, slot_id=0, gt_seq=0, b_flag=0):
    """Encode a 32-bit Golden Token word using the v2.0 dom+perm[2:0] format.

    GT Word 0 field layout (v2.0):
      [15:0]  slot_id   — 16-bit namespace slot index
      [24:16] gt_seq    — 9-bit revocation counter
      [26:25] gt_type   — 00=NULL  01=Inform  10=Outform  11=Abstract
      [27]    dom       — 0=Turing {X,W,R}, 1=Church {E,S,L}
      [30:28] perm      — 3-bit payload (dom=0: X/W/R; dom=1: E/S/L)
      [31]    b_flag    — bindable override (IO devices)

    perms: 6-bit logical mask using PERM_MASK_* constants.
    """
    dom, perm3 = gt_encode_perm(perms)
    return (b_flag << 31) | (perm3 << 28) | (dom << 27) | \
           (gt_type << 25) | (gt_seq << 16) | slot_id


CR_WIDTH        = 96
WORD_WIDTH      = 32

MAX_NS_ENTRIES  = 1 << GT_SLOT_ID_BITS
MAX_GT_SEQ      = (1 << GT_SEQ_BITS) - 1

NS_LIMIT_MASK  = (1 << GT_SLOT_ID_BITS) - 1

NS_TABLE_BASE  = 0xFD00

FNV_OFFSET_32 = 0x811c9dc5
FNV_PRIME_32  = 0x01000193
FNV_SEAL_MASK = (1 << 25) - 1

ENABLE_SEAL_CHECK = True
ENABLE_FUSED_OPS = True
ENABLE_CHANGE_SWITCH = True
ENABLE_GC = True

# ---------------------------------------------------------------------------
# Church Hardware Address Range — 0xFFFFFF00 to 0xFFFFFFFF
#
# A unified 256-address region that governs privileged CR register access
# and I/O device ports through capability-based authority.  Possessing a
# capability whose address covers a port is the sole authority to access it.
# ---------------------------------------------------------------------------
CHURCH_HW_RANGE_BASE = 0xFFFFFF00
CHURCH_HW_RANGE_END  = 0xFFFFFFFF

# Segment 1 — CR Ports (0xFFFFFF00–0xFFFFFF0F)
# L-perm → authority to load from that CR.
# S-perm → authority to CHANGE (store to) that CR.
CR_PORT_BASE = 0xFFFFFF00
CR_PORT_CR12 = 0xFFFFFF0C   # thread stack         (system-wide)
CR_PORT_CR13 = 0xFFFFFF0D   # interrupt handler    (system-wide)
CR_PORT_CR14 = 0xFFFFFF0E   # code register        (per-thread)
CR_PORT_CR15 = 0xFFFFFF0F   # namespace root       (per-thread)

# Segment 2 — M Bit Ports (0xFFFFFF10–0xFFFFFF1F)
# S-perm → authority to set the M bit on a GT installed into that CR.
M_BIT_PORT_BASE = 0xFFFFFF10
M_BIT_PORT_CR12 = 0xFFFFFF1C
M_BIT_PORT_CR13 = 0xFFFFFF1D
M_BIT_PORT_CR14 = 0xFFFFFF1E
M_BIT_PORT_CR15 = 0xFFFFFF1F

# Segment 3 — I/O Device Ports (0xFFFFFF20–0xFFFFFFEE)
# R-perm → read register.  W-perm → write register.
IO_PORT_BASE            = 0xFFFFFF20
IO_PORT_UART_TX         = 0xFFFFFF20
IO_PORT_UART_STATUS     = 0xFFFFFF21
IO_PORT_UART_RX         = 0xFFFFFF22
IO_PORT_LED0            = 0xFFFFFF23
IO_PORT_LED1            = 0xFFFFFF24
IO_PORT_LED2            = 0xFFFFFF25
IO_PORT_LED3            = 0xFFFFFF26
IO_PORT_LED4            = 0xFFFFFF27
IO_PORT_LED5            = 0xFFFFFF28
IO_PORT_BUTTON          = 0xFFFFFF29
IO_PORT_TIMER_TICKS_LO  = 0xFFFFFF2A
IO_PORT_TIMER_TICKS_HI  = 0xFFFFFF2B
IO_PORT_TIMER_TOD_EPOCH = 0xFFFFFF2C
IO_PORT_TIMER_ALARM_CMP = 0xFFFFFF2D
IO_PORT_TIMER_CTL       = 0xFFFFFF2E
IO_PORT_DISP_DMA_SRC_LO = 0xFFFFFF2F
IO_PORT_DISP_DMA_SRC_HI = 0xFFFFFF30
IO_PORT_DISP_DMA_LEN    = 0xFFFFFF31
IO_PORT_DISP_DMA_CTL    = 0xFFFFFF32
IO_PORT_DISP_CMD        = 0xFFFFFF33
IO_PORT_TOUCH_X         = 0xFFFFFF34
IO_PORT_TOUCH_Y         = 0xFFFFFF35
IO_PORT_TOUCH_Z         = 0xFFFFFF36   # pressure
IO_PORT_TOUCH_STATUS    = 0xFFFFFF37
IO_PORT_PET_NAME_WR     = 0xFFFFFF38   # write slot-index N → mark c-list slot N as named
IO_PORT_NEXT            = 0xFFFFFF39   # next unallocated I/O port

# Segment 4 — Existing Sentinels (0xFFFFFFEF–0xFFFFFFFF)
# Reserved hardware sentinel addresses used in word1_location of SWITCH PassKeys.
# These values occupy the I/O peripheral address space — a range no real RAM
# lump base address can occupy — ensuring no ambiguity with live capabilities.
#   0xFFFFFFFF  (all-1s)      →  PassKey for CR15 (Namespace)
#   0xFFFFFFFE  (all-1s − 1)  →  PassKey for CR13 (IRQ Thread)
SWITCH_PASSKEY_SENTINEL_CR15 = 0xFFFFFFFF
SWITCH_PASSKEY_SENTINEL_CR13 = 0xFFFFFFFE

# SWITCH Tgt field values — the 3-bit field maps to CR8 + Tgt.
# Only these two are valid SWITCH targets; all others produce INVALID_OP.
SWITCH_TGT_CR13 = 5   # 101₂  →  CR13  (IRQ Thread)
SWITCH_TGT_CR15 = 7   # 111₂  →  CR15  (Namespace)

# ── Hardware IRQ dispatch — Task #1523 ───────────────────────────────────────
# Three conditions route to Scheduler.IRQ (NS slot 8) via ChurchIRQDispatch.
# DR0 = reason code; DR1 = associated slot index when the IRQ fires.
SCHEDULER_IRQ_NS_SLOT   = 8   # NS slot of the Scheduler.IRQ abstraction
IRQ_REASON_TIMER        = 0   # hardware timer alarm fired between instructions
IRQ_REASON_LAZY_LOAD    = 1   # lump header cw=0 (CODE_NOT_RESIDENT) in CALL pipeline
IRQ_REASON_LAZY_RESOLVE = 2   # NULL GT in c-list slot (ELOADCALL / XLOADLAMBDA)

# ---------------------------------------------------------------------------
# Boot image NS slot assignments — SINGLE SOURCE OF TRUTH for boot slot indices.
# These constants exist only so the boot image layer (hardware/boot_rom.py,
# server/boot_image.py) can build the binary.  They must not be imported by
# runtime JS or general server code.  JS resolves slot names at runtime via
# sim._slotByPetName() / sim.nsLabels.
# ---------------------------------------------------------------------------
SELFTEST_NS_SLOT             = 6    # SelfTest (boot entry point; minimal boot namespace)
BOOT_ABSTR_NS_SLOT           = SELFTEST_NS_SLOT   # alias: canonical boot-entry slot
TUNNEL_NS_SLOT               = 22   # Tunnel (call-home I/O channel)
SLIDERULE_SLOT               = 8    # SlideRule (Layer 3 Mathematics abstraction)
CONSTANTS_SLOT               = 9    # Constants (Layer 3 read-only)
MMIO_UART_SLOT               = 2    # UART device (MMIO 0x40000014)
MMIO_LED_SLOT                = 3    # LED device  (MMIO 0x40000000)
MMIO_BTN_SLOT                = 4    # Button device (MMIO 0x40000028)
MMIO_TIMER_SLOT              = 5    # Timer device  (MMIO 0x4000002C)
# Church HW Range NS slots 19-22 removed — authority now encoded as a
# pre-baked Abstract S-perm GT (type=0b11, dom=1, perm3=0b010 → 0x2E000000).
# No NS entries are needed; the token carries the authority directly.
SCHEDULER_NS_SLOT            = SCHEDULER_IRQ_NS_SLOT   # hardware-hardwired to slot 8 (ChurchIRQDispatch); NS table no longer has Scheduler there
SCHEDULER_IRQ_THREAD_NS_SLOT = 41   # Scheduler.IRQ.Thread (fixed boot-image IRQ thread)


class ChurchOpcode(IntEnum):
    LOAD        = 0b0000
    SAVE        = 0b0001
    CALL        = 0b0010
    RETURN      = 0b0011
    CHANGE      = 0b0100
    SWITCH      = 0b0101
    TPERM       = 0b0110
    LAMBDA      = 0b0111
    ELOADCALL   = 0b1000
    XLOADLAMBDA = 0b1001


NUM_CHURCH_OPCODES = 10


class TuringOpcode(IntEnum):
    DREAD       = 0b10000
    DWRITE      = 0b10001
    BFEXT       = 0b10010
    BFINS       = 0b10011
    MCMP        = 0b10100
    IADD        = 0b10101
    ISUB        = 0b10110
    BRANCH      = 0b10111
    SHL         = 0b11000
    SHR         = 0b11001


NUM_TURING_OPCODES = 10
NUM_TOTAL_OPCODES = NUM_CHURCH_OPCODES + NUM_TURING_OPCODES


# Opcodes 0b10110–0b11101 (26–29) are reserved for future instructions
# (e.g. floating-point).  0x1E is the last slot before the lump-header magic.
OPCODE_WORD = 0b11110   # = 0x1E = 30 — inline data constant; INVALID_OP if executed


class CondCode(IntEnum):
    EQ = 0b0000
    NE = 0b0001
    CS = 0b0010
    CC = 0b0011
    MI = 0b0100
    PL = 0b0101
    VS = 0b0110
    VC = 0b0111
    HI = 0b1000
    LS = 0b1001
    GE = 0b1010
    LT = 0b1011
    GT = 0b1100
    LE = 0b1101
    AL = 0b1110
    NV = 0b1111


class TpermPreset(IntEnum):
    CLEAR = 0
    R     = 1
    RW    = 2
    X     = 3
    RX    = 4
    RWX   = 5
    L     = 6
    S     = 7
    E     = 8
    LS    = 9
    RSV3  = 10
    RSV4  = 11
    RSV5  = 12
    FRAME = 13   # Call-stack query: Z=1 if a real return frame exists (RETURN would not underflow). No GT read.
    EXACT = 14   # Credential identity check: CRd word0 == CRs word0 (all 32 bits); faults BIND if not equal.
    RSV1  = 15


TPERM_MASKS = {
    TpermPreset.CLEAR: 0x00,
    TpermPreset.R:     PERM_MASK_R,
    TpermPreset.RW:    PERM_MASK_R | PERM_MASK_W,
    TpermPreset.X:     PERM_MASK_X,
    TpermPreset.RX:    PERM_MASK_R | PERM_MASK_X,
    TpermPreset.RWX:   PERM_MASK_R | PERM_MASK_W | PERM_MASK_X,
    TpermPreset.L:     PERM_MASK_L,
    TpermPreset.S:     PERM_MASK_S,
    TpermPreset.E:     PERM_MASK_E,
    TpermPreset.LS:    PERM_MASK_L | PERM_MASK_S,
    TpermPreset.RSV3:  0x00,
    TpermPreset.RSV4:  0x00,
    TpermPreset.RSV5:  0x00,
    TpermPreset.FRAME: None,   # FRAME is a call-stack query, not a permission preset
    TpermPreset.EXACT: None,   # EXACT is a comparison, not a restriction preset
    TpermPreset.RSV1:  0x00,
}


class FaultType(IntEnum):
    NONE          = 0x0
    PERM_R        = 0x1
    PERM_W        = 0x2
    PERM_X        = 0x3
    PERM_L        = 0x4
    PERM_S        = 0x5
    PERM_E        = 0x6
    NULL_CAP      = 0x7
    BOUNDS        = 0x8
    VERSION       = 0x9
    SEAL          = 0xA
    INVALID_OP    = 0xB
    TPERM_RSV     = 0xC
    DOMAIN_PURITY = 0xD
    BIND          = 0xE
    F_BIT         = 0xF
    STACK_OVERFLOW  = 0x10   # CALL stack depth exceeded IDE-defined lower bound (sp < sp_min)
    ABSENT_OUTFORM  = 0x11   # mLoad: outform absent — SW trap downloads code, reissues CALL
    STACK_CORRUPT   = 0x12   # CALL stack pointer above sp_max (STO corrupted or header wrong)
    STACK_UNDERFLOW = 0x13   # RETURN with no caller frame — popped past sentinel (NIA=0x7FFF)
    IRQ_NULL_BASE   = 0x14   # IRQ dispatch: NS slot 8 lump base is 0 (Scheduler.IRQ not booted)
    OUTFORM_CRC     = 0x15   # Outform download: CRC-32 mismatch in received lump
    OUTFORM_ALLOC   = 0x16   # Outform download: memory allocator rejected the lump size
    OUTFORM_MINT    = 0x17   # Outform download: Mint capability-minting step failed
    OUTFORM_HDR     = 0x18   # Outform download: header validation failed (bad length/alignment)
    OUTFORM_TIMEOUT = 0x19   # Outform download: server stopped sending bytes (watchdog expired)


class BootState(IntEnum):
    IDLE       = 0
    FAULT_RST  = 1
    LOAD_NS    = 2
    INIT_THRD  = 3
    INIT_CLIST = 4
    LOAD_NUC   = 5
    COMPLETE   = 6


