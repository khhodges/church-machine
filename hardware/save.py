from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .msave import ChurchMSave


class ChurchSave(Elaboratable):
    def __init__(self):
        self.save_start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.save_busy = Signal()
        self.save_complete = Signal()
        self.save_fault = Signal()
        self.fault_type = Signal(5)
        # Per-CR M authority is sampled with the accepted instruction.  A
        # successful isolated SAVE pulses m_consume_en so the register file can
        # consume exactly that source bit; fault paths never pulse it.
        self.source_m = Signal()
        self.m_consume_en = Signal()
        self.m_consume_target = Signal(2)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        MAX_CLIST_REG = 6

        u_msave = ChurchMSave()
        m.submodules.u_msave = u_msave

        dst_reg_latched = Signal(CAP_REG_LAYOUT)
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        immutable_row0_latched = Signal()
        isolated_source_latched = Signal()
        source_m_latched = Signal()
        source_reg_latched = Signal(4)
        dst_reg_num_latched = Signal(4)
        index_latched = Signal(16)
        fault_latched = Signal()
        fault_type_latched = Signal(5)
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        dst_in_range = Signal()
        m.d.comb += dst_in_range.eq(dst_reg_num_latched <= MAX_CLIST_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)

        m.d.comb += [
            u_msave.sub_start.eq(sub_start),
            u_msave.sub_dst_cap.eq(dst_reg_latched),
            u_msave.sub_src_gt.eq(src_view.word0_gt),
            u_msave.sub_index.eq(index_latched),
            u_msave.sub_src_m_elevated.eq(
                isolated_source_latched & source_m_latched),
            # CR6 is the active c-list register. Its row 0 is the immutable
            # resident identity; other architectural c-list registers retain
            # their existing SAVE semantics.
            u_msave.sub_immutable_row0.eq(immutable_row0_latched),
            u_msave.mem_wr_done.eq(self.mem_wr_done),
            u_msave.cr15_namespace.eq(self.cr15_namespace),
            u_msave.mem_rd_data.eq(self.mem_rd_data),
            u_msave.mem_rd_valid.eq(self.mem_rd_valid),
        ]
        m.d.comb += [
            self.mem_wr_addr.eq(u_msave.mem_wr_addr),
            self.mem_wr_data.eq(u_msave.mem_wr_data),
            self.mem_wr_en.eq(u_msave.mem_wr_en),
            self.mem_rd_addr.eq(u_msave.mem_rd_addr),
            self.mem_rd_en.eq(u_msave.mem_rd_en),
        ]
        m.d.comb += sub_start.eq(sub_start_reg)

        with m.FSM(name="save_wrapper") as fsm:
            with m.State("IDLE"):
                m.d.sync += [
                    fault_latched.eq(0),
                    fault_type_latched.eq(FaultType.NONE),
                ]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.save_start):
                    # Capture the instruction's CR6 identity at acceptance.
                    # Decoder inputs may advance while this multi-cycle SAVE
                    # is running, so the sub-unit must never inspect them live.
                    m.d.sync += [
                        immutable_row0_latched.eq(self.cr_src == CR_CLIST),
                        isolated_source_latched.eq(
                            (self.cr_dst >= 12) & (self.cr_dst <= 15)),
                        source_m_latched.eq(self.source_m),
                        source_reg_latched.eq(self.cr_dst),
                        dst_reg_num_latched.eq(self.cr_src),
                        index_latched.eq(self.index),
                    ]
                    m.next = "CHECK_SOURCE_M"

            with m.State("CHECK_SOURCE_M"):
                with m.If(isolated_source_latched & ~source_m_latched):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_L),
                    ]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "CHECK_DST_READ"

            with m.State("CHECK_DST_READ"):
                m.d.comb += self.cr_rd_addr.eq(dst_reg_num_latched)
                with m.If(~dst_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Else():
                    m.next = "LATCH_DST"

            with m.State("LATCH_DST"):
                m.d.comb += self.cr_rd_addr.eq(dst_reg_num_latched)
                m.d.sync += dst_reg_latched.eq(self.cr_rd_data)
                m.next = "LATCH_SRC"

            with m.State("LATCH_SRC"):
                m.d.comb += self.cr_rd_addr.eq(source_reg_latched)
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
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
                    m.next = "IDLE"
                with m.Elif(sub_fault_latched):
                    m.next = "IDLE"

        m.d.comb += [
            self.save_busy.eq(~fsm.ongoing("IDLE")),
            self.save_complete.eq(fsm.ongoing("CALL_SUB") & sub_done_latched),
            self.save_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.m_consume_en.eq(
                fsm.ongoing("CALL_SUB") & sub_done_latched &
                isolated_source_latched),
            self.m_consume_target.eq(source_reg_latched - 12),
        ]

        return m
