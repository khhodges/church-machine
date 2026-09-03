from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT


class ChurchDRead(Elaboratable):
    """DREAD DR_dst, CR_src, #imm

    Turing-domain bounded data read.  Two addressing modes share opcode 10:

    Immediate mode (imm[14] = 1):
        offset = imm[13:0]
        Range: 0 – 16383 words.

    Indexed mode (imm[14] = 0):
        base   = imm[13:4]  (10-bit compile-time base, 0 – 1023)
        DRx    = imm[3:0]   (4-bit register index, value read at runtime)
        offset = base + DR[DRx]
        DR0 is hardwired zero, so DRx=0 collapses to pure-base mode.

    Security gate: checks R permission on CR_src.word0_gt.perms[PERM_R].
    Bounds gate:   checks effective_offset < CR_src.word2_w2.limit_offset[15:0].
    Address:       CR_src.word1_location + (effective_offset << 2).

    MMIO: when address[30]=1, address[31]=0 the top-level routes the
    access to the MMIO register file instead of BRAM.  This unit sees
    no difference — it drives dmem_addr and reads dmem_rd_data either way.

    FSM:
        Immediate mode: IDLE -> PERM_CHECK -> MEM_ACCESS -> MEM_ACCESS_WAIT
        Indexed mode:   IDLE -> READ_DRX   -> PERM_CHECK -> MEM_ACCESS -> MEM_ACCESS_WAIT
    """

    def __init__(self):
        self.start      = Signal()
        self.busy       = Signal()
        self.done       = Signal()

        self.cr_src     = Signal(4)
        self.dr_dst     = Signal(4)
        self.imm        = Signal(15)

        self.fault      = Signal()
        self.fault_type = Signal(5)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        # DR read port — used in READ_DRX state to fetch DR[DRx] for indexed mode
        self.dr_rd_addr = Signal(4)
        self.dr_rd_data = Signal(32)

        self.dr_wr_addr = Signal(4)
        self.dr_wr_data = Signal(32)
        self.dr_wr_en   = Signal()

        self.dmem_addr    = Signal(32)
        self.dmem_rd_en   = Signal()
        self.dmem_rd_data = Signal(32)
        # Namespace-held M-bit MMIO register. The architectural register is
        # one 32-bit word; bits 0..15 carry CR0.M..CR15.M and bits 16..31 read
        # as zero.
        self.m_bit_rd_word = Signal(16)
        self.namespace_authorized = Signal()

    def elaborate(self, platform):
        m = Module()

        cr_src_reg  = Signal(4)
        dr_dst_reg  = Signal(4)
        imm_reg     = Signal(15)
        addr_reg    = Signal(32)
        drx_val_reg = Signal(32)   # latched DR[DRx] value for indexed mode
        namespace_authorized_reg = Signal()

        cr_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
        cr_gt   = View(GT_LAYOUT,      cr_view.word0_gt)
        cr_w2   = View(WORD2_LAYOUT,   cr_view.word2_w2)

        gt_null      = Signal()
        has_r        = Signal()
        limit        = Signal(16)
        # 33-bit effective offset: captures the carry from (10-bit base + 32-bit DRx).
        # Amaranth computes imm_reg[4:14] (10b) + drx_val_reg (32b) = 33-bit result.
        # Assigning to Signal(33) preserves the carry so that base=1, DRx=0xFFFFFFFF
        # gives eff_off=0x100000000, which correctly fails eff_off <= limit (16-bit).
        eff_off      = Signal(33)
        in_bounds    = Signal()
        exact_m_cap = Signal()
        effective_addr = Signal(32)
        accesses_m_port = Signal()

        m.d.comb += [
            gt_null.eq(cr_view.word0_gt.as_value() == 0),
            has_r.eq(~cr_gt.dom & cr_gt.perm[PERM_R]),
            limit.eq(cr_w2.limit_offset[:16]),
            eff_off.eq(Mux(imm_reg[14],
                           imm_reg[:14],                        # immediate: bits[13:0]
                           (imm_reg[4:14] + drx_val_reg))),     # indexed: base + full DR[DRx]
            in_bounds.eq(eff_off <= limit),
            exact_m_cap.eq(
                (cr_gt.gt_type == GT_TYPE_INFORM) &
                ~cr_gt.dom & cr_gt.perm[PERM_R] &
                (cr_gt.slot_id == M_BIT_DEVICE_NS_SLOT) &
                (cr_w2.limit_offset == 0) &
                (cr_view.word1_location == M_BIT_PORT)
            ),
            effective_addr.eq(
                cr_view.word1_location + Cat(C(0, 2), eff_off[:16])),
            accesses_m_port.eq(effective_addr == M_BIT_PORT),
        ]

        m.d.comb += [
            self.cr_rd_addr.eq(Mux(self.busy, cr_src_reg, self.cr_src)),
            self.dr_rd_addr.eq(imm_reg[:4]),   # DRx index (only meaningful in READ_DRX state)
        ]

        with m.FSM(name="dread_fsm"):
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        cr_src_reg.eq(self.cr_src),
                        dr_dst_reg.eq(self.dr_dst),
                        imm_reg.eq(self.imm),
                        drx_val_reg.eq(0),
                        namespace_authorized_reg.eq(self.namespace_authorized),
                    ]
                    with m.If(~self.imm[14]):
                        # Indexed mode: need one extra cycle to read DR[DRx]
                        m.next = "READ_DRX"
                    with m.Else():
                        m.next = "PERM_CHECK"

            with m.State("READ_DRX"):
                # Drive dr_rd_addr = imm_reg[3:0] (already set in comb above)
                # and latch dr_rd_data into drx_val_reg on the next clock.
                m.d.comb += self.busy.eq(1)
                m.d.sync += drx_val_reg.eq(Mux(imm_reg[:4] == 0, 0, self.dr_rd_data))
                m.next = "PERM_CHECK"

            with m.State("PERM_CHECK"):
                m.d.comb += self.busy.eq(1)
                with m.If(exact_m_cap & (eff_off == 0) &
                          namespace_authorized_reg):
                    m.next = "M_BIT_READ"
                with m.Elif(exact_m_cap & (eff_off == 0)):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Elif(accesses_m_port):
                    # Raw address knowledge or an over-broad capability is not
                    # authority for the Namespace-held M register.
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_S)]
                    m.next = "IDLE"
                with m.Elif(gt_null):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.NULL_CAP)]
                    m.next = "IDLE"
                with m.Elif(cr_gt.gt_type == GT_TYPE_ABSTRACT):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Elif(~has_r):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_R)]
                    m.next = "IDLE"
                with m.Elif(~in_bounds):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.BOUNDS)]
                    m.next = "IDLE"
                with m.Else():
                    # eff_off passed bounds (eff_off <= limit where limit ≤ 16 bits);
                    # safe to truncate to 16 bits for byte-address formation.
                    m.d.sync += addr_reg.eq(effective_addr)
                    m.next = "MEM_ACCESS"

            with m.State("M_BIT_READ"):
                m.d.comb += [
                    self.busy.eq(1),
                    self.dr_wr_addr.eq(dr_dst_reg),
                    self.dr_wr_data.eq(Cat(self.m_bit_rd_word, C(0, 16))),
                    self.dr_wr_en.eq(dr_dst_reg != 0),
                    self.done.eq(1),
                ]
                m.next = "IDLE"

            with m.State("MEM_ACCESS"):
                m.d.comb += [
                    self.busy.eq(1),
                    self.dmem_addr.eq(addr_reg),
                    self.dmem_rd_en.eq(1),
                ]
                m.next = "MEM_ACCESS_WAIT"

            with m.State("MEM_ACCESS_WAIT"):
                m.d.comb += [
                    self.busy.eq(1),
                    self.dr_wr_addr.eq(dr_dst_reg),
                    self.dr_wr_data.eq(self.dmem_rd_data),
                    self.dr_wr_en.eq(dr_dst_reg != 0),
                    self.done.eq(1),
                ]
                m.next = "IDLE"

        return m
