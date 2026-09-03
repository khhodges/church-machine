from enum import IntEnum
from shared.architecture_contracts import (
    BOOT as ARCH_BOOT,
    GT_WORD0 as ARCH_GT,
    PROFILES as ARCH_PROFILES,
    field_lsb as _arch_lsb,
    field_width as _arch_width,
)

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

# Wukong's UART uploader replaces its complete 16K-word DMEM image. The
# forward Namespace table owns words 0..255 and the fixed factory image owns
# words through 1279. The physical board keeps Thread.1 plus two uploaded
# generated Thread contexts (slots 11 and 12); no dedicated hardware scheduler
# or post-boot LUMP store is allocated for additional slots.
_WUKONG_PROFILE = ARCH_PROFILES["wukong-uart-upload-v2"]
WUKONG_DMEM_WORDS = _WUKONG_PROFILE["totalWords"]
WUKONG_FORWARD_NS_SLOTS = _WUKONG_PROFILE["namespace"]["slots"]
WUKONG_UPLOAD_BODY_BASE_WORD = _WUKONG_PROFILE["uploadBodyBaseWord"]
WUKONG_PHYSICAL_MAX_THREAD_COUNT = _WUKONG_PROFILE["maxThreadCount"]

CR_HEAP         = 5
CR_CLIST        = 6
CR_NUCLEUS      = 7
CR_THREAD_STACK = 12   # CR12: thread stack capability (canonical name)
CR_INTERRUPT    = 13
CR_CLOOMC       = 14   # CR14: code register / CLOOMC (canonical name)
CR_NAMESPACE    = 15

# Protected CR14 execution identity allowed to operate Namespace's private
# M-bit device capabilities.
NAMESPACE_EXEC_SLOT = 5

GT_SEQ_BITS     = _arch_width(ARCH_GT["fields"]["gt_seq"])
GT_SLOT_ID_BITS = _arch_width(ARCH_GT["fields"]["slot_id"])
GT_PERM_BITS    = 4    # dom(1) + perm[2:0](3) — was 6; compressed via Turing/Church mutual exclusion
GT_TYPE_BITS    = _arch_width(ARCH_GT["fields"]["gt_type"])
GT_WIDTH        = ARCH_GT["widthBits"]

GT_TYPE_SHIFT   = _arch_lsb(ARCH_GT["fields"]["gt_type"])
GT_DOM_BIT      = _arch_lsb(ARCH_GT["fields"]["dom"])


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

NS_TABLE_BASE  = ARCH_PROFILES["a7-legacy-v12"]["namespace"]["baseWord"]

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

# Segment 2 — M-bit I/O object (one 32-bit register).
# Bits [15:0] are the M states for CR0..CR15 respectively.  Writing a 1 sets
# that CR's M bit and writing a 0 clears it.  Bits [31:16] are reserved.
M_BIT_PORT = 0xFFFFFF1C
M_BIT_DEVICE_NS_SLOT = 13

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

# SWITCH destinations are carried in the normal 4-bit CRd field.  Keeping the
# constants as architectural CR numbers prevents the former 3-bit truncation
# (CR12/CR14 aliasing CR4/CR6).
SWITCH_TGT_CR12 = CR_THREAD_STACK
SWITCH_TGT_CR13 = CR_INTERRUPT
SWITCH_TGT_CR14 = CR_CLOOMC
SWITCH_TGT_CR15 = CR_NAMESPACE

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
SELFTEST_NS_SLOT             = ARCH_BOOT["minimalSlots"]["SelfTest"]
BOOT_ABSTR_NS_SLOT           = SELFTEST_NS_SLOT   # alias: canonical boot-entry slot
TUNNEL_NS_SLOT               = 22   # Tunnel (call-home I/O channel)
SLIDERULE_SLOT               = 8    # SlideRule (Layer 3 Mathematics abstraction)
CONSTANTS_SLOT               = 9    # Constants (Layer 3 read-only)
MMIO_UART_SLOT               = ARCH_BOOT["minimalSlots"]["UART_DEV"]
MMIO_LED_SLOT                = ARCH_BOOT["minimalSlots"]["LED_DEV"]
MMIO_BTN_SLOT                = ARCH_BOOT["minimalSlots"]["BTN_DEV"]
MMIO_TIMER_SLOT              = ARCH_BOOT["minimalSlots"]["TIMER_DEV"]
MMIO_M_BIT_SLOT              = M_BIT_DEVICE_NS_SLOT
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
    OUTFORM_UNAUTH  = 0x1A   # Outform ingress fault-closed (Task #2862): unauthenticated
                             #   direct network Outform promotion is refused before any
                             #   allocation or NS/c-list publication.  CRC-32 / integrity32(T)
                             #   are integrity codes, NOT authentication, and no trusted
                             #   externally-authenticated Mint identity/hash input exists to
                             #   authorise minting attacker-controlled network payload into a
                             #   resident capability.  Re-enabling network promotion REQUIRES
                             #   adding such an authenticated Mint input — see hardware/mload.py
                             #   FETCH_GT and hardware/church_outform.py.
    IMMUTABLE_SELF_CAP = 0x1B  # SAVE: c-list row 0 is the immutable self capability
    STRUCTURAL_REG = 0x1C      # LOAD: machine-owned structural register target


class BootState(IntEnum):
    IDLE       = 0
    FAULT_RST  = 1
    LOAD_NS    = 2
    INIT_THRD  = 3
    INIT_CLIST = 4
    LOAD_NUC   = 5
    COMPLETE   = 6


