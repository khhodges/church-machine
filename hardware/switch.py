from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import ChurchMLoad


class ChurchSwitch(Elaboratable):
    def __init__(self):
        self.switch_start = Signal()
        self.cr_src = Signal(3)
        self.target = Signal(3)
        self.index = Signal(16)
        self.switch_busy = Signal()
        self.switch_complete = Signal()
        self.switch_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()
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

        CR8_BASE = 8

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        dest_cr = Signal(4)
        m.d.comb += dest_cr.eq(CR8_BASE + Cat(self.target, Const(0, 1)))

        src_reg_latched = Signal(CAP_REG_LAYOUT)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start = Signal()

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(Cat(self.cr_src, Const(0, 1)) <= 7)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_l_perm = src_gt.perms[PERM_L]

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(Cat(self.cr_src, Const(0, 1))),
            u_mload.sub_cr_dst.eq(dest_cr),
            u_mload.sub_index.eq(self.index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_direct_gt.eq(0),
            u_mload.sub_m_elevated.eq(1),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(u_mload.cr_wr_addr),
            self.cr_wr_data.eq(u_mload.cr_wr_data),
            self.cr_wr_en.eq(u_mload.cr_wr_en),
            self.mem_addr.eq(u_mload.mem_addr),
            self.mem_rd_en.eq(u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        m.d.comb += self.cr_rd_addr.eq(Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr))

        with m.FSM(name="switch") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                with m.If(self.switch_start):
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(Cat(self.cr_src, Const(0, 1)))]
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(Cat(self.cr_src, Const(0, 1)))]
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(~src_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "START_SUB"

            with m.State("START_SUB"):
                m.d.comb += sub_start.eq(1)
                m.next = "WAIT_ACK"

            with m.State("WAIT_ACK"):
                m.d.comb += sub_start.eq(1)
                with m.If(u_mload.sub_busy):
                    m.next = "CALL_SUB"

            with m.State("CALL_SUB"):
                with m.If(u_mload.sub_fault):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(u_mload.sub_done | u_mload.sub_fault):
                    m.next = "IDLE"

        m.d.comb += [
            self.switch_busy.eq(~fsm.ongoing("IDLE")),
            self.switch_complete.eq(fsm.ongoing("CALL_SUB") & u_mload.sub_done),
            self.switch_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
