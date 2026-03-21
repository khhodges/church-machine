from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import ChurchMLoad


class ChurchELoadCall(Elaboratable):
    def __init__(self):
        self.start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.mask = Signal(16)
        self.busy = Signal()
        self.complete = Signal()
        self.fault = Signal()
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

        self.saved_cr5_gt = Signal(32)

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.dr_clear_mask = Signal(16)
        self.cr_clear_mask = Signal(16)

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST = 6
        CR7_NUCLEUS = 7
        MAX_SRC_REG = 5

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        phase = Signal(2)
        loaded_cap = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(16)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        loaded_view = View(CAP_REG_LAYOUT, loaded_cap)
        loaded_gt = View(GT_LAYOUT, loaded_view.word0_gt)
        has_e_perm = loaded_gt.perms[PERM_E]

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        with m.Switch(phase):
            with m.Case(0):
                m.d.comb += [
                    mload_src.eq(self.cr_src),
                    mload_dst.eq(self.cr_dst),
                    mload_index.eq(self.index),
                ]
            with m.Case(1):
                m.d.comb += [
                    mload_src.eq(self.cr_dst),
                    mload_dst.eq(CR6_CLIST),
                    mload_index.eq(0),
                ]
            with m.Default():
                m.d.comb += [
                    mload_src.eq(CR6_CLIST),
                    mload_dst.eq(CR7_NUCLEUS),
                    mload_index.eq(0),
                ]

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_m_elevated.eq(mload_src == CR_CLIST),
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
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr)
        )
        m.d.comb += sub_start.eq(sub_start_reg)

        cr_preserve = mask_latched[5:11]
        dr1_5_preserve = mask_latched[0:5]

        dr_clear_computed = Signal(16)
        cr_clear_computed = Signal(16)
        m.d.comb += [
            dr_clear_computed.eq(Cat(Const(0, 1), ~dr1_5_preserve, Const(0x3FF, 10))),
            cr_clear_computed.eq(Cat(~cr_preserve, Const(0, 10))),
        ]

        with m.FSM(name="eloadcall") as fsm:
            with m.State("IDLE"):
                m.d.sync += [
                    phase.eq(0), fault_latched.eq(0),
                    fault_type_latched.eq(FaultType.NONE),
                    sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += mask_latched.eq(self.mask)
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                with m.If(~src_in_range):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_L),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "LOAD_PHASE"

            with m.State("LOAD_PHASE"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(u_mload.sub_fault_type),
                    ]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "LOAD_DONE"

            with m.State("LOAD_DONE"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_dst)]
                m.d.sync += loaded_cap.eq(self.cr_rd_data)
                m.next = "CHECK_E"

            with m.State("CHECK_E"):
                with m.If(~has_e_perm):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_E),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(5)]
                    m.next = "READ_CR5"

            with m.State("READ_CR5"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(5)]
                cr5_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
                m.d.sync += self.saved_cr5_gt.eq(cr5_view.word0_gt)
                m.d.sync += [
                    phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "CALL_P1"

            with m.State("CALL_P1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(u_mload.sub_fault_type),
                    ]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "CALL_P1_DONE"

            with m.State("CALL_P1_DONE"):
                m.d.sync += [
                    phase.eq(2), sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "CALL_P2"

            with m.State("CALL_P2"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(u_mload.sub_fault_type),
                    ]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(0),
            self.dr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), dr_clear_computed, 0)),
            self.cr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), cr_clear_computed, 0)),
        ]

        return m


class ChurchXLoadLambda(Elaboratable):
    def __init__(self):
        self.start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.busy = Signal()
        self.complete = Signal()
        self.fault = Signal()
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

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.saved_nia = Signal(32)

    def elaborate(self, platform):
        m = Module()

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        loaded_cap = Signal(CAP_REG_LAYOUT)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        loaded_view = View(CAP_REG_LAYOUT, loaded_cap)
        loaded_gt = View(GT_LAYOUT, loaded_view.word0_gt)
        has_x_perm = loaded_gt.perms[PERM_X]
        is_null = Signal()
        m.d.comb += is_null.eq(loaded_gt.gt_type == GT_TYPE_NULL)

        m.d.comb += [
            u_mload.sub_start.eq(sub_start_reg),
            u_mload.sub_cr_src.eq(self.cr_src),
            u_mload.sub_cr_dst.eq(self.cr_dst),
            u_mload.sub_index.eq(self.index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_m_elevated.eq(self.cr_src == CR_CLIST),
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
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr)
        )

        with m.FSM(name="xloadlambda") as fsm:
            with m.State("IDLE"):
                m.d.sync += [
                    fault_latched.eq(0),
                    fault_type_latched.eq(FaultType.NONE),
                    sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "LOAD_PHASE"

            with m.State("LOAD_PHASE"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(u_mload.sub_fault_type),
                    ]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "LOAD_DONE"

            with m.State("LOAD_DONE"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_dst)]
                m.d.sync += loaded_cap.eq(self.cr_rd_data)
                m.next = "CHECK_X"

            with m.State("CHECK_X"):
                with m.If(is_null):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.NULL_CAP),
                    ]
                    m.next = "FAULT"
                with m.Elif(~has_x_perm):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_X),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "EXECUTE"

            with m.State("EXECUTE"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(loaded_view.word1_location[:32]),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
