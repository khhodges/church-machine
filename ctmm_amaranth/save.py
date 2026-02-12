from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .msave import CTMMMSave


class CTMMSave(Elaboratable):
    def __init__(self):
        self.save_start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(8)
        self.save_busy = Signal()
        self.save_complete = Signal()
        self.save_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.mem_wr_addr = Signal(64)
        self.mem_wr_data = Signal(64)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)
        self.g_bit_reset = Signal()
        self.g_bit_addr = Signal(64)

    def elaborate(self, platform):
        m = Module()

        MAX_CLIST_REG = 6

        u_msave = CTMMMSave()
        m.submodules.u_msave = u_msave

        dst_reg_latched = Signal(CAP_REG_LAYOUT)
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        dst_in_range = Signal()
        m.d.comb += dst_in_range.eq(self.cr_dst <= MAX_CLIST_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)

        m.d.comb += [
            u_msave.sub_start.eq(sub_start),
            u_msave.sub_dst_cap.eq(dst_reg_latched),
            u_msave.sub_src_gt.eq(src_view.word0_gt),
            u_msave.sub_index.eq(self.index),
            u_msave.mem_wr_done.eq(self.mem_wr_done),
        ]
        m.d.comb += [
            self.mem_wr_addr.eq(u_msave.mem_wr_addr),
            self.mem_wr_data.eq(u_msave.mem_wr_data),
            self.mem_wr_en.eq(u_msave.mem_wr_en),
        ]
        m.d.comb += sub_start.eq(sub_start_reg)

        with m.FSM(name="save_wrapper") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.save_start):
                    m.d.comb += self.cr_rd_addr.eq(self.cr_dst)
                    m.next = "CHECK_DST_READ"

            with m.State("CHECK_DST_READ"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_dst)
                with m.If(~dst_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "LATCH_DST"

            with m.State("LATCH_DST"):
                m.d.sync += dst_reg_latched.eq(self.cr_rd_data)
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.next = "LATCH_SRC"

            with m.State("LATCH_SRC"):
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.d.sync += sub_start_reg.eq(1)
                m.next = "CALL_SUB"

            with m.State("CALL_SUB"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_msave.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_msave.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_msave.sub_fault_type)]
                with m.If(sub_done_latched):
                    m.next = "RESET_G"
                with m.Elif(sub_fault_latched):
                    m.next = "IDLE"

            with m.State("RESET_G"):
                dst_view = View(CAP_REG_LAYOUT, dst_reg_latched)
                dst_gt_view = View(GT_LAYOUT, dst_view.word0_gt)
                cr15_view = View(CAP_REG_LAYOUT, self.cr15_namespace)
                m.d.comb += [
                    self.g_bit_reset.eq(1),
                    self.g_bit_addr.eq(cr15_view.word1_location + Cat(dst_gt_view.offset, Const(0, 32)) + 16),
                ]
                m.next = "IDLE"

        m.d.comb += [
            self.save_busy.eq(~fsm.ongoing("IDLE")),
            self.save_complete.eq(fsm.ongoing("RESET_G")),
            self.save_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
