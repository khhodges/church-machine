from amaranth import *

from .types import *
from .layouts import CAP_REG_LAYOUT
from .mload import CMCapMLoad


class CMCapLoad(Elaboratable):
    def __init__(self):
        self.load_start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(17)
        self.load_busy = Signal()
        self.load_complete = Signal()
        self.load_fault = Signal()
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

        u_mload = CMCapMLoad()
        m.submodules.u_mload = u_mload

        sub_start = Signal()

        m.d.comb += [
            u_mload.sub_cr_src.eq(self.cr_src),
            u_mload.sub_cr_dst.eq(self.cr_dst),
            u_mload.sub_index.eq(self.index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_direct_gt.eq(0),
            u_mload.sub_m_elevated.eq(1),
            u_mload.sub_start.eq(sub_start),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_rd_addr.eq(u_mload.cr_rd_addr),
            self.cr_wr_addr.eq(u_mload.cr_wr_addr),
            self.cr_wr_data.eq(u_mload.cr_wr_data),
            self.cr_wr_en.eq(u_mload.cr_wr_en),
            self.mem_addr.eq(u_mload.mem_addr),
            self.mem_rd_en.eq(u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        with m.FSM(name="load_wrapper") as fsm:
            with m.State("IDLE"):
                with m.If(self.load_start):
                    m.next = "START_SUB"
            with m.State("START_SUB"):
                m.d.comb += sub_start.eq(1)
                m.next = "WAIT_ACK"
            with m.State("WAIT_ACK"):
                m.d.comb += sub_start.eq(1)
                with m.If(u_mload.sub_busy):
                    m.next = "CALL_SUB"
            with m.State("CALL_SUB"):
                with m.If(u_mload.sub_done | u_mload.sub_fault):
                    m.next = "IDLE"

        m.d.comb += [
            self.load_busy.eq(~fsm.ongoing("IDLE")),
            self.load_complete.eq(fsm.ongoing("CALL_SUB") & u_mload.sub_done),
            self.load_fault.eq(fsm.ongoing("CALL_SUB") & u_mload.sub_fault),
            self.fault_type.eq(u_mload.sub_fault_type),
        ]

        return m
