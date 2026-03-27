from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT


class ChurchRegisters(Elaboratable):
    """Pure Church Machine register file.

    16 Capability Registers (CR0-CR15): 128-bit each, hold Golden Tokens.
    16 Data Registers (DR0-DR15): 32-bit each, for method selectors and return values.
    Condition Flags (N, Z, C, V): ARM-style, used for conditional execution.

    DR count reduced from 32 to 16 — no RV32I ALU needs x0-x31.
    DR0 is hardwired to zero (same convention as RISC-V x0).
    """

    def __init__(self):
        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.cr_word_wr_addr = Signal(4)
        self.cr_word_sel = Signal(2)
        self.cr_word_wr_data = Signal(32)
        self.cr_word_wr_en = Signal()

        self.cr_word_rd_addr = Signal(4)
        self.cr_word_rd_sel = Signal(2)
        self.cr_word_rd_data = Signal(32)

        self.cr5_heap = Signal(CAP_REG_LAYOUT)
        self.cr6_clist = Signal(CAP_REG_LAYOUT)
        self.cr7_cloomc = Signal(CAP_REG_LAYOUT)
        self.cr12_thread = Signal(CAP_REG_LAYOUT)
        self.cr14_code = Signal(CAP_REG_LAYOUT)
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.cr_gt_wr_data = [Signal(GT_LAYOUT, name=f"cr{i}_gt_wr_data") for i in range(16)]
        self.cr_gt_wr_en = [Signal(name=f"cr{i}_gt_wr_en") for i in range(16)]

        self.dr_rd_addr1 = Signal(4)
        self.dr_rd_data1 = Signal(32)
        self.dr_rd_addr2 = Signal(4)
        self.dr_rd_data2 = Signal(32)
        self.dr_wr_addr = Signal(4)
        self.dr_wr_data = Signal(32)
        self.dr_wr_en = Signal()

        self.flags = Signal(COND_FLAGS_LAYOUT)
        self.flags_in = Signal(COND_FLAGS_LAYOUT)
        self.flags_wr_en = Signal()

        self.clear_all = Signal()

    def elaborate(self, platform):
        m = Module()

        cap_regs = Array([Signal(CAP_REG_LAYOUT, name=f"cr{i}") for i in range(NUM_CAP_REGS)])
        data_regs = Array([Signal(32, name=f"dr{i}") for i in range(NUM_DATA_REGS)])
        flags_reg = Signal(COND_FLAGS_LAYOUT)

        m.d.comb += self.cr_rd_data.eq(cap_regs[self.cr_rd_addr])

        with m.Switch(self.cr_word_rd_sel):
            with m.Case(0):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word0_gt)
            with m.Case(1):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word1_location)
            with m.Case(2):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word2_w2)
            with m.Case(3):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word3_w3)

        m.d.comb += [
            self.cr5_heap.eq(cap_regs[CR_HEAP]),
            self.cr6_clist.eq(cap_regs[CR_CLIST]),
            self.cr7_cloomc.eq(cap_regs[CR_CLOOMC]),
            self.cr12_thread.eq(cap_regs[CR_THREAD]),
            self.cr14_code.eq(cap_regs[14]),
            self.cr15_namespace.eq(cap_regs[CR_NAMESPACE]),
        ]

        with m.If(self.clear_all):
            for i in range(NUM_CAP_REGS):
                m.d.sync += cap_regs[i].eq(0)
            for i in range(NUM_DATA_REGS):
                m.d.sync += data_regs[i].eq(0)
            m.d.sync += flags_reg.eq(0)
        with m.Else():
            with m.If(self.cr_wr_en):
                m.d.sync += cap_regs[self.cr_wr_addr].eq(self.cr_wr_data)

            with m.If(self.cr_word_wr_en):
                wr_view = View(CAP_REG_LAYOUT, cap_regs[self.cr_word_wr_addr])
                with m.Switch(self.cr_word_sel):
                    with m.Case(0):
                        m.d.sync += wr_view.word0_gt.eq(self.cr_word_wr_data)
                    with m.Case(1):
                        m.d.sync += wr_view.word1_location.eq(self.cr_word_wr_data)
                    with m.Case(2):
                        m.d.sync += wr_view.word2_w2.eq(self.cr_word_wr_data)
                    with m.Case(3):
                        m.d.sync += wr_view.word3_w3.eq(self.cr_word_wr_data)

            for i in range(NUM_CAP_REGS):
                with m.If(self.cr_gt_wr_en[i]):
                    cr_view = View(CAP_REG_LAYOUT, cap_regs[i])
                    m.d.sync += cr_view.word0_gt.eq(self.cr_gt_wr_data[i])

            with m.If(self.dr_wr_en & (self.dr_wr_addr != 0)):
                m.d.sync += data_regs[self.dr_wr_addr].eq(self.dr_wr_data)

            with m.If(self.flags_wr_en):
                m.d.sync += flags_reg.eq(self.flags_in)

        m.d.comb += [
            self.dr_rd_data1.eq(Mux(self.dr_rd_addr1 == 0, 0, data_regs[self.dr_rd_addr1])),
            self.dr_rd_data2.eq(Mux(self.dr_rd_addr2 == 0, 0, data_regs[self.dr_rd_addr2])),
            self.flags.eq(flags_reg),
        ]

        return m
