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

PERM_M = 6
PERM_MASK_M = 1 << PERM_M

DATA_PERMS = PERM_MASK_R | PERM_MASK_W | PERM_MASK_X
CAP_PERMS  = PERM_MASK_L | PERM_MASK_S | PERM_MASK_E

GT_TYPE_INFORM   = 0b00
GT_TYPE_OUTFORM  = 0b01
GT_TYPE_NULL     = 0b10
GT_TYPE_ABSTRACT = 0b11

NUM_CAP_REGS = 16
NUM_DATA_REGS = 32

CR_CLIST     = 6
CR_CLOOMC    = 7
CR_THREAD    = 8
CR_INTERRUPT = 9
CR_DFAULT    = 10
CR_NAMESPACE = 15

GT_VERSION_BITS = 7
GT_INDEX_BITS   = 17
GT_PERM_BITS    = 6
GT_TYPE_BITS    = 2
GT_WIDTH        = 32

CR_WIDTH        = 128
WORD_WIDTH      = 32
SEAL_BITS       = 25

MAX_NS_ENTRIES  = 1 << GT_INDEX_BITS
MAX_GT_VERSION  = (1 << GT_VERSION_BITS) - 1

NS_FLAG_B_BIT = 31
NS_FLAG_F_BIT = 30
NS_FLAG_B_MASK = 1 << NS_FLAG_B_BIT
NS_FLAG_F_MASK = 1 << NS_FLAG_F_BIT
NS_LIMIT_MASK  = (1 << GT_INDEX_BITS) - 1

FNV_OFFSET_32 = 0x811c9dc5
FNV_PRIME_32  = 0x01000193
FNV_SEAL_MASK = (1 << SEAL_BITS) - 1


class CTMMOpcode(IntEnum):
    LUI    = 0b0110111
    AUIPC  = 0b0010111
    JAL    = 0b1101111
    JALR   = 0b1100111
    BRANCH = 0b1100011
    LOAD   = 0b0000011
    STORE  = 0b0100011
    ARITHI = 0b0010011
    ARITH  = 0b0110011
    FENCE  = 0b0001111
    SYSTEM = 0b1110011


class CTMMFunct3Branch(IntEnum):
    BEQ  = 0b000
    BNE  = 0b001
    BLT  = 0b100
    BGE  = 0b101
    BLTU = 0b110
    BGEU = 0b111


class CTMMFunct3Load(IntEnum):
    LB  = 0b000
    LH  = 0b001
    LW  = 0b010
    LBU = 0b100
    LHU = 0b101


class CTMMFunct3Store(IntEnum):
    SB = 0b000
    SH = 0b001
    SW = 0b010


class CTMMFunct3ArithI(IntEnum):
    ADDI  = 0b000
    SLTI  = 0b010
    SLTIU = 0b011
    XORI  = 0b100
    ORI   = 0b110
    ANDI  = 0b111
    SLLI  = 0b001
    SRLI  = 0b101


class CTMMFunct3Arith(IntEnum):
    ADD  = 0b000
    SLL  = 0b001
    SLT  = 0b010
    SLTU = 0b011
    XOR  = 0b100
    SRL  = 0b101
    OR   = 0b110
    AND  = 0b111


class ChurchOpcode(IntEnum):
    LOAD    = 0b0000
    SAVE    = 0b0001
    CALL    = 0b0010
    RETURN  = 0b0011
    CHANGE  = 0b0100
    SWITCH  = 0b0101
    TPERM   = 0b0110
    LAMBDA  = 0b0111


CHURCH_CUSTOM0 = 0b0001011


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
    RSV0  = 13
    RSV1  = 14
    RSV2  = 15


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
    TpermPreset.RSV0:  0x00,
    TpermPreset.RSV1:  0x00,
    TpermPreset.RSV2:  0x00,
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


class BootState(IntEnum):
    IDLE       = 0
    FAULT_RST  = 1
    LOAD_NS    = 2
    INIT_THRD  = 3
    LOAD_NUC   = 4
    COMPLETE   = 5
