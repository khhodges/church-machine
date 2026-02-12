from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import CTMMMLoad


class CTMMCall(Elaboratable):
    def __init__(self):
        self.call_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(8)
        self.mask = Signal(11)
        self.call_busy = Signal()
        self.call_complete = Signal()
        self.call_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_addr = Signal(64)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(64)
        self.mem_rd_valid = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(64)
        self.g_bit_reset = Signal()
        self.g_bit_addr = Signal(64)

        self.saved_cr5_gt = Signal(64)

        self.nia_set = Signal()
        self.nia_value = Signal(64)
        self.dr_clear_mask = Signal(16)
        self.cr_clear_mask = Signal(16)

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST = 6
        CR7_NUCLEUS = 7
        MAX_SRC_REG = 5

        u_mload = CTMMMLoad()
        m.submodules.u_mload = u_mload

        phase = Signal()
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(11)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_l_perm = src_gt.perms[PERM_L]

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(10)
        m.d.comb += [
            mload_src.eq(Mux(phase, CR6_CLIST, self.cr_src)),
            mload_dst.eq(Mux(phase, CR7_NUCLEUS, CR6_CLIST)),
            mload_index.eq(Mux(phase, 0, self.index)),
        ]

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(0),             # CALL uses C-List fetch mode
            u_mload.sub_direct_gt.eq(0),
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
            self.g_bit_reset.eq(u_mload.g_bit_reset),
            self.g_bit_addr.eq(u_mload.g_bit_addr),
        ]

        m.d.comb += self.cr_rd_addr.eq(Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr))
        m.d.comb += sub_start.eq(sub_start_reg)

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
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_src)]
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_src)]
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(~src_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(5)]
                    m.next = "READ_CR5"

            with m.State("READ_CR5"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(5)]
                cr5_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
                m.d.sync += self.saved_cr5_gt.eq(cr5_view.word0_gt)
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE1"

            with m.State("PHASE1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
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
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "COMPLETE"

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
