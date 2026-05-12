from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT


class CMCapRegisters(Elaboratable):
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

        self.cr6_clist = Signal(CAP_REG_LAYOUT)
        self.cr14_cloomc = Signal(CAP_REG_LAYOUT)
        self.cr8_thread = Signal(CAP_REG_LAYOUT)
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.cr_gt_wr_data = [Signal(GT_LAYOUT, name=f"cr{i}_gt_wr_data") for i in range(16)]
        self.cr_gt_wr_en = [Signal(name=f"cr{i}_gt_wr_en") for i in range(16)]

        self.xr_rd_addr1 = Signal(5)
        self.xr_rd_data1 = Signal(32)
        self.xr_rd_addr2 = Signal(5)
        self.xr_rd_data2 = Signal(32)
        self.xr_wr_addr = Signal(5)
        self.xr_wr_data = Signal(32)
        self.xr_wr_en = Signal()

        self.flags = Signal(COND_FLAGS_LAYOUT)
        self.flags_in = Signal(COND_FLAGS_LAYOUT)
        self.flags_wr_en = Signal()

        self.clear_all = Signal()

        # M-window controls — CR15 M-flag
        # m_set_en:         populate XR11-XR15 from m_set_dr11-15, set cr15_m_flag
        # m_clear_en:       clear cr15_m_flag (no writeback; used on fault path)
        # m_flag_restore_en: CHANGE restore: set cr15_m_flag = m_flag_restore_val (no XR copy)
        self.m_set_en          = Signal()
        self.m_clear_en        = Signal()
        self.m_flag_restore_en  = Signal()
        self.m_flag_restore_val = Signal()

        # Data sources for M-window shadow (XR11-XR15) — driven by core
        self.m_set_dr11 = Signal(32)   # raw Abstract GT word (word0_gt of src cap)
        self.m_set_dr12 = Signal(32)   # NS entry word0_location
        self.m_set_dr13 = Signal(32)   # NS entry word1_limit (authority)
        self.m_set_dr14 = Signal(32)   # NS entry word2_integrity
        self.m_set_dr15 = Signal(32)   # NS entry word3_abstract_gt (advisory seals)

        # Combinatorial read of the M-window XRs (always valid).
        # XR11 = GT word, XR12 = NS_location, XR13 = NS_limit (authority),
        # XR14 = NS_integrity (4-word core shadow for WRITEBACK).
        # XR15 = NS_seals (advisory; 0 when set via cr15_m_set test port).
        self.m_xr11 = Signal(32)
        self.m_xr12 = Signal(32)
        self.m_xr13 = Signal(32)
        self.m_xr14 = Signal(32)   # added for Task #440: 5-word M-window shadow
        self.m_xr15 = Signal(32)   # NS_seals advisory; 0 on cr15_m_set path

        # Current M-flag state (combinatorial from cr15_m_reg)
        self.cr15_m_flag = Signal()

    def elaborate(self, platform):
        m = Module()

        cap_regs = Array([Signal(CAP_REG_LAYOUT, name=f"cr{i}") for i in range(NUM_CAP_REGS)])
        data_regs = Array([Signal(32, name=f"x{i}") for i in range(NUM_DATA_REGS)])
        flags_reg = Signal(COND_FLAGS_LAYOUT)

        # M-flag latch — only CR15 can have M=1
        cr15_m_reg = Signal()

        m.d.comb += self.cr_rd_data.eq(cap_regs[self.cr_rd_addr])

        with m.Switch(self.cr_word_rd_sel):
            with m.Case(0):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word0_gt)
            with m.Case(1):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word1_location)
            with m.Case(2):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word2_limit)
            with m.Case(3):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word3_seals)

        m.d.comb += [
            self.cr6_clist.eq(cap_regs[CR_CLIST]),
            self.cr14_cloomc.eq(cap_regs[CR_CLOOMC]),
            self.cr8_thread.eq(cap_regs[CR_THREAD]),
            self.cr15_namespace.eq(cap_regs[CR_NAMESPACE]),
        ]

        # M-window: combinatorial reads of XR11-XR15
        m.d.comb += [
            self.m_xr11.eq(data_regs[11]),
            self.m_xr12.eq(data_regs[12]),
            self.m_xr13.eq(data_regs[13]),
            self.m_xr14.eq(data_regs[14]),
            self.m_xr15.eq(data_regs[15]),
            self.cr15_m_flag.eq(cr15_m_reg),
        ]

        with m.If(self.clear_all):
            for i in range(NUM_CAP_REGS):
                m.d.sync += cap_regs[i].eq(0)
            for i in range(NUM_DATA_REGS):
                m.d.sync += data_regs[i].eq(0)
            m.d.sync += flags_reg.eq(0)
            m.d.sync += cr15_m_reg.eq(0)
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
                        m.d.sync += wr_view.word2_limit.eq(self.cr_word_wr_data)
                    with m.Case(3):
                        m.d.sync += wr_view.word3_seals.eq(self.cr_word_wr_data)

            for i in range(NUM_CAP_REGS):
                with m.If(self.cr_gt_wr_en[i]):
                    cr_view = View(CAP_REG_LAYOUT, cap_regs[i])
                    m.d.sync += cr_view.word0_gt.eq(self.cr_gt_wr_data[i])

            # Normal XR write (lower priority than m_set_en for XR11-XR15)
            with m.If(self.xr_wr_en & (self.xr_wr_addr != 0)):
                m.d.sync += data_regs[self.xr_wr_addr].eq(self.xr_wr_data)

            # M-set: populate XR11-XR15 from m_set_dr11-15 inputs, set flag.
            # Placed AFTER xr_wr_en so m_set_en wins for XR11-XR15.
            with m.If(self.m_set_en):
                m.d.sync += cr15_m_reg.eq(1)
                m.d.sync += data_regs[11].eq(self.m_set_dr11)
                m.d.sync += data_regs[12].eq(self.m_set_dr12)
                m.d.sync += data_regs[13].eq(self.m_set_dr13)
                m.d.sync += data_regs[14].eq(self.m_set_dr14)
                m.d.sync += data_regs[15].eq(self.m_set_dr15)
            with m.Elif(self.m_clear_en):
                m.d.sync += cr15_m_reg.eq(0)
            # CHANGE restore: set M-flag to saved value (no XR copy); lower priority
            # than m_set_en/m_clear_en which come from the M-window FSM.
            with m.Elif(self.m_flag_restore_en):
                m.d.sync += cr15_m_reg.eq(self.m_flag_restore_val)

            with m.If(self.flags_wr_en):
                m.d.sync += flags_reg.eq(self.flags_in)

        m.d.comb += [
            self.xr_rd_data1.eq(Mux(self.xr_rd_addr1 == 0, 0, data_regs[self.xr_rd_addr1])),
            self.xr_rd_data2.eq(Mux(self.xr_rd_addr2 == 0, 0, data_regs[self.xr_rd_addr2])),
            self.flags.eq(flags_reg),
        ]

        return m
