from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT


class ChurchRegisters(Elaboratable):
    """Pure Church Machine register file.

    16 Capability Registers (CR0-CR15): 96-bit each (3 × 32), hold Golden Tokens.
    16 Data Registers (DR0-DR15): 32-bit each, for method selectors and return values.
    Condition Flags (N, Z, C, V): ARM-style, used for conditional execution.

    DR count is 16 — CTMM has no general-purpose integer ALU requiring x0-x31.
    DR0 is hardwired to zero (the CTMM zero register).
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
        self.cr12_thread = Signal(CAP_REG_LAYOUT)
        self.cr13_interrupt = Signal(CAP_REG_LAYOUT)
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

        # Parallel B-flag and null-write masks (CR0-CR11 only, one bit per register)
        # cr_b_clear_mask: bit N=1 → clear b_flag (bit 31 of word0_gt) on CRN in one cycle
        # cr_null_mask:    bit N=1 → write NULL (all zeros) to CRN in one cycle
        # By construction CALL drives these mutually exclusive (preserved ↔ non-preserved).
        self.cr_b_clear_mask = Signal(12)
        self.cr_null_mask    = Signal(12)

        # M-window controls — CR15 M-flag
        # m_set_en:          populate DR11-DR15 from m_set_dr11-15, set cr15_m_flag
        # m_clear_en:        clear cr15_m_flag (no writeback; used on fault path)
        # m_flag_restore_en: CHANGE restore: set cr15_m_flag = m_flag_restore_val (no DR copy)
        self.m_set_en          = Signal()
        self.m_clear_en        = Signal()
        self.m_flag_restore_en  = Signal()
        self.m_flag_restore_val = Signal()

        # M-set data words: driven by core when m_set_en fires.
        # For CALL M-GT path:  dr11=GT_word, dr12=NS_location, dr13=NS_authority,
        #                      dr14=NS_integrity, dr15=NS_seals (word3_abstract_gt)
        # For cr15_m_set port: dr11-14 sourced from CR15 fields + computed integrity32; dr15=0
        self.m_set_dr11 = Signal(32)
        self.m_set_dr12 = Signal(32)
        self.m_set_dr13 = Signal(32)
        self.m_set_dr14 = Signal(32)
        self.m_set_dr15 = Signal(32)

        # Combinatorial reads of the M-window DRs (always valid)
        self.m_dr11 = Signal(32)
        self.m_dr12 = Signal(32)
        self.m_dr13 = Signal(32)
        self.m_dr14 = Signal(32)
        self.m_dr15 = Signal(32)

        # Current M-flag state
        self.cr15_m_flag = Signal()

    def elaborate(self, platform):
        m = Module()

        cap_regs = Array([Signal(CAP_REG_LAYOUT, name=f"cr{i}") for i in range(NUM_CAP_REGS)])
        data_regs = Array([Signal(32, name=f"dr{i}") for i in range(NUM_DATA_REGS)])
        flags_reg = Signal(COND_FLAGS_LAYOUT)

        # M-flag latch — single bit associated with CR15 only
        cr15_m_reg = Signal()

        m.d.comb += self.cr_rd_data.eq(cap_regs[self.cr_rd_addr])

        with m.Switch(self.cr_word_rd_sel):
            with m.Case(0):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word0_gt)
            with m.Case(1):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word1_location)
            with m.Case(2):
                m.d.comb += self.cr_word_rd_data.eq(View(CAP_REG_LAYOUT, cap_regs[self.cr_word_rd_addr]).word2_w2)
            with m.Default():
                m.d.comb += self.cr_word_rd_data.eq(0)

        m.d.comb += [
            self.cr5_heap.eq(cap_regs[CR_HEAP]),
            self.cr6_clist.eq(cap_regs[CR_CLIST]),
            self.cr12_thread.eq(cap_regs[CR_THREAD_STACK]),
            self.cr13_interrupt.eq(cap_regs[CR_INTERRUPT]),
            self.cr14_code.eq(cap_regs[CR_CLOOMC]),
            self.cr15_namespace.eq(cap_regs[CR_NAMESPACE]),
        ]

        # M-window: combinatorial DR11-DR15 reads and flag output
        m.d.comb += [
            self.m_dr11.eq(data_regs[11]),
            self.m_dr12.eq(data_regs[12]),
            self.m_dr13.eq(data_regs[13]),
            self.m_dr14.eq(data_regs[14]),
            self.m_dr15.eq(data_regs[15]),
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
                        m.d.sync += wr_view.word2_w2.eq(self.cr_word_wr_data)

            for i in range(NUM_CAP_REGS):
                with m.If(self.cr_gt_wr_en[i]):
                    cr_view = View(CAP_REG_LAYOUT, cap_regs[i])
                    m.d.sync += cr_view.word0_gt.eq(self.cr_gt_wr_data[i])

            # Parallel B-flag clear: cr_null_mask takes priority (it zeros the whole register)
            for i in range(12):
                with m.If(self.cr_null_mask[i]):
                    m.d.sync += cap_regs[i].eq(0)
                with m.Elif(self.cr_b_clear_mask[i]):
                    cr_view = View(CAP_REG_LAYOUT, cap_regs[i])
                    m.d.sync += cr_view.word0_gt.b_flag.eq(0)

            # Normal DR write (lower priority than m_set_en for DR11-DR13)
            with m.If(self.dr_wr_en & (self.dr_wr_addr != 0)):
                m.d.sync += data_regs[self.dr_wr_addr].eq(self.dr_wr_data)

            # M-set: populate DR11-DR15 from m_set_dr11-15 inputs, set flag.
            # Placed AFTER dr_wr_en so m_set_en takes priority for DR11-DR15.
            with m.If(self.m_set_en):
                m.d.sync += cr15_m_reg.eq(1)
                m.d.sync += data_regs[11].eq(self.m_set_dr11)
                m.d.sync += data_regs[12].eq(self.m_set_dr12)
                m.d.sync += data_regs[13].eq(self.m_set_dr13)
                m.d.sync += data_regs[14].eq(self.m_set_dr14)
                m.d.sync += data_regs[15].eq(self.m_set_dr15)
            with m.Elif(self.m_clear_en):
                m.d.sync += cr15_m_reg.eq(0)
            # CHANGE restore: set M-flag to saved value (no DR copy); lower priority
            # than m_set_en/m_clear_en which come from the M-window FSM.
            with m.Elif(self.m_flag_restore_en):
                m.d.sync += cr15_m_reg.eq(self.m_flag_restore_val)

            with m.If(self.flags_wr_en):
                m.d.sync += flags_reg.eq(self.flags_in)

        m.d.comb += [
            self.dr_rd_data1.eq(Mux(self.dr_rd_addr1 == 0, 0, data_regs[self.dr_rd_addr1])),
            self.dr_rd_data2.eq(Mux(self.dr_rd_addr2 == 0, 0, data_regs[self.dr_rd_addr2])),
            self.flags.eq(flags_reg),
        ]

        return m
