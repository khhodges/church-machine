from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchReturn(Elaboratable):
    def __init__(self):
        self.return_start = Signal()
        self.cr_src = Signal(3)
        self.busy = Signal()
        self.complete = Signal()
        self.fault_valid = Signal()
        self.fault_type = Signal(4)
        self.reboot_request = Signal()

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.nia_set = Signal()
        self.nia_value = Signal(32)

        self.mload_start = Signal()
        self.mload_cr_src = Signal(4)
        self.mload_cr_dst = Signal(4)
        self.mload_index = Signal(17)
        self.mload_direct = Signal()
        self.mload_direct_gt = Signal(32)
        self.mload_m_elevated = Signal()

        self.mload_done = Signal()
        self.mload_fault = Signal()
        self.mload_fault_type = Signal(4)

        self.lambda_active = Signal()
        self.lambda_pc = Signal(32)
        self.lambda_clear = Signal()

    def elaborate(self, platform):
        m = Module()

        return_cap = Signal(CAP_REG_LAYOUT)
        ret_view = View(CAP_REG_LAYOUT, return_cap)
        ret_gt = View(GT_LAYOUT, ret_view.word0_gt)

        has_e_perm = ret_gt.perms[PERM_E]
        is_null_cap = Signal()
        m.d.comb += is_null_cap.eq(ret_gt.gt_type == GT_TYPE_NULL)

        saved_nia = ret_view.word1_location
        saved_cr6_gt = ret_view.word2_limit
        saved_cr7_gt = ret_view.word3_seals

        saved_cr6_gt_view = View(GT_LAYOUT, saved_cr6_gt)

        saved_cr6_has_e = saved_cr6_gt_view.perms[PERM_E]

        phase = Signal(2)
        fault_flag = Signal()
        fault_latched = Signal(4)
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_en = Signal()
        local_cr_wr_en = Signal()
        local_cr_wr_addr = Signal(4)
        local_cr_wr_data = Signal(CAP_REG_LAYOUT)

        mload_dst = Signal(4)
        mload_direct_gt = Signal(32)
        with m.Switch(phase):
            with m.Case(1):
                m.d.comb += [
                    mload_dst.eq(CR_CLIST),
                    mload_direct_gt.eq(saved_cr6_gt),
                ]
            with m.Default():
                m.d.comb += [
                    mload_dst.eq(CR_NUCLEUS),
                    mload_direct_gt.eq(saved_cr7_gt),
                ]

        m.d.comb += [
            self.mload_start.eq(sub_start_reg),
            self.mload_cr_src.eq(0),
            self.mload_cr_dst.eq(mload_dst),
            self.mload_index.eq(0),
            self.mload_direct.eq(1),
            self.mload_m_elevated.eq(1),
            self.mload_direct_gt.eq(mload_direct_gt),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(local_cr_wr_addr),
            self.cr_wr_data.eq(local_cr_wr_data),
            self.cr_wr_en.eq(local_cr_wr_en),
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, Cat(self.cr_src, Const(0, 1)), 0)
        )

        with m.FSM(name="ret") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.return_start):
                    with m.If(self.lambda_active):
                        m.next = "LAMBDA_FAST"
                    with m.Else():
                        m.next = "READ_SRC"

            with m.State("LAMBDA_FAST"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(self.lambda_pc),
                    self.lambda_clear.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("READ_SRC"):
                m.d.comb += local_cr_rd_en.eq(1)
                m.d.sync += return_cap.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(is_null_cap):
                    m.next = "REBOOT"
                with m.Elif(~has_e_perm):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_CR6_E"

            with m.State("CHECK_CR6_E"):
                with m.If(~saved_cr6_has_e):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "PHASE1"

            with m.State("PHASE1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "PHASE1_DONE"

            with m.State("PHASE1_DONE"):
                m.d.sync += [phase.eq(2), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE2"

            with m.State("PHASE2"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "SET_NIA"

            with m.State("SET_NIA"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(saved_nia + 4),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("REBOOT"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault_valid.eq(fault_flag),
            self.fault_type.eq(fault_latched),
            self.reboot_request.eq(fsm.ongoing("REBOOT")),
        ]

        return m
