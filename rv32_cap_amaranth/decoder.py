from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import COND_FLAGS_LAYOUT


class CTMMCapDecoder(Elaboratable):
    def __init__(self):
        self.instruction = Signal(32)
        self.instr_valid = Signal()

        self.ctmm_opcode = Signal(7)
        self.rd = Signal(5)
        self.rs1 = Signal(5)
        self.rs2 = Signal(5)
        self.funct3 = Signal(3)
        self.funct7 = Signal(7)
        self.imm_i = Signal(signed(12))
        self.imm_s = Signal(signed(12))
        self.imm_b = Signal(signed(13))
        self.imm_u = Signal(signed(32))
        self.imm_j = Signal(signed(21))

        self.is_ctmm_op = Signal()
        self.is_church_op = Signal()
        self.church_op = Signal(3)
        self.cr_dst = Signal(4)
        self.cr_src = Signal(4)
        self.cap_index = Signal(12)
        self.tperm_preset = Signal(4)
        self.call_mask = Signal(12)
        self.switch_target = Signal(4)

        self.fault = Signal(4)
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        instr = self.instruction

        m.d.comb += [
            self.ctmm_opcode.eq(instr[0:7]),
            self.rd.eq(instr[7:12]),
            self.funct3.eq(instr[12:15]),
            self.rs1.eq(instr[15:20]),
            self.rs2.eq(instr[20:25]),
            self.funct7.eq(instr[25:32]),
        ]

        m.d.comb += self.imm_i.eq(instr[20:32])
        m.d.comb += self.imm_s.eq(Cat(instr[7:12], instr[25:32]))
        m.d.comb += self.imm_b.eq(Cat(
            Const(0, 1),
            instr[8:12],
            instr[25:31],
            instr[7],
            instr[31],
        ))
        m.d.comb += self.imm_u.eq(Cat(Const(0, 12), instr[12:32]))
        m.d.comb += self.imm_j.eq(Cat(
            Const(0, 1),
            instr[21:31],
            instr[20],
            instr[12:20],
            instr[31],
        ))

        opcode = self.ctmm_opcode

        is_standard_ctmm = Signal()
        m.d.comb += is_standard_ctmm.eq(
            (opcode == CTMMOpcode.LUI) |
            (opcode == CTMMOpcode.AUIPC) |
            (opcode == CTMMOpcode.JAL) |
            (opcode == CTMMOpcode.JALR) |
            (opcode == CTMMOpcode.BRANCH) |
            (opcode == CTMMOpcode.LOAD) |
            (opcode == CTMMOpcode.STORE) |
            (opcode == CTMMOpcode.ARITHI) |
            (opcode == CTMMOpcode.ARITH) |
            (opcode == CTMMOpcode.FENCE) |
            (opcode == CTMMOpcode.SYSTEM)
        )

        is_custom0 = Signal()
        m.d.comb += is_custom0.eq(opcode == CHURCH_CUSTOM0)

        m.d.comb += [
            self.is_ctmm_op.eq(is_standard_ctmm & self.instr_valid),
            self.is_church_op.eq(is_custom0 & self.instr_valid),
        ]

        m.d.comb += [
            self.church_op.eq(instr[12:15]),
            self.cr_dst.eq(instr[7:11]),
            self.cr_src.eq(instr[15:19]),
            self.cap_index.eq(Cat(instr[20:25], instr[25:32])),
            self.tperm_preset.eq(instr[20:24]),
            self.call_mask.eq(Cat(instr[20:25], instr[25:32])),
            self.switch_target.eq(instr[20:24]),
        ]

        m.d.comb += [
            self.fault_valid.eq(0),
            self.fault.eq(FaultType.NONE),
        ]

        with m.If(self.instr_valid):
            with m.If(~is_standard_ctmm & ~is_custom0):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault.eq(FaultType.INVALID_OP),
                ]

        return m
