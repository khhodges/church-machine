from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT


class ChurchDWrite(Elaboratable):
    """DWRITE DR_src, CR_src, #imm

    Turing-domain bounded data write.

    Reads DR_src and writes its value to the data region pointed to by
    CR_src at byte offset (imm << 2).

    Security gate: checks W permission on CR_src.word0_gt.perms[PERM_W].
    Bounds gate:   checks imm < CR_src.word2_w2.limit_offset[15:0].
    Address:       CR_src.word1_location + (imm << 2).

    MMIO: when address[30]=1, address[31]=0 the top-level routes the
    write to the MMIO register file (LED, UART_TX, etc.) instead of BRAM.

    Encoding: DWRITE cr_dst=DR_src, cr_src=CR_src, imm=word_offset
    FSM: IDLE -> PERM_CHECK -> MEM_WRITE -> IDLE  (3 cycles worst case)
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

        self.dr_rd_addr = Signal(4)
        self.dr_rd_data = Signal(32)

        self.dmem_addr    = Signal(32)
        self.dmem_wr_data = Signal(32)
        self.dmem_wr_en   = Signal()

    def elaborate(self, platform):
        m = Module()

        cr_src_reg  = Signal(4)
        dr_src_reg  = Signal(4)
        imm_reg     = Signal(15)
        addr_reg    = Signal(32)
        dr_data_reg = Signal(32)

        cr_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
        cr_gt   = View(GT_LAYOUT,      cr_view.word0_gt)
        cr_w2   = View(WORD2_LAYOUT,   cr_view.word2_w2)

        gt_null  = Signal()
        has_w    = Signal()
        limit    = Signal(16)
        in_bounds = Signal()

        m.d.comb += [
            gt_null.eq(cr_view.word0_gt.as_value() == 0),
            has_w.eq(cr_gt.perms[PERM_W]),
            limit.eq(cr_w2.limit_offset[:16]),
            in_bounds.eq(imm_reg <= limit),
        ]

        m.d.comb += [
            self.cr_rd_addr.eq(Mux(self.busy, cr_src_reg, self.cr_src)),
            self.dr_rd_addr.eq(Mux(self.busy, dr_src_reg, self.dr_src)),
        ]

        with m.FSM(name="dwrite_fsm"):
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        cr_src_reg.eq(self.cr_src),
                        dr_src_reg.eq(self.dr_src),
                        imm_reg.eq(self.imm),
                    ]
                    m.next = "PERM_CHECK"

            with m.State("PERM_CHECK"):
                m.d.comb += self.busy.eq(1)
                with m.If(gt_null):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.NULL_CAP)]
                    m.next = "IDLE"
                with m.Elif(cr_gt.gt_type == GT_TYPE_ABSTRACT):
                    # Stub: Abstract GT has no addressable lump.  INVALID_OP is
                    # the interim fault until the hardware Abstract Manager dispatch
                    # path is implemented (Task #432 / full M-window hardware).
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.INVALID_OP)]
                    m.next = "IDLE"
                with m.Elif(~has_w):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.PERM_W)]
                    m.next = "IDLE"
                with m.Elif(~in_bounds):
                    m.d.comb += [self.fault.eq(1), self.fault_type.eq(FaultType.BOUNDS)]
                    m.next = "IDLE"
                with m.Else():
                    m.d.sync += [
                        addr_reg.eq(cr_view.word1_location + Cat(C(0, 2), imm_reg)),
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

        return m
