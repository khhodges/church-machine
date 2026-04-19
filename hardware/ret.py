from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchReturn(Elaboratable):
    def __init__(self):
        self.return_start = Signal()
        self.cr_src = Signal(3)
        self.busy = Signal()
        self.complete = Signal()
        self.fault_valid = Signal()
        self.fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18
        self.reboot_request = Signal()

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.nia_set = Signal()
        self.nia_value = Signal(32)

        self.mload_start = Signal()
        self.mload_cr_src = Signal(4)
        self.mload_cr_dst = Signal(4)
        self.mload_index = Signal(16)
        self.mload_direct = Signal()
        self.mload_direct_gt = Signal(32)
        self.mload_m_elevated = Signal()

        self.mload_done = Signal()
        self.mload_fault = Signal()
        self.mload_fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18

        self.saved_cr5_gt = Signal(32)

        self.lambda_active = Signal()
        self.lambda_pc = Signal(32)
        self.lambda_clear = Signal()

        self.cr5_heap   = Signal(CAP_REG_LAYOUT)
        self.cr12_thread = Signal(CAP_REG_LAYOUT)

        self.mem_rd_addr  = Signal(32)
        self.mem_rd_en    = Signal()
        self.mem_rd_data  = Signal(32)
        self.mem_rd_valid = Signal()

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en   = Signal()

        self.cload_e_gt = Signal(32)

    def elaborate(self, platform):
        m = Module()

        CR5_HEAP  = 5

        return_cap = Signal(CAP_REG_LAYOUT)
        ret_view   = View(CAP_REG_LAYOUT, return_cap)
        ret_gt     = View(GT_LAYOUT, ret_view.word0_gt)

        has_e_perm = ret_gt.perms[PERM_E]
        is_null_cap = Signal()
        m.d.comb += is_null_cap.eq(ret_gt.gt_type == GT_TYPE_NULL)

        cr5_view  = View(CAP_REG_LAYOUT, self.cr5_heap)
        cr5_gt    = View(GT_LAYOUT, cr5_view.word0_gt)
        cr5_null  = Signal()
        cr5_has_r = Signal()
        cr5_has_w = Signal()
        m.d.comb += [
            cr5_null.eq(cr5_gt.gt_type == GT_TYPE_NULL),
            cr5_has_r.eq(cr5_gt.perms[PERM_R]),
            cr5_has_w.eq(cr5_gt.perms[PERM_W]),
        ]

        cr12_view = View(CAP_REG_LAYOUT, self.cr12_thread)
        cr12_gt   = View(GT_LAYOUT, cr12_view.word0_gt)
        cr12_null = Signal()
        m.d.comb += cr12_null.eq(cr12_gt.gt_type == GT_TYPE_NULL)

        heap_base_latched   = Signal(32)
        thread_base_latched = Signal(32)

        sto_latched        = Signal(32)
        callee_egt_latched = Signal(32)
        return_pc_latched  = Signal(15)
        prev_sto_latched   = Signal(16)

        frame_word    = Signal(32)
        frame_sz      = Signal()
        frame_ret_pc  = Signal(15)
        frame_prev_sto = Signal(16)
        m.d.comb += [
            frame_sz.eq(frame_word[31]),
            frame_ret_pc.eq(frame_word[16:31]),
            frame_prev_sto.eq(frame_word[0:16]),
        ]

        local_cr_rd_en = Signal()
        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, Cat(self.cr_src, Const(0, 1)), 0)
        )

        local_mem_rd_addr = Signal(32)
        local_mem_rd_en   = Signal()
        local_mem_wr_addr = Signal(32)
        local_mem_wr_data = Signal(32)
        local_mem_wr_en   = Signal()
        m.d.comb += [
            self.mem_rd_addr.eq(local_mem_rd_addr),
            self.mem_rd_en.eq(local_mem_rd_en),
            self.mem_wr_addr.eq(local_mem_wr_addr),
            self.mem_wr_data.eq(local_mem_wr_data),
            self.mem_wr_en.eq(local_mem_wr_en),
        ]

        m.d.comb += [
            self.mload_start.eq(0),
            self.mload_cr_src.eq(0),
            self.mload_cr_dst.eq(CR5_HEAP),
            self.mload_index.eq(0),
            self.mload_direct.eq(1),
            self.mload_direct_gt.eq(self.saved_cr5_gt),
            self.mload_m_elevated.eq(1),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(0),
            self.cr_wr_data.eq(0),
            self.cr_wr_en.eq(0),
        ]

        m.d.comb += self.cload_e_gt.eq(callee_egt_latched)

        sub_start_reg     = Signal()
        sub_done_latched  = Signal()
        sub_fault_latched = Signal()
        fault_flag        = Signal()
        fault_latched     = Signal(5)  # 5 bits: FaultType values up to 0x18

        with m.FSM(name="ret") as fsm:

            with m.State("IDLE"):
                m.d.sync += [
                    fault_flag.eq(0), fault_latched.eq(FaultType.NONE),
                    sub_done_latched.eq(0), sub_fault_latched.eq(0),
                    callee_egt_latched.eq(0),
                ]
                with m.If(self.return_start):
                    with m.If(self.lambda_active):
                        m.next = "LAMBDA_FAST"
                    with m.Else():
                        m.next = "READ_SRC"

            with m.State("LAMBDA_FAST"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(self.lambda_pc),
                    self.lambda_clear.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("READ_SRC"):
                m.d.comb += local_cr_rd_en.eq(1)
                m.d.sync += [
                    return_cap.eq(self.cr_rd_data),
                    heap_base_latched.eq(cr5_view.word1_location),
                    thread_base_latched.eq(cr12_view.word1_location),
                ]
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(is_null_cap):
                    m.next = "REBOOT"
                with m.Elif(~has_e_perm):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_CR5_CR12"

            with m.State("CHECK_CR5_CR12"):
                with m.If(cr5_null):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Elif(~cr5_has_r):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_R)]
                    m.next = "FAULT"
                with m.Elif(~cr5_has_w):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_W)]
                    m.next = "FAULT"
                with m.Elif(cr12_null):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_HEAP"

            with m.State("READ_HEAP"):
                m.d.comb += [
                    local_mem_rd_addr.eq(heap_base_latched),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += sto_latched.eq(self.mem_rd_data)
                    m.next = "READ_FRAME"

            with m.State("READ_FRAME"):
                m.d.comb += [
                    local_mem_rd_addr.eq(thread_base_latched + ((sto_latched + 2) << 2)),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += frame_word.eq(self.mem_rd_data)
                    with m.If(~self.mem_rd_data[31]):
                        m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.STACK_CORRUPT)]
                        m.next = "FAULT"
                    with m.Else():
                        m.d.sync += [
                            return_pc_latched.eq(self.mem_rd_data[16:31]),
                            prev_sto_latched.eq(self.mem_rd_data[0:16]),
                        ]
                        m.next = "READ_EGT"

            with m.State("READ_EGT"):
                m.d.comb += [
                    local_mem_rd_addr.eq(thread_base_latched + ((sto_latched + 1) << 2)),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += callee_egt_latched.eq(self.mem_rd_data)
                    m.d.sync += sub_start_reg.eq(1)
                    m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                    m.next = "RESTORE_CR5"

            with m.State("RESTORE_CR5"):
                m.d.comb += self.mload_start.eq(sub_start_reg)
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "POP_STACK"

            with m.State("POP_STACK"):
                m.d.comb += [
                    local_mem_wr_addr.eq(heap_base_latched),
                    local_mem_wr_data.eq(Cat(prev_sto_latched, Const(0, 16))),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "SET_NIA"

            with m.State("SET_NIA"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(return_pc_latched << 2),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("REBOOT"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault_valid.eq(fault_flag),
            self.fault_type.eq(fault_latched),
            self.reboot_request.eq(fsm.ongoing("REBOOT")),
        ]

        return m
