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
        self.fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18

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
        self.mload_fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18

    def elaborate(self, platform):
        m = Module()

        # Latch operands at load_start.  The core retires a LOAD on its issue
        # cycle and the decoder immediately moves to the next instruction, so
        # if the shared mload grants this unit's request late (e.g. right
        # after a CALL releases the bus), comb-wired operands would belong to
        # the WRONG instruction (observed: LOAD CR3 executed with dst=CR4).
        cr_src_lat = Signal(4)
        cr_dst_lat = Signal(4)
        index_lat  = Signal(16)
        structural_fault = Signal()

        m.d.comb += [
            self.mload_cr_src.eq(cr_src_lat),
            self.mload_cr_dst.eq(cr_dst_lat),
            self.mload_index.eq(index_lat),
            self.mload_direct.eq(0),
            self.mload_direct_gt.eq(0),
            self.mload_m_elevated.eq(0),
        ]

        with m.FSM(name="load_wrapper") as fsm:
            with m.State("IDLE"):
                with m.If(self.load_start):
                    m.d.sync += [
                        cr_src_lat.eq(self.cr_src),
                        cr_dst_lat.eq(self.cr_dst),
                        index_lat.eq(self.index),
                        structural_fault.eq(
                            # CR6 is the sealed c-list capability and CR14
                            # is its machine-owned bound/code context.  The
                            # namespace, stack, interrupt, and heap registers
                            # are explicitly loaded during boot or by normal
                            # working code and are not structural targets.
                            (self.cr_dst == CR_CLIST) |
                            (self.cr_dst == CR_CLOOMC)
                        ),
                    ]
                    m.next = "CHECK_STRUCTURAL"
            with m.State("CHECK_STRUCTURAL"):
                with m.If(structural_fault):
                    m.next = "FAULT"
                with m.Else():
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
            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.load_busy.eq(~fsm.ongoing("IDLE")),
            self.load_complete.eq(fsm.ongoing("CALL_SUB") & self.mload_done),
            self.load_fault.eq(
                fsm.ongoing("CALL_SUB") & self.mload_fault |
                fsm.ongoing("FAULT")
            ),
            self.fault_type.eq(
                Mux(fsm.ongoing("FAULT"), FaultType.STRUCTURAL_REG,
                    self.mload_fault_type)
            ),
        ]

        return m
