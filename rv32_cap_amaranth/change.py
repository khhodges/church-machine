from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .mload import CTMMCapMLoad


class CTMMCapChange(Elaboratable):
    def __init__(self):
        self.change_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(17)
        self.change_mask = Signal(16)
        self.change_busy = Signal()
        self.change_complete = Signal()
        self.change_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.cr8_thread = Signal(CAP_REG_LAYOUT)
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

        self.dr_rd_addr = Signal(4)
        self.dr_rd_data = Signal(32)
        self.nia = Signal(32)
        self.flags = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        RESERVED_MASK = 0b1000_0001_1000_0000

        u_mload = CTMMCapMLoad()
        m.submodules.u_mload = u_mload

        cr_index = Signal(4)
        crn_reg_latched = Signal(CAP_REG_LAYOUT)
        index_latched = Signal(17)
        mask_latched = Signal(16)
        fault_latched = Signal()
        fault_type_latched = Signal(4)

        save_index = Signal(5)

        mload_start_reg = Signal()
        mload_done_latched = Signal()
        mload_fault_latched = Signal()

        effective_mask = Signal(16)
        m.d.comb += effective_mask.eq(mask_latched & ~RESERVED_MASK)

        skip_current_cr = Signal()
        m.d.comb += skip_current_cr.eq((cr_index > 14) | ~effective_mask.bit_select(cr_index, 1))

        crn_view = View(CAP_REG_LAYOUT, crn_reg_latched)
        crn_gt = View(GT_LAYOUT, crn_view.word0_gt)
        crn_has_l_perm = crn_gt.perms[PERM_L]

        cr8_view = View(CAP_REG_LAYOUT, self.cr8_thread)
        cr8_gt = View(GT_LAYOUT, cr8_view.word0_gt)

        thread_base = cr8_view.word1_location

        cr7_base = Signal(32)

        fetched_gt_latched = Signal(32)

        DR_OFFSET = 0
        PACKED_PC_OFFSET = 16

        pc_offset = Signal(32)
        packed_pc_word = Signal(32)
        m.d.comb += pc_offset.eq(self.nia - cr7_base)
        m.d.comb += packed_pc_word.eq(Cat(pc_offset[:28], self.flags))

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(17)

        m.d.comb += [
            u_mload.sub_start.eq(mload_start_reg),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_direct_gt.eq(0),
            u_mload.sub_m_elevated.eq(1),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        mem_wr_addr_reg = Signal(32)
        mem_wr_data_reg = Signal(32)
        mem_wr_en_reg = Signal()

        m.d.comb += [
            self.mem_wr_addr.eq(mem_wr_addr_reg),
            self.mem_wr_data.eq(mem_wr_data_reg),
            self.mem_wr_en.eq(mem_wr_en_reg),
            self.mem_rd_addr.eq(u_mload.mem_addr),
            self.mem_rd_en.eq(u_mload.mem_rd_en),
            self.cr_wr_addr.eq(u_mload.cr_wr_addr),
            self.cr_wr_data.eq(u_mload.cr_wr_data),
            self.cr_wr_en.eq(u_mload.cr_wr_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        with m.FSM(name="change") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(self.change_start):
                    m.d.sync += [
                        index_latched.eq(self.index),
                        mask_latched.eq(self.change_mask),
                        cr_index.eq(0),
                        save_index.eq(0),
                    ]
                    m.d.comb += self.cr_rd_addr.eq(7)
                    m.next = "READ_CR7"

            with m.State("READ_CR7"):
                m.d.comb += self.cr_rd_addr.eq(7)
                m.next = "LATCH_CR7"

            with m.State("LATCH_CR7"):
                m.d.comb += self.cr_rd_addr.eq(7)
                cr7_rd_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
                m.d.sync += cr7_base.eq(cr7_rd_view.word1_location)
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.next = "READ_CRN"

            with m.State("READ_CRN"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.next = "LATCH_CRN"

            with m.State("LATCH_CRN"):
                m.d.sync += crn_reg_latched.eq(self.cr_rd_data)
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                with m.If(~crn_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "SAVE_DR"

            with m.State("SAVE_DR"):
                m.d.comb += self.dr_rd_addr.eq(save_index[:4])
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(thread_base + ((DR_OFFSET + save_index) << 2)),
                    mem_wr_data_reg.eq(self.dr_rd_data),
                ]
                with m.If(self.mem_wr_done):
                    m.d.sync += save_index.eq(save_index + 1)
                    with m.If(save_index >= 15):
                        m.next = "SAVE_PACKED_PC"

            with m.State("SAVE_PACKED_PC"):
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(thread_base + (PACKED_PC_OFFSET << 2)),
                    mem_wr_data_reg.eq(packed_pc_word),
                ]
                with m.If(self.mem_wr_done):
                    m.next = "LOAD_THREAD"

            with m.State("LOAD_THREAD"):
                m.d.comb += [
                    mload_src.eq(self.cr_src),
                    mload_dst.eq(8),
                    mload_index.eq(index_latched),
                ]
                m.d.sync += mload_start_reg.eq(1)
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(u_mload.sub_done):
                    m.d.sync += mload_done_latched.eq(1)
                    m.d.sync += fetched_gt_latched.eq(self.cr_rd_data.as_value()[:32])
                with m.If(u_mload.sub_fault):
                    m.d.sync += mload_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(mload_fault_latched):
                    m.next = "FAULT"
                with m.Elif(mload_done_latched):
                    m.d.sync += cr_index.eq(0)
                    m.next = "RESTORE_CALL"

            with m.State("RESTORE_CALL"):
                m.d.comb += [
                    mload_src.eq(8),
                    mload_dst.eq(cr_index),
                    mload_index.eq(cr_index),
                ]
                with m.If(skip_current_cr):
                    m.d.sync += cr_index.eq(cr_index + 1)
                    with m.If(cr_index >= 14):
                        m.next = "COMPLETE"
                with m.Else():
                    m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                    m.d.sync += mload_start_reg.eq(1)
                    with m.If(u_mload.sub_done):
                        m.d.sync += mload_done_latched.eq(1)
                    with m.If(u_mload.sub_fault):
                        m.d.sync += mload_fault_latched.eq(1)
                        m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                    with m.If(mload_fault_latched):
                        m.next = "FAULT"
                    with m.Elif(mload_done_latched):
                        m.next = "RESTORE_NEXT"

            with m.State("RESTORE_NEXT"):
                m.d.sync += cr_index.eq(cr_index + 1)
                with m.If(cr_index >= 14):
                    m.next = "COMPLETE"
                with m.Else():
                    m.next = "RESTORE_CALL"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.change_busy.eq(~fsm.ongoing("IDLE")),
            self.change_complete.eq(fsm.ongoing("COMPLETE")),
            self.change_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
