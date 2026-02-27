from amaranth import *

from .types import *


def encode_church(opcode, cond=CondCode.AL, cr_dst=0, cr_src=0, imm=0):
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23) | \
           ((cr_dst & 0xF) << 19) | ((cr_src & 0xF) << 15) | (imm & 0x7FFF)


def make_gt(gt_type=GT_TYPE_NULL, perms=0, index=0, version=0):
    return (version << 25) | (index << 8) | (perms << 2) | gt_type


BOOT_PROGRAM = [
    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=1, cr_src=6, imm=0),

    encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=2, cr_src=6, imm=1),

    encode_church(ChurchOpcode.TPERM, CondCode.AL, cr_dst=2, imm=TpermPreset.X),

    encode_church(ChurchOpcode.LAMBDA, CondCode.AL, cr_dst=2),

    encode_church(ChurchOpcode.ELOADCALL, CondCode.AL, cr_dst=0, cr_src=6, imm=1),

    encode_church(ChurchOpcode.XLOADLAMBDA, CondCode.AL, cr_dst=7, cr_src=6, imm=1),

    encode_church(ChurchOpcode.RETURN, CondCode.AL, cr_src=5),

    encode_church(ChurchOpcode.SAVE, CondCode.AL, cr_dst=6, cr_src=1, imm=2),

    encode_church(ChurchOpcode.SWITCH, CondCode.AL, cr_dst=0, cr_src=0, imm=1),

    encode_church(ChurchOpcode.CHANGE, CondCode.AL, cr_dst=0, cr_src=2, imm=0),
]

while len(BOOT_PROGRAM) < 256:
    BOOT_PROGRAM.append(0x00000000)


DEMO_NAMESPACE = []
for i in range(16):
    location = i * 0x100
    limit = 0x80000000 | 8
    seal_word = (0 << 25) | (0 & FNV_SEAL_MASK)
    DEMO_NAMESPACE.extend([location, limit, seal_word])


DEMO_CLIST = [
    make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, 4, 0),
    make_gt(GT_TYPE_INFORM, PERM_MASK_X | PERM_MASK_E, 5, 0),
    make_gt(GT_TYPE_NULL, 0, 0, 0),
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 3, 0),
    make_gt(GT_TYPE_INFORM, PERM_MASK_E, 6, 0),
    make_gt(GT_TYPE_INFORM, PERM_MASK_L, 7, 0),
    make_gt(GT_TYPE_NULL, 0, 0, 0),
    make_gt(GT_TYPE_NULL, 0, 0, 0),
]

while len(DEMO_CLIST) < 64:
    DEMO_CLIST.append(0)


class BootRom(Elaboratable):
    """Instruction ROM for Church Machine boot and demo program.

    512 x 32-bit words = 2KB. Fits in a single iCE40 EBR block.
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

        rom = Memory(width=32, depth=512, init=self.program)
        m.submodules.rom = rom
        rd = rom.read_port()

        m.d.comb += [
            rd.addr.eq(self.addr),
            self.data.eq(rd.data),
        ]

        return m
