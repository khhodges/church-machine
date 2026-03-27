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
GT_TYPE_REAL     = 0b01
GT_TYPE_ABSTRACT = 0b10
GT_TYPE_RSV      = 0b11

NUM_CAP_REGS = 16
NUM_DATA_REGS = 16

CR_HEAP      = 5
CR_CLIST     = 6
CR_CLOOMC    = 7
CR_THREAD    = 12
CR_INTERRUPT = 9
CR_DFAULT    = 10
CR_NAMESPACE = 15

GT_SEQ_BITS     = 7
GT_SLOT_ID_BITS = 16
GT_PERM_BITS    = 6
GT_TYPE_BITS    = 2
GT_WIDTH        = 32

CR_WIDTH        = 128
WORD_WIDTH      = 32
SEAL_BITS       = 16

MAX_NS_ENTRIES  = 1 << GT_SLOT_ID_BITS
MAX_GT_SEQ      = (1 << GT_SEQ_BITS) - 1

NS_LIMIT_MASK  = (1 << GT_SLOT_ID_BITS) - 1

NS_TABLE_BASE  = 0xFD00

ENABLE_SEAL_CHECK = True
ENABLE_FUSED_OPS = True
ENABLE_CHANGE_SWITCH = True
ENABLE_GC = True

CRC16_POLY    = 0x1021
CRC16_INIT    = 0xFFFF
CRC_SEAL_MASK = (1 << SEAL_BITS) - 1


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
    LE    = 10
    SE    = 11
    LSE   = 12
    RWXLSE = 13
    RSV0   = 14
    RSV1   = 15


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
    TpermPreset.LE:    PERM_MASK_L | PERM_MASK_E,
    TpermPreset.SE:    PERM_MASK_S | PERM_MASK_E,
    TpermPreset.LSE:   PERM_MASK_L | PERM_MASK_S | PERM_MASK_E,
    TpermPreset.RWXLSE: PERM_MASK_R | PERM_MASK_W | PERM_MASK_X | PERM_MASK_L | PERM_MASK_S | PERM_MASK_E,
    TpermPreset.RSV0:  0x00,
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
    STACK_OVERFLOW  = 0x10   # CALL stack depth exceeded IDE-defined limit
    ABSENT_OUTFORM  = 0x11   # mLoad: outform absent — SW trap downloads code, reissues CALL


class BootState(IntEnum):
    IDLE       = 0
    FAULT_RST  = 1
    LOAD_NS    = 2
    INIT_THRD  = 3
    INIT_CLIST = 4
    LOAD_NUC   = 5
    COMPLETE   = 6
