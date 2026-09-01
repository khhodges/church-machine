from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .perm_check import perm_bit
from .mload_seq import mload_wait_body
from .stack_frame import stack_slot_addr
from .thread_design import THREAD_STO_OFFSET


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
        # Latched return target remains visible through COMPLETE. The reset
        # boot ROM has no namespace-backed caller capability, so core uses this
        # to recognize the one valid return to its guard at byte NIA 0x0C.
        self.boot_rom_return = Signal()

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

        self.lambda_active = Signal()
        self.lambda_pc = Signal(32)
        self.lambda_clear = Signal()

        self.cr5_heap   = Signal(CAP_REG_LAYOUT)
        self.cr12_thread = Signal(CAP_REG_LAYOUT)
        self.thread_base = Signal(32)

        self.mem_rd_addr  = Signal(32)
        self.mem_rd_en    = Signal()
        self.mem_rd_data  = Signal(32)
        self.mem_rd_valid = Signal()

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en   = Signal()

        self.cload_e_gt = Signal(32)
        self.flags_restore_en = Signal()
        self.flags_restore_data = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        CR5_HEAP  = 5

        return_cap = Signal(CAP_REG_LAYOUT)
        ret_view   = View(CAP_REG_LAYOUT, return_cap)
        ret_gt     = View(GT_LAYOUT, ret_view.word0_gt)

        has_e_perm = perm_bit(ret_view.word0_gt, PERM_E)
        is_null_cap = Signal()
        m.d.comb += is_null_cap.eq(ret_gt.gt_type == GT_TYPE_NULL)

        cr5_view  = View(CAP_REG_LAYOUT, self.cr5_heap)
        cr5_gt    = View(GT_LAYOUT, cr5_view.word0_gt)
        cr5_null  = Signal()
        cr5_has_r = Signal()
        cr5_has_w = Signal()
        m.d.comb += [
            cr5_null.eq(cr5_gt.gt_type == GT_TYPE_NULL),
            cr5_has_r.eq(~cr5_gt.dom & cr5_gt.perm[PERM_R]),   # Turing dom=0, perm[0]=R
            cr5_has_w.eq(~cr5_gt.dom & cr5_gt.perm[PERM_W]),   # Turing dom=0, perm[1]=W
        ]

        cr12_view = View(CAP_REG_LAYOUT, self.cr12_thread)
        cr12_gt   = View(GT_LAYOUT, cr12_view.word0_gt)
        cr12_null = Signal()
        m.d.comb += cr12_null.eq(cr12_gt.gt_type == GT_TYPE_NULL)

        heap_base_latched   = Signal(32)
        thread_base_latched = Signal(32)
        protected_sto_addr  = Signal(32)
        m.d.comb += protected_sto_addr.eq(
            thread_base_latched + (THREAD_STO_OFFSET << 2))

        sto_indicator      = Signal(32)
        sto_latched        = Signal(12)
        callee_egt_latched = Signal(32)
        return_pc_latched  = Signal(15)
        prev_sto_latched   = Signal(12)
        prev_sz_latched    = Signal()
        prev_flags_latched = Signal(COND_FLAGS_LAYOUT)

        frame_word    = Signal(32)
        frame_sz      = Signal()
        frame_ret_pc  = Signal(15)
        frame_prev_sto = Signal(16)
        m.d.comb += [
            frame_sz.eq(frame_word[12]),
            frame_ret_pc.eq(frame_word[13:28]),
            frame_prev_sto.eq(frame_word[0:12]),
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
            self.mload_cr_dst.eq(0),
            self.mload_index.eq(0),
            self.mload_direct.eq(0),
            self.mload_direct_gt.eq(0),
            self.mload_m_elevated.eq(0),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(0),
            self.cr_wr_data.eq(0),
            self.cr_wr_en.eq(0),
        ]

        m.d.comb += self.cload_e_gt.eq(callee_egt_latched)
        m.d.comb += self.boot_rom_return.eq(return_pc_latched == 3)
        m.d.comb += [
            self.flags_restore_en.eq(0),
            self.flags_restore_data.eq(prev_flags_latched),
        ]

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
                    thread_base_latched.eq(self.thread_base),
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
                    m.next = "READ_STO"

            with m.State("READ_STO"):
                m.d.comb += [
                    local_mem_rd_addr.eq(protected_sto_addr),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += [
                        sto_indicator.eq(self.mem_rd_data),
                        sto_latched.eq(self.mem_rd_data[:12]),
                    ]
                    m.next = "READ_FRAME"

            with m.State("READ_FRAME"):
                m.d.comb += [
                    local_mem_rd_addr.eq(
                        thread_base_latched +
                        ((sto_latched + Mux(sto_indicator[12], 2, 1)) << 2)),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += frame_word.eq(self.mem_rd_data)
                    m.d.sync += [
                        return_pc_latched.eq(self.mem_rd_data[13:28]),
                        prev_sto_latched.eq(self.mem_rd_data[0:12]),
                        prev_sz_latched.eq(self.mem_rd_data[12]),
                        prev_flags_latched.eq(self.mem_rd_data[28:32]),
                    ]
                    with m.If(sto_indicator[12]):
                        m.next = "READ_EGT"
                    with m.Else():
                        m.next = "POP_STACK"

            with m.State("READ_EGT"):
                m.d.comb += [
                    local_mem_rd_addr.eq(stack_slot_addr(thread_base_latched, sto_latched, 1)),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += callee_egt_latched.eq(self.mem_rd_data)
                    m.next = "POP_STACK"

            with m.State("POP_STACK"):
                m.d.comb += [
                    local_mem_wr_addr.eq(protected_sto_addr),
                    local_mem_wr_data.eq(Cat(
                        prev_sto_latched, prev_sz_latched,
                        Const(0, 15), prev_flags_latched.as_value())),
                    local_mem_wr_en.eq(1),
                    self.flags_restore_en.eq(1),
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
