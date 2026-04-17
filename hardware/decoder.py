from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import COND_FLAGS_LAYOUT


class ChurchDecoder(Elaboratable):
    """Church Machine decoder — clean 32-bit instruction format.

    Instruction format (32 bits) — matches patent Section 14:
        [31:27]  opcode    — 5 bits (10 Church opcodes + 10 Turing + 12 reserved)
        [26:23]  condition — 4 bits (ARM-style conditional execution)
        [22:19]  cr_dst    — 4 bits (destination CR for Church ops; DR index for Turing ops)
        [18:15]  cr_src    — 4 bits (source CR for Church ops; DR index for Turing ops)
        [14:0]   immediate — 15 bits (index / preset / mask / target / word offset)

    No RISC-V encoding. No wasted bits. Every field at a fixed position.

    Turing ops implemented: DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB,
    BRANCH, SHL, SHR.
    For all Turing ops except DREAD/DWRITE, cr_dst and cr_src are both DR
    indices (0-15) — pure data-register operations with no capability access.
    DREAD/DWRITE are the only Turing ops that use cr_src as a CR index (the
    GT covering the data object); immediate meaning varies by op.

    When iot_profile=True, LAMBDA, CHANGE, SWITCH, ELOADCALL, and XLOADLAMBDA
    opcodes are treated as invalid (FAULT_OPCODE).
    """

    def __init__(self, iot_profile=False):
        self.iot_profile = iot_profile
        self.instruction = Signal(32)
        self.instr_valid = Signal()
        self.flags = Signal(COND_FLAGS_LAYOUT)

        self.exec_enable = Signal()
        self.is_church_op  = Signal()
        self.is_dread_op   = Signal()
        self.is_dwrite_op  = Signal()
        self.is_iadd_op    = Signal()
        self.is_isub_op    = Signal()
        self.is_branch_op  = Signal()
        self.is_shl_op     = Signal()
        self.is_shr_op     = Signal()
        self.is_bfext_op   = Signal()
        self.is_bfins_op   = Signal()
        self.is_mcmp_op    = Signal()

        self.church_op = Signal(5)
        self.cr_dst = Signal(4)
        self.cr_src = Signal(4)
        self.immediate = Signal(15)

        self.tperm_preset = Signal(4)
        self.cap_index = Signal(15)
        self.call_mask = Signal(15)
        self.switch_target = Signal(4)

        self.fault = Signal(4)
        self.fault_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        opcode_field = self.instruction[27:32]
        cond_field = self.instruction[23:27]
        cr_dst_field = self.instruction[19:23]
        cr_src_field = self.instruction[15:19]
        imm_field = self.instruction[0:15]

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

        is_dread  = Signal()
        is_dwrite = Signal()
        is_iadd   = Signal()
        is_isub   = Signal()
        is_branch = Signal()
        is_shl    = Signal()
        is_shr    = Signal()
        is_bfext  = Signal()
        is_bfins  = Signal()
        is_mcmp   = Signal()
        m.d.comb += [
            is_dread.eq(opcode_field  == TuringOpcode.DREAD),
            is_dwrite.eq(opcode_field == TuringOpcode.DWRITE),
            is_iadd.eq(opcode_field   == TuringOpcode.IADD),
            is_isub.eq(opcode_field   == TuringOpcode.ISUB),
            is_branch.eq(opcode_field == TuringOpcode.BRANCH),
            is_shl.eq(opcode_field    == TuringOpcode.SHL),
            is_shr.eq(opcode_field    == TuringOpcode.SHR),
            is_bfext.eq(opcode_field  == TuringOpcode.BFEXT),
            is_bfins.eq(opcode_field  == TuringOpcode.BFINS),
            is_mcmp.eq(opcode_field   == TuringOpcode.MCMP),
        ]

        iot_excluded = Signal()
        if self.iot_profile:
            m.d.comb += iot_excluded.eq(
                (opcode_field == ChurchOpcode.LAMBDA) |
                (opcode_field == ChurchOpcode.CHANGE) |
                (opcode_field == ChurchOpcode.SWITCH) |
                (opcode_field == ChurchOpcode.ELOADCALL) |
                (opcode_field == ChurchOpcode.XLOADLAMBDA)
            )
        else:
            m.d.comb += iot_excluded.eq(0)

        valid_opcode = Signal()
        m.d.comb += valid_opcode.eq(
            ((opcode_field <= ChurchOpcode.XLOADLAMBDA) & ~iot_excluded) |
            is_dread | is_dwrite | is_iadd | is_isub | is_branch |
            is_shl | is_shr | is_bfext | is_bfins | is_mcmp
        )
        m.d.comb += [
            self.is_church_op.eq((opcode_field <= ChurchOpcode.XLOADLAMBDA) & ~iot_excluded & self.instr_valid),
            self.is_dread_op.eq(is_dread   & self.instr_valid),
            self.is_dwrite_op.eq(is_dwrite & self.instr_valid),
            self.is_iadd_op.eq(is_iadd     & self.instr_valid),
            self.is_isub_op.eq(is_isub     & self.instr_valid),
            self.is_branch_op.eq(is_branch & self.instr_valid),
            self.is_shl_op.eq(is_shl       & self.instr_valid),
            self.is_shr_op.eq(is_shr       & self.instr_valid),
            self.is_bfext_op.eq(is_bfext   & self.instr_valid),
            self.is_bfins_op.eq(is_bfins   & self.instr_valid),
            self.is_mcmp_op.eq(is_mcmp     & self.instr_valid),
        ]

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
                         ((imm_field[:4] == TpermPreset.RSV0) |
                          (imm_field[:4] == TpermPreset.RSV1))):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault.eq(FaultType.TPERM_RSV),
                ]

        return m
