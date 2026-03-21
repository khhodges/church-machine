from amaranth import *

from .hw_types import *


class ChurchLoad(Elaboratable):
    def __init__(self):
        self.load_start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.load_busy = Signal()
        self.load_complete = Signal()
        self.load_fault = Signal()
        self.fault_type = Signal(4)

        self.mload_start = Signal()
        self.mload_cr_src = Signal(4)
        self.mload_cr_dst = Signal(4)
        self.mload_index = Signal(16)
        self.mload_direct = Signal()
        self.mload_direct_gt = Signal(32)
        self.mload_m_elevated = Signal()

        self.mload_busy = Signal()
        self.mload_done = Signal()
        self.mload_fault = Signal()
        self.mload_fault_type = Signal(4)

    def elaborate(self, platform):
        m = Module()

        m.d.comb += [
            self.mload_cr_src.eq(self.cr_src),
            self.mload_cr_dst.eq(self.cr_dst),
            self.mload_index.eq(self.index),
            self.mload_direct.eq(0),
            self.mload_direct_gt.eq(0),
            self.mload_m_elevated.eq(self.cr_src == CR_CLIST),
        ]

        with m.FSM(name="load_wrapper") as fsm:
            with m.State("IDLE"):
                with m.If(self.load_start):
                    m.next = "START_SUB"
            with m.State("START_SUB"):
                m.d.comb += self.mload_start.eq(1)
                m.next = "WAIT_ACK"
            with m.State("WAIT_ACK"):
                m.d.comb += self.mload_start.eq(1)
                with m.If(self.mload_busy):
                    m.next = "CALL_SUB"
            with m.State("CALL_SUB"):
                with m.If(self.mload_done | self.mload_fault):
                    m.next = "IDLE"

        m.d.comb += [
            self.load_busy.eq(~fsm.ongoing("IDLE")),
            self.load_complete.eq(fsm.ongoing("CALL_SUB") & self.mload_done),
            self.load_fault.eq(fsm.ongoing("CALL_SUB") & self.mload_fault),
            self.fault_type.eq(self.mload_fault_type),
        ]

        return m
