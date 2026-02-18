from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class RV32CapMSave(Elaboratable):
    def __init__(self):
        self.sub_start = Signal()
        self.sub_dst_cap = Signal(CAP_REG_LAYOUT)
        self.sub_src_gt = Signal(32)
        self.sub_index = Signal(17)
        self.sub_bind_flag = Signal()
        self.sub_busy = Signal()
        self.sub_done = Signal()
        self.sub_fault = Signal()
        self.sub_fault_type = Signal(4)

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

    def elaborate(self, platform):
        m = Module()

        dst_cap_reg = Signal(CAP_REG_LAYOUT)
        src_gt_reg = Signal(32)
        index_reg = Signal(17)
        bind_flag_reg = Signal()
        fault_type_reg = Signal(4)

        dst_view = View(CAP_REG_LAYOUT, dst_cap_reg)
        dst_gt = View(GT_LAYOUT, dst_view.word0_gt)
        src_gt_view = View(GT_LAYOUT, src_gt_reg)

        dst_has_s_perm = dst_gt.perms[PERM_S]
        index_in_bounds = Signal()
        m.d.comb += index_in_bounds.eq(index_reg < dst_view.word2_limit[:17])

        write_addr = Signal(32)
        m.d.comb += write_addr.eq(dst_view.word1_location + (index_reg << 2))

        with m.FSM(name="msave") as fsm:
            with m.State("IDLE"):
                with m.If(self.sub_start):
                    m.d.sync += [
                        dst_cap_reg.eq(self.sub_dst_cap),
                        src_gt_reg.eq(self.sub_src_gt),
                        index_reg.eq(self.sub_index),
                        bind_flag_reg.eq(self.sub_bind_flag),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    m.next = "CHECK_BIND"

            with m.State("CHECK_BIND"):
                with m.If(~bind_flag_reg):
                    m.d.sync += fault_type_reg.eq(FaultType.BIND)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_S"

            with m.State("CHECK_S"):
                with m.If(~dst_has_s_perm):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_S)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_BOUNDS"

            with m.State("CHECK_BOUNDS"):
                with m.If(~index_in_bounds):
                    m.d.sync += fault_type_reg.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "WRITE_GT"

            with m.State("WRITE_GT"):
                m.d.comb += [
                    self.mem_wr_en.eq(1),
                    self.mem_wr_addr.eq(write_addr),
                    self.mem_wr_data.eq(src_gt_reg),
                ]
                with m.If(self.mem_wr_done):
                    m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.sub_busy.eq(~fsm.ongoing("IDLE")),
            self.sub_done.eq(fsm.ongoing("COMPLETE")),
            self.sub_fault.eq(fsm.ongoing("FAULT")),
            self.sub_fault_type.eq(fault_type_reg),
        ]

        return m
