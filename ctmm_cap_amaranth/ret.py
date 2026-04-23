from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import CTMMCapMLoad


class CTMMCapReturn(Elaboratable):
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
        self.nia_value = Signal(32)

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

    def elaborate(self, platform):
        m = Module()

        u_mload = CTMMCapMLoad()
        m.submodules.u_mload = u_mload

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
        saved_cr7_gt_view = View(GT_LAYOUT, saved_cr7_gt)

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

        cr6_latched = Signal(CAP_REG_LAYOUT)

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
            u_mload.sub_start.eq(sub_start_reg),
            u_mload.sub_cr_src.eq(0),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(0),
            u_mload.sub_direct.eq(1),
            u_mload.sub_m_elevated.eq(1),
            u_mload.sub_direct_gt.eq(mload_direct_gt),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(Mux(local_cr_wr_en, local_cr_wr_addr, u_mload.cr_wr_addr)),
            self.cr_wr_data.eq(Mux(local_cr_wr_en, local_cr_wr_data, u_mload.cr_wr_data)),
            self.cr_wr_en.eq(u_mload.cr_wr_en | local_cr_wr_en),
            self.mem_addr.eq(u_mload.mem_addr),
            self.mem_rd_en.eq(u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, Cat(self.cr_src, Const(0, 1)), u_mload.cr_rd_addr)
        )

        with m.FSM(name="ret") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.return_start):
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += local_cr_rd_en.eq(1)
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
                with m.If(u_mload.sub_done):
                    m.d.sync += [sub_done_latched.eq(1), cr6_latched.eq(u_mload.cr_wr_data)]
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(u_mload.sub_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "PHASE1_DONE"

            with m.State("PHASE1_DONE"):
                m.d.comb += [
                    local_cr_wr_en.eq(1),
                    local_cr_wr_addr.eq(CR_CLIST),
                    local_cr_wr_data.eq(cr6_latched),
                ]
                m.d.sync += [phase.eq(2), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE2"

            with m.State("PHASE2"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(u_mload.sub_fault_type)]
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

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault_valid.eq(fault_flag),
            self.fault_type.eq(fault_latched),
        ]

        return m
