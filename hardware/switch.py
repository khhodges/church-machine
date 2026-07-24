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

        # §8 answer (GT v2.0 spec open question): CR8→CR12 migration status.
        # CR_PRIV_BASE=8 is an arithmetic encoding constant — it maps SWITCH's
        # 3-bit target field to 4-bit CR addresses: target=4→CR12, target=5→CR13,
        # target=6→CR14, target=7→CR15.  This is NOT a stale CR8 reference.
        # The "second thread register" lives at CR12 (loaded at boot by CHANGE AL,CR12,CR15,#1).
        # The CR8→CR12 migration is fully resolved; no outstanding stale CR8 usage remains.
        CR_PRIV_BASE = 8  # arithmetic base: 8+4=CR12, 8+5=CR13, 8+7=CR15

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        dest_cr = Signal(4)
        m.d.comb += dest_cr.eq(CR_PRIV_BASE + Cat(self.target, Const(0, 1)))

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

        # PassKey type check: CRs must be an Abstract GT (gt_type == 11₂).
        src_is_abstract = Signal()
        m.d.comb += src_is_abstract.eq(src_gt.gt_type == GT_TYPE_ABSTRACT)

        # Sentinel address check: CRs.word1_location must equal the reserved
        # hardware sentinel for the chosen target register.
        expected_sentinel = Signal(32)
        m.d.comb += expected_sentinel.eq(
            Mux(self.target == SWITCH_TGT_CR13,
                SWITCH_PASSKEY_SENTINEL_CR13,
                SWITCH_PASSKEY_SENTINEL_CR15)
        )

        sentinel_ok = Signal()
        m.d.comb += sentinel_ok.eq(src_view.word1_location == expected_sentinel)

        # Target validity: only CR13 (Tgt=5) and CR15 (Tgt=7) are permitted.
        target_valid = Signal()
        m.d.comb += target_valid.eq(
            (self.target == SWITCH_TGT_CR13) | (self.target == SWITCH_TGT_CR15)
        )

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
                    m.next = "CHECK_TARGET"

            with m.State("CHECK_TARGET"):
                # Only CR13 (Tgt=5) and CR15 (Tgt=7) are valid SWITCH targets.
                # All other Tgt values fault immediately with INVALID_OP.
                with m.If(~target_valid):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(Cat(self.cr_src, Const(0, 1)))]
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(Cat(self.cr_src, Const(0, 1)))]
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PASSKEY_TYPE"

            with m.State("CHECK_PASSKEY_TYPE"):
                # CRs must be an Abstract GT (gt_type == GT_TYPE_ABSTRACT == 11₂).
                # Any Inform, Outform, or NULL capability faults here.
                with m.If(~src_is_abstract):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "CHECK_PASSKEY_SENTINEL"

            with m.State("CHECK_PASSKEY_SENTINEL"):
                # CRs.word1_location must equal the reserved hardware sentinel for
                # the target register.  A mismatch (e.g. presenting a CR13 PassKey
                # to the CR15 target) faults with INVALID_OP.
                with m.If(~sentinel_ok):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.INVALID_OP)]
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
