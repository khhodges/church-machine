from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class CTMMCapTperm(Elaboratable):
    def __init__(self):
        self.tperm_start = Signal()
        self.cr_target = Signal(4)
        self.preset = Signal(4)

        self.tperm_busy = Signal()
        self.tperm_complete = Signal()
        self.tperm_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

    def elaborate(self, platform):
        m = Module()

        target_cap = Signal(CAP_REG_LAYOUT)
        target_view = View(CAP_REG_LAYOUT, target_cap)
        target_gt = View(GT_LAYOUT, target_view.word0_gt)
        preset_reg = Signal(4)
        fault_flag = Signal()
        fault_latched = Signal(4)

        new_perms = Signal(6)
        is_reserved = Signal()

        with m.Switch(preset_reg):
            with m.Case(TpermPreset.CLEAR):
                m.d.comb += new_perms.eq(0)
            with m.Case(TpermPreset.R):
                m.d.comb += new_perms.eq(PERM_MASK_R)
            with m.Case(TpermPreset.RW):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W)
            with m.Case(TpermPreset.X):
                m.d.comb += new_perms.eq(PERM_MASK_X)
            with m.Case(TpermPreset.RX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_X)
            with m.Case(TpermPreset.RWX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
            with m.Case(TpermPreset.L):
                m.d.comb += new_perms.eq(PERM_MASK_L)
            with m.Case(TpermPreset.S):
                m.d.comb += new_perms.eq(PERM_MASK_S)
            with m.Case(TpermPreset.E):
                m.d.comb += new_perms.eq(PERM_MASK_E)
            with m.Case(TpermPreset.LS):
                m.d.comb += new_perms.eq(PERM_MASK_L | PERM_MASK_S)
            with m.Case(TpermPreset.LE):
                m.d.comb += new_perms.eq(PERM_MASK_L | PERM_MASK_E)
            with m.Case(TpermPreset.SE):
                m.d.comb += new_perms.eq(PERM_MASK_S | PERM_MASK_E)
            with m.Case(TpermPreset.LSE):
                m.d.comb += new_perms.eq(PERM_MASK_L | PERM_MASK_S | PERM_MASK_E)
            with m.Default():
                m.d.comb += [new_perms.eq(0), is_reserved.eq(1)]

        can_only_reduce = Signal()
        m.d.comb += can_only_reduce.eq((new_perms & target_gt.perms) == new_perms)

        with m.FSM(name="tperm") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.tperm_start):
                    m.d.sync += preset_reg.eq(self.preset)
                    m.next = "READ_CR"

            with m.State("READ_CR"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_target)
                m.d.sync += target_cap.eq(self.cr_rd_data)
                m.next = "CHECK"

            with m.State("CHECK"):
                with m.If(is_reserved):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.TPERM_RSV)]
                    m.next = "FAULT"
                with m.Elif(~can_only_reduce):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.DOMAIN_PURITY)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "APPLY"

            with m.State("APPLY"):
                result_cap = Signal(CAP_REG_LAYOUT)
                result_view = View(CAP_REG_LAYOUT, result_cap)
                result_gt = View(GT_LAYOUT, result_view.word0_gt)
                m.d.comb += [
                    result_cap.eq(target_cap),
                    result_gt.perms.eq(new_perms & target_gt.perms),
                    self.cr_wr_addr.eq(self.cr_target),
                    self.cr_wr_data.eq(result_cap),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.tperm_busy.eq(~fsm.ongoing("IDLE")),
            self.tperm_complete.eq(fsm.ongoing("COMPLETE")),
            self.tperm_fault.eq(fault_flag),
            self.fault_type.eq(fault_latched),
        ]

        return m
