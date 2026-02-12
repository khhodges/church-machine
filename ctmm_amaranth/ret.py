from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class CTMMReturn(Elaboratable):
    def __init__(self):
        self.return_start = Signal()
        self.cr_src = Signal(3)
        self.busy = Signal()
        self.complete = Signal()
        self.fault_valid = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.nia_set = Signal()
        self.nia_value = Signal(64)
        self.clear_m_bit = Signal()

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)
        self.g_bit_reset = Signal()
        self.g_bit_addr = Signal(64)

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST = 6
        CR7_NUCLEUS = 7

        return_cap = Signal(CAP_REG_LAYOUT)
        ret_view = View(CAP_REG_LAYOUT, return_cap)
        ret_gt = View(GT_LAYOUT, ret_view.word0_gt)

        has_e_perm = ret_gt.perms[PERM_E]
        is_null_cap = Signal()
        m.d.comb += is_null_cap.eq(ret_view.word0_gt.as_value() == 0)

        saved_nia = ret_view.word1_location
        saved_cr6_gt = ret_view.word2_limit
        saved_cr7_gt = ret_view.word3_seals

        fault_flag = Signal()
        fault_latched = Signal(4)

        m.d.comb += self.cr_rd_addr.eq(Cat(self.cr_src, Const(0, 1)))

        with m.FSM(name="ret") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.return_start):
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.sync += return_cap.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(is_null_cap):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Elif(~has_e_perm):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "RESTORE_CR6"

            with m.State("RESTORE_CR6"):
                wr_data = Signal(CAP_REG_LAYOUT)
                wr_view = View(CAP_REG_LAYOUT, wr_data)
                m.d.comb += wr_view.word0_gt.eq(saved_cr6_gt)
                m.d.comb += [
                    self.cr_wr_addr.eq(CR6_CLIST),
                    self.cr_wr_data.eq(wr_data),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "RESTORE_CR7"

            with m.State("RESTORE_CR7"):
                wr_data7 = Signal(CAP_REG_LAYOUT)
                wr_view7 = View(CAP_REG_LAYOUT, wr_data7)
                m.d.comb += wr_view7.word0_gt.eq(saved_cr7_gt)
                m.d.comb += [
                    self.cr_wr_addr.eq(CR7_NUCLEUS),
                    self.cr_wr_data.eq(wr_data7),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "RESET_G_CR6"

            with m.State("RESET_G_CR6"):
                cr15_view = View(CAP_REG_LAYOUT, self.cr15_namespace)
                cr6_gt_view = View(GT_LAYOUT, saved_cr6_gt)
                m.d.comb += [
                    self.g_bit_reset.eq(1),
                    self.g_bit_addr.eq(cr15_view.word1_location + Cat(cr6_gt_view.offset, Const(0, 32)) + 16),
                ]
                m.next = "RESET_G_CR7"

            with m.State("RESET_G_CR7"):
                cr15_view7 = View(CAP_REG_LAYOUT, self.cr15_namespace)
                cr7_gt_view = View(GT_LAYOUT, saved_cr7_gt)
                m.d.comb += [
                    self.g_bit_reset.eq(1),
                    self.g_bit_addr.eq(cr15_view7.word1_location + Cat(cr7_gt_view.offset, Const(0, 32)) + 16),
                ]
                m.next = "SET_NIA"

            with m.State("SET_NIA"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(saved_nia),
                    self.clear_m_bit.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault_valid.eq(fault_flag),
            self.fault_type.eq(fault_latched),
        ]

        return m
