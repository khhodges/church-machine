from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchCall(Elaboratable):
    def __init__(self):
        self.call_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(16)
        self.mask = Signal(16)
        self.call_busy = Signal()
        self.call_complete = Signal()
        self.call_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.mload_start = Signal()
        self.mload_cr_src = Signal(4)
        self.mload_cr_dst = Signal(4)
        self.mload_index = Signal(16)
        self.mload_direct = Signal()
        self.mload_direct_gt = Signal(32)
        self.mload_m_elevated = Signal()

        self.mload_done = Signal()
        self.mload_fault = Signal()
        self.mload_fault_type = Signal(4)

        self.saved_cr5_gt = Signal(32)

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.dr_clear_mask = Signal(16)
        self.cr_clear_mask = Signal(16)

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST = 6
        CR14_CODE = 14
        MAX_SRC_REG = 5
        B_BIT_POS = 31
        LIMIT_WIDTH = 32

        phase = Signal()
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(16)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_addr = Signal(4)

        b_idx = Signal(3)
        b_cr_data = Signal(CAP_REG_LAYOUT)
        b_clear_wr_en = Signal()
        b_clear_wr_addr = Signal(4)
        b_clear_wr_data = Signal(CAP_REG_LAYOUT)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_e_perm = src_gt.perms[PERM_E]

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        m.d.comb += [
            mload_src.eq(Mux(phase, CR6_CLIST, self.cr_src)),
            mload_dst.eq(Mux(phase, CR14_CODE, CR6_CLIST)),
            mload_index.eq(Mux(phase, 0, self.index)),
        ]

        m.d.comb += [
            self.mload_start.eq(sub_start_reg),
            self.mload_cr_src.eq(mload_src),
            self.mload_cr_dst.eq(mload_dst),
            self.mload_index.eq(mload_index),
            self.mload_direct.eq(0),
            self.mload_m_elevated.eq(1),
            self.mload_direct_gt.eq(0),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(b_clear_wr_addr),
            self.cr_wr_data.eq(b_clear_wr_data),
            self.cr_wr_en.eq(b_clear_wr_en),
        ]

        m.d.comb += self.cr_rd_addr.eq(local_cr_rd_addr)

        cr_preserve = mask_latched[5:11]
        dr1_5_preserve = mask_latched[0:5]

        dr_clear_computed = Signal(16)
        cr_clear_computed = Signal(16)
        m.d.comb += [
            dr_clear_computed.eq(Cat(Const(0, 1), ~dr1_5_preserve, Const(0x3FF, 10))),
            cr_clear_computed.eq(Cat(~cr_preserve, Const(0, 10))),
        ]

        with m.FSM(name="call") as fsm:
            with m.State("IDLE"):
                m.d.sync += [phase.eq(0), fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.call_start):
                    m.d.sync += mask_latched.eq(self.mask)
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                m.d.comb += local_cr_rd_addr.eq(self.cr_src)
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += local_cr_rd_addr.eq(self.cr_src)
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(~src_has_e_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.comb += local_cr_rd_addr.eq(5)
                    m.next = "READ_CR5"

            with m.State("READ_CR5"):
                m.d.comb += local_cr_rd_addr.eq(5)
                cr5_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
                m.d.sync += self.saved_cr5_gt.eq(cr5_view.word0_gt)
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE1"

            with m.State("PHASE1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "PHASE1_DONE"

            with m.State("PHASE1_DONE"):
                m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE2"

            with m.State("PHASE2"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "CLEAR_B_INIT"

            with m.State("CLEAR_B_INIT"):
                m.d.sync += b_idx.eq(0)
                m.next = "CLEAR_B_CHECK"

            with m.State("CLEAR_B_CHECK"):
                with m.If(b_idx > 5):
                    m.next = "COMPLETE"
                with m.Elif(cr_preserve.bit_select(b_idx, 1)):
                    m.d.comb += local_cr_rd_addr.eq(b_idx)
                    m.next = "CLEAR_B_READ"
                with m.Else():
                    m.d.sync += b_idx.eq(b_idx + 1)

            with m.State("CLEAR_B_READ"):
                m.d.comb += local_cr_rd_addr.eq(b_idx)
                m.d.sync += b_cr_data.eq(self.cr_rd_data)
                m.next = "CLEAR_B_WRITE"

            with m.State("CLEAR_B_WRITE"):
                b_src = View(CAP_REG_LAYOUT, b_cr_data)
                cleared_gt = Signal(32, name="cleared_gt")
                m.d.comb += cleared_gt.eq(b_src.word0_gt & ~(1 << B_BIT_POS))
                b_dst = View(CAP_REG_LAYOUT, b_clear_wr_data)
                m.d.comb += [
                    b_dst.word0_gt.eq(cleared_gt),
                    b_dst.word1_location.eq(b_src.word1_location),
                    b_dst.word2_limit.eq(b_src.word2_limit),
                    b_dst.word3_seals.eq(b_src.word3_seals),
                    b_clear_wr_en.eq(1),
                    b_clear_wr_addr.eq(b_idx),
                ]
                m.d.sync += b_idx.eq(b_idx + 1)
                m.next = "CLEAR_B_CHECK"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.call_busy.eq(~fsm.ongoing("IDLE")),
            self.call_complete.eq(fsm.ongoing("COMPLETE")),
            self.call_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(0),
            self.dr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), dr_clear_computed, 0)),
            self.cr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), cr_clear_computed, 0)),
        ]

        return m
