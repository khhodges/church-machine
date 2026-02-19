from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import COND_FLAGS_LAYOUT


class ChurchDecoder(Elaboratable):
    """Pure Church Machine decoder — clean 32-bit instruction format.

    Instruction format (32 bits):
        [31:28]  opcode    — 4 bits (8 Church opcodes + 8 reserved)
        [27:24]  condition — 4 bits (ARM-style conditional execution)
        [23:20]  cr_dst    — 4 bits (destination capability register)
        [19:16]  cr_src    — 4 bits (source capability register)
        [15:0]   immediate — 16 bits (index / preset / mask / target)

    No RISC-V encoding. No wasted bits. Every field at a fixed position.
    """

    def __init__(self):
        self.instruction = Signal(32)
        self.instr_valid = Signal()
        self.flags = Signal(COND_FLAGS_LAYOUT)

        self.exec_enable = Signal()
        self.is_church_op = Signal()

        self.church_op = Signal(4)
        self.cr_dst = Signal(4)
        self.cr_src = Signal(4)
        self.immediate = Signal(16)

        self.tperm_preset = Signal(4)
        self.cap_index = Signal(16)
        self.call_mask = Signal(16)
        self.switch_target = Signal(4)

        self.fault = Signal(4)
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        opcode_field = self.instruction[28:32]
        cond_field = self.instruction[24:28]
        cr_dst_field = self.instruction[20:24]
        cr_src_field = self.instruction[16:20]
        imm_field = self.instruction[0:16]

        m.d.comb += [
            self.church_op.eq(opcode_field),
            self.cr_dst.eq(cr_dst_field),
            self.cr_src.eq(cr_src_field),
            self.immediate.eq(imm_field),
        ]

        m.d.comb += [
            self.cap_index.eq(imm_field),
            self.tperm_preset.eq(imm_field[:4]),
            self.call_mask.eq(imm_field),
            self.switch_target.eq(imm_field[:4]),
        ]

        flags_view = View(COND_FLAGS_LAYOUT, self.flags)
        cond_pass = Signal()

        with m.Switch(cond_field):
            with m.Case(CondCode.EQ):
                m.d.comb += cond_pass.eq(flags_view.Z)
            with m.Case(CondCode.NE):
                m.d.comb += cond_pass.eq(~flags_view.Z)
            with m.Case(CondCode.CS):
                m.d.comb += cond_pass.eq(flags_view.C)
            with m.Case(CondCode.CC):
                m.d.comb += cond_pass.eq(~flags_view.C)
            with m.Case(CondCode.MI):
                m.d.comb += cond_pass.eq(flags_view.N)
            with m.Case(CondCode.PL):
                m.d.comb += cond_pass.eq(~flags_view.N)
            with m.Case(CondCode.VS):
                m.d.comb += cond_pass.eq(flags_view.V)
            with m.Case(CondCode.VC):
                m.d.comb += cond_pass.eq(~flags_view.V)
            with m.Case(CondCode.HI):
                m.d.comb += cond_pass.eq(flags_view.C & ~flags_view.Z)
            with m.Case(CondCode.LS):
                m.d.comb += cond_pass.eq(~flags_view.C | flags_view.Z)
            with m.Case(CondCode.GE):
                m.d.comb += cond_pass.eq(flags_view.N == flags_view.V)
            with m.Case(CondCode.LT):
                m.d.comb += cond_pass.eq(flags_view.N != flags_view.V)
            with m.Case(CondCode.GT):
                m.d.comb += cond_pass.eq(~flags_view.Z & (flags_view.N == flags_view.V))
            with m.Case(CondCode.LE):
                m.d.comb += cond_pass.eq(flags_view.Z | (flags_view.N != flags_view.V))
            with m.Case(CondCode.AL):
                m.d.comb += cond_pass.eq(1)
            with m.Case(CondCode.NV):
                m.d.comb += cond_pass.eq(0)

        m.d.comb += self.exec_enable.eq(self.instr_valid & cond_pass)

        valid_opcode = Signal()
        m.d.comb += valid_opcode.eq(opcode_field <= ChurchOpcode.XLOADLAMBDA)
        m.d.comb += self.is_church_op.eq(valid_opcode & self.instr_valid)

        m.d.comb += [
            self.fault_valid.eq(0),
            self.fault.eq(FaultType.NONE),
        ]

        with m.If(self.instr_valid):
            with m.If(~valid_opcode):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault.eq(FaultType.INVALID_OP),
                ]
            with m.Elif((opcode_field == ChurchOpcode.TPERM) &
                         ((imm_field[:4] == TpermPreset.RSV1) |
                          (imm_field[:4] == TpermPreset.RSV2) |
                          (imm_field[:4] == TpermPreset.RSV0))):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault.eq(FaultType.TPERM_RSV),
                ]

        return m
