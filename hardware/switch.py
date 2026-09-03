from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import ChurchMLoad


class ChurchSwitch(Elaboratable):
    def __init__(self):
        self.switch_start = Signal()
        self.cr_src = Signal(4)
        self.target = Signal(4)
        self.index = Signal(16)
        # Combinatorial M state for target.  It is sampled together with the
        # instruction operands on switch_start, so later device writes cannot
        # change the authorization decision of an in-flight SWITCH.
        self.target_m = Signal()
        self.switch_busy = Signal()
        self.switch_complete = Signal()
        # Pulses only when the delegated normal LOAD completed successfully.
        # The register file uses this to consume the M latch sampled at accept.
        self.m_consume_en = Signal()
        self.m_consume_target = Signal(2)
        self.switch_fault = Signal()
        self.fault_type = Signal(5)

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

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        src_latched = Signal(4)
        target_latched = Signal(4)
        index_latched = Signal(16)
        target_m_latched = Signal()
        fault_latched = Signal()
        fault_type_latched = Signal(5)
        sub_start = Signal()

        # SWITCH is the isolated-register form of LOAD.  Its only additional
        # checks are destination class and the destination's accepted M latch.
        target_valid = Signal()
        m.d.comb += target_valid.eq(
            (target_latched >= SWITCH_TGT_CR12) &
            (target_latched <= SWITCH_TGT_CR15)
        )

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(src_latched),
            u_mload.sub_cr_dst.eq(target_latched),
            u_mload.sub_index.eq(index_latched),
            u_mload.sub_direct.eq(0),
            u_mload.sub_direct_gt.eq(0),
            # Destination M authorises entering this path; it never elevates
            # source capability checks or Namespace validation.
            u_mload.sub_m_elevated.eq(0),
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

        m.d.comb += self.cr_rd_addr.eq(u_mload.cr_rd_addr)

        with m.FSM(name="switch") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                with m.If(self.switch_start):
                    m.d.sync += [
                        src_latched.eq(self.cr_src),
                        target_latched.eq(self.target),
                        index_latched.eq(self.index),
                        target_m_latched.eq(self.target_m),
                    ]
                    m.next = "CHECK_TARGET"

            with m.State("CHECK_TARGET"):
                with m.If(~target_valid):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                # SWITCH encoding reserves isolated CR12-CR15 for CRd only.
                # CRs is the same ordinary source class accepted by assembler:
                # CR0-CR11. Reject malformed sources before mLoad can read.
                with m.If(src_latched > 11):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.INVALID_OP),
                    ]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "CHECK_DEST_M"

            with m.State("CHECK_DEST_M"):
                with m.If(~target_m_latched):
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
            self.m_consume_en.eq(fsm.ongoing("CALL_SUB") & u_mload.sub_done),
            self.m_consume_target.eq(target_latched - SWITCH_TGT_CR12),
            self.switch_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
