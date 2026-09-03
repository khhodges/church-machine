from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT


class ChurchDWrite(Elaboratable):
    """DWRITE DR_src, CR_src, #imm

    Turing-domain bounded data write.  Two addressing modes share opcode 11:

    Immediate mode (imm[14] = 1):
        offset = imm[13:0]
        Range: 0 – 16383 words.

    Indexed mode (imm[14] = 0):
        base   = imm[13:4]  (10-bit compile-time base, 0 – 1023)
        DRx    = imm[3:0]   (4-bit register index, value read at runtime)
        offset = base + DR[DRx]
        DR0 is hardwired zero, so DRx=0 collapses to pure-base mode.

    Security gate: checks W permission on CR_src.word0_gt.perms[PERM_W].
    Bounds gate:   checks effective_offset < CR_src.word2_w2.limit_offset[15:0].
    Address:       CR_src.word1_location + (effective_offset << 2).

    MMIO: when address[30]=1, address[31]=0 the top-level routes the
    write to the MMIO register file (LED, UART_TX, etc.) instead of BRAM.

    FSM:
        Immediate mode: IDLE -> PERM_CHECK -> MEM_WRITE
        Indexed mode:   IDLE -> READ_DRX   -> PERM_CHECK -> MEM_WRITE
    """

    def __init__(self):
        self.start      = Signal()
        self.busy       = Signal()
        self.done       = Signal()

        self.cr_src     = Signal(4)
        self.dr_src     = Signal(4)
        self.imm        = Signal(15)

        self.fault      = Signal()
        self.fault_type = Signal(5)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        # Port 1: source data register (DR[dr_src]) — driven by core from dr_rd_data2
        self.dr_rd_addr  = Signal(4)
        self.dr_rd_data  = Signal(32)

        # Port 2: DRx index register for indexed mode — driven by core from dr_rd_data1
        self.dr_rd_addr2 = Signal(4)
        self.dr_rd_data2 = Signal(32)

        self.dmem_addr    = Signal(32)
        self.dmem_wr_data = Signal(32)
        self.dmem_wr_en   = Signal()
        self.m_bit_wr_en = Signal()
        self.m_bit_wr_word = Signal(16)
        # Asserted only while protected CR14 names the canonical Namespace
        # execution identity. Possession of a device-shaped cap is insufficient.
        self.namespace_authorized = Signal()
        # Hidden Namespace-init path. These controls are wired only to the
        # trusted boot sequencer; no instruction or architectural register can
        # select/read the private capability bank.
        self.private_m_start = Signal()
        self.private_m_word = Signal(16)

    def elaborate(self, platform):
        m = Module()

        cr_src_reg  = Signal(4)
        dr_src_reg  = Signal(4)
        imm_reg     = Signal(15)
        addr_reg    = Signal(32)
        dr_data_reg = Signal(32)
        drx_val_reg = Signal(32)   # latched DR[DRx] value for indexed mode
        namespace_authorized_reg = Signal()
        private_mode_reg = Signal()
        private_word_reg = Signal(16)

        private_cap = Signal(CAP_REG_LAYOUT)
        private_cap_view = View(CAP_REG_LAYOUT, private_cap)
        m.d.comb += [
            private_cap_view.word0_gt.eq(
                make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W,
                        M_BIT_DEVICE_NS_SLOT, 0, b_flag=1)),
            private_cap_view.word1_location.eq(M_BIT_PORT),
            private_cap_view.word2_w2.eq(0),
        ]
        effective_cap = Mux(private_mode_reg, private_cap, self.cr_rd_data)
        cr_view = View(CAP_REG_LAYOUT, effective_cap)
        cr_gt   = View(GT_LAYOUT,      cr_view.word0_gt)
        cr_w2   = View(WORD2_LAYOUT,   cr_view.word2_w2)

        gt_null      = Signal()
        has_w        = Signal()
        limit        = Signal(16)
        # 33-bit effective offset: captures the carry from (10-bit base + 32-bit DRx).
        # Signal(33) prevents truncation so large DRx values that sum past 2^32 correctly
        # fail the eff_off <= limit (16-bit) bounds check instead of wrapping in-range.
        eff_off      = Signal(33)
        in_bounds    = Signal()
        exact_m_cap = Signal()
        effective_addr = Signal(32)
        accesses_m_port = Signal()

        m.d.comb += [
            gt_null.eq(cr_view.word0_gt.as_value() == 0),
            has_w.eq(~cr_gt.dom & cr_gt.perm[PERM_W]),
            limit.eq(cr_w2.limit_offset[:16]),
            eff_off.eq(Mux(imm_reg[14],
                           imm_reg[:14],                        # immediate: bits[13:0]
                           (imm_reg[4:14] + drx_val_reg))),     # indexed: base + full DR[DRx]
            in_bounds.eq(eff_off <= limit),
            exact_m_cap.eq(
                (cr_gt.gt_type == GT_TYPE_INFORM) &
                ~cr_gt.dom & cr_gt.perm[PERM_W] &
                (cr_gt.slot_id == M_BIT_DEVICE_NS_SLOT) &
                (cr_w2.limit_offset == 0) &
                (cr_view.word1_location == M_BIT_PORT)
            ),
            effective_addr.eq(
                cr_view.word1_location + Cat(C(0, 2), eff_off[:16])),
            accesses_m_port.eq(
                effective_addr == M_BIT_PORT),
        ]

        m.d.comb += [
            self.cr_rd_addr.eq(Mux(self.busy, cr_src_reg, self.cr_src)),
            # Port 1 (source data): always driven by dr_src_reg when busy
            self.dr_rd_addr.eq(Mux(self.busy, dr_src_reg, self.dr_src)),
            # Port 2 (DRx for indexed mode): driven by imm[3:0]
            self.dr_rd_addr2.eq(imm_reg[:4]),
        ]

        with m.FSM(name="dwrite_fsm"):
            with m.State("IDLE"):
                with m.If(self.start | self.private_m_start):
                    m.d.sync += [
                        cr_src_reg.eq(self.cr_src),
                        dr_src_reg.eq(self.dr_src),
                        imm_reg.eq(Mux(self.private_m_start, 0x4000, self.imm)),
                        drx_val_reg.eq(0),
                        namespace_authorized_reg.eq(self.namespace_authorized),
                        private_mode_reg.eq(self.private_m_start),
                        private_word_reg.eq(self.private_m_word),
                    ]
                    with m.If(~self.private_m_start & ~self.imm[14]):
                        # Indexed mode: need one extra cycle to read DR[DRx]
                        m.next = "READ_DRX"
                    with m.Else():
                        m.next = "PERM_CHECK"

            with m.State("READ_DRX"):
                # Latch dr_rd_data2 (DR[DRx]) into drx_val_reg.
                # dr_data for the source is latched in PERM_CHECK (same as immediate path).
                m.d.comb += self.busy.eq(1)
                m.d.sync += drx_val_reg.eq(Mux(imm_reg[:4] == 0, 0, self.dr_rd_data2))
                m.next = "PERM_CHECK"

            with m.State("PERM_CHECK"):
                m.d.comb += self.busy.eq(1)
                with m.If(exact_m_cap & (eff_off == 0) &
                          namespace_authorized_reg):
                    m.d.sync += dr_data_reg.eq(
                        Mux(private_mode_reg, Cat(private_word_reg, C(0, 16)),
                            self.dr_rd_data))
                    m.next = "M_BIT_WRITE"
                with m.Elif(exact_m_cap & (eff_off == 0)):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Elif(accesses_m_port):
                    # Raw address knowledge, a normal W capability, an
                    # over-broad Abstract capability, or a non-zero offset is
                    # never authority for the M device.
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Elif(gt_null):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.NULL_CAP)]
                    m.next = "IDLE"
                with m.Elif(cr_gt.gt_type == GT_TYPE_ABSTRACT):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Elif(~has_w):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_W)]
                    m.next = "IDLE"
                with m.Elif(~in_bounds):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.BOUNDS)]
                    m.next = "IDLE"
                with m.Else():
                    # eff_off passed bounds (eff_off <= limit where limit ≤ 16 bits);
                    # safe to truncate to 16 bits for byte-address formation.
                    m.d.sync += [
                        addr_reg.eq(effective_addr),
                        dr_data_reg.eq(self.dr_rd_data),
                    ]
                    m.next = "MEM_WRITE"

            with m.State("MEM_WRITE"):
                m.d.comb += [
                    self.busy.eq(1),
                    self.dmem_addr.eq(addr_reg),
                    self.dmem_wr_data.eq(dr_data_reg),
                    self.dmem_wr_en.eq(1),
                    self.done.eq(1),
                ]
                m.next = "IDLE"

            with m.State("M_BIT_WRITE"):
                m.d.comb += [
                    self.busy.eq(1),
                    self.m_bit_wr_en.eq(1),
                    self.m_bit_wr_word.eq(dr_data_reg[:16]),
                    self.done.eq(1),
                ]
                m.next = "IDLE"

        return m
