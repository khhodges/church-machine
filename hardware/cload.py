from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, LUMP_HEADER_LAYOUT
from .ns_gate import ChurchNSGate


class ChurchCLoad(Elaboratable):
    """cLoad — shared CR14 + CR6 rebuild routine.

    Takes an original Mint-issued E-GT (32-bit Word 0 only), validates it
    against the NS table via the shared ChurchNSGate, then writes the
    transient capabilities:

        CR14  — code capability  (X-only, M=1, B=0)
                W0: e_gt with perms → X-only, b_flag → 0
                W1: NS_base + 4                    (first instruction word)
                W2: lumpSize − cc − 2              (code limit, reduced)
                W3: original NS CRC retained

        CR6   — c-list capability  (CR6.W0 unaltered: original B+E GT)
                W0: e_gt unchanged                 (Mint-issued, never modified)
                W1: NS_base + (lumpSize − cc) × 4  (c-list base, reduced)
                W2: cc − 1                         (c-list limit, reduced)
                W3: original NS CRC retained
                (cc=0 → write NULL GT to CR6)

    Integrity gate
    ──────────────
    Delegated entirely to ChurchNSGate (CHECK_VERSION + CHECK_CRC).
    FETCH_HDR, WRITE_CR14, WRITE_CR6 are unreachable via FAULT.

    FSM
    ───
        IDLE → CHECK_TYPE → START_GATE → WAIT_GATE
             → FETCH_HDR → WRITE_CR14 → WRITE_CR6 → DONE
             → FAULT (any error)

    Callers
    ───────
        CALL   — e_gt latched from Phase 1 mLoad (c-list slot Word 0)
        RETURN — e_gt read from Mem[thread_base + (STO-1)×4]  (SZ=1 only)
        CHANGE — e_gt read from Zone ① slot 6 of incoming thread lump

    The input e_gt must remain stable from cload_start until cload_done
    or cload_fault is asserted.
    """

    def __init__(self, enable_seal_check=None):
        self.enable_seal_check = (
            enable_seal_check if enable_seal_check is not None else ENABLE_SEAL_CHECK
        )

        self.cload_start      = Signal()
        self.cload_busy       = Signal()
        self.cload_done       = Signal()
        self.cload_fault      = Signal()
        self.cload_fault_type = Signal(5)

        self.e_gt = Signal(32)

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en   = Signal()

        self.mem_addr     = Signal(32)
        self.mem_rd_en    = Signal()
        self.mem_rd_data  = Signal(32)
        self.mem_rd_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        m.submodules.u_ns_gate = u_ns_gate = ChurchNSGate(
            enable_seal_check=self.enable_seal_check
        )

        e_gt_latched   = Signal(32)
        e_gt_view      = View(GT_LAYOUT, e_gt_latched)
        fault_type_reg = Signal(5)

        raw_base = Signal(32)
        raw_w2   = Signal(32)

        cc_reg        = Signal(8)
        cw_reg        = Signal(13)   # _hdr.cw: authoritative code-word count from lump header
        n_minus_6_reg = Signal(4)
        lump_size_reg = Signal(15)

        local_mem_addr  = Signal(32)
        local_mem_rd_en = Signal()

        m.d.comb += u_ns_gate.cr15_namespace.eq(self.cr15_namespace)

        m.d.comb += [
            self.mem_addr.eq(
                Mux(u_ns_gate.ns_gate_busy, u_ns_gate.mem_addr, local_mem_addr)
            ),
            self.mem_rd_en.eq(
                Mux(u_ns_gate.ns_gate_busy, u_ns_gate.mem_rd_en, local_mem_rd_en)
            ),
            u_ns_gate.mem_rd_data.eq(self.mem_rd_data),
            u_ns_gate.mem_rd_valid.eq(u_ns_gate.ns_gate_busy & self.mem_rd_valid),
        ]

        # ── CR14 build (RX, M=1, B=0) ──────────────────────────────────────────
        cr14_out     = Signal(CAP_REG_LAYOUT)
        cr14_view    = View(CAP_REG_LAYOUT, cr14_out)
        cr14_gt_view = View(GT_LAYOUT, cr14_view.word0_gt)
        cr14_w2_view = View(WORD2_LAYOUT, cr14_view.word2_w2)
        m.d.comb += [
            cr14_gt_view.slot_id.eq(e_gt_view.slot_id),
            cr14_gt_view.gt_seq.eq(e_gt_view.gt_seq),
            cr14_gt_view.gt_type.eq(e_gt_view.gt_type),
            # Turing domain: dom=0, perm=0b101 (X=perm[2]=1, W=perm[1]=0, R=perm[0]=1)
            cr14_gt_view.dom.eq(0),
            cr14_gt_view.perm.eq(0b101),   # R+X in Turing domain
            cr14_gt_view.b_flag.eq(0),
            cr14_view.word1_location.eq(raw_base + 4),
            cr14_w2_view.limit_offset.eq(cw_reg - 1),    # cw-1 (inclusive last valid PC; cw from lump header, not allocation size)
            cr14_w2_view.gt_seq.eq(e_gt_view.gt_seq),
            cr14_w2_view.g_bit.eq(0),
            cr14_w2_view.f_flag.eq(0),
        ]

        # ── CR6 build (original E-GT in W0, reduced c-list view in W1–W3) ──────
        cr6_out     = Signal(CAP_REG_LAYOUT)
        cr6_view    = View(CAP_REG_LAYOUT, cr6_out)
        cr6_w2_view = View(WORD2_LAYOUT, cr6_view.word2_w2)
        m.d.comb += [
            cr6_view.word0_gt.eq(e_gt_latched),
            cr6_view.word1_location.eq(
                raw_base + ((lump_size_reg - cc_reg) << 2)
            ),
            cr6_w2_view.limit_offset.eq(cc_reg - 1),
            cr6_w2_view.gt_seq.eq(e_gt_view.gt_seq),
            cr6_w2_view.g_bit.eq(0),
            cr6_w2_view.f_flag.eq(0),
        ]

        local_cr_wr_addr = Signal(4)
        local_cr_wr_data = Signal(CAP_REG_LAYOUT)
        local_cr_wr_en   = Signal()
        m.d.comb += [
            self.cr_wr_addr.eq(local_cr_wr_addr),
            self.cr_wr_data.eq(local_cr_wr_data),
            self.cr_wr_en.eq(local_cr_wr_en),
        ]

        with m.FSM(name="cload") as fsm:

            with m.State("IDLE"):
                with m.If(self.cload_start):
                    m.d.sync += [
                        e_gt_latched.eq(self.e_gt),
                        raw_base.eq(0),
                        raw_w2.eq(0),
                        cc_reg.eq(0),
                        cw_reg.eq(0),
                        n_minus_6_reg.eq(0),
                        lump_size_reg.eq(0),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    m.next = "CHECK_TYPE"

            # ── CALL target type acceptance matrix ──────────────────────
            # Matches simulator.js lines 1616-1619:
            #   if (srcParsed.type !== 1 && srcParsed.type !== 3) { fault }
            #
            #   GT_TYPE_NULL     (0) → REJECT  (fault PERM_E)
            #   GT_TYPE_INFORM   (1) → ACCEPT  (concrete lump)
            #   GT_TYPE_OUTFORM  (2) → REJECT  (fault PERM_E)
            #   GT_TYPE_ABSTRACT (3) → ACCEPT  (PassKey / value)
            # ───────────────────────────────────────────────────────────
            with m.State("CHECK_TYPE"):
                is_valid_type = (
                    (e_gt_view.gt_type == GT_TYPE_INFORM) |
                    (e_gt_view.gt_type == GT_TYPE_ABSTRACT)
                )
                with m.If(~is_valid_type):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)
                    m.next = "FAULT"
                with m.Elif(~(e_gt_view.dom & e_gt_view.perm[2])):   # Church E = dom=1, perm[2]=1
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "START_GATE"

            with m.State("START_GATE"):
                m.d.comb += [
                    u_ns_gate.ns_gate_start.eq(1),
                    u_ns_gate.gt_word0.eq(e_gt_latched),
                ]
                m.next = "WAIT_GATE"

            with m.State("WAIT_GATE"):
                with m.If(u_ns_gate.ns_gate_fault):
                    m.d.sync += fault_type_reg.eq(u_ns_gate.ns_gate_fault_type)
                    m.next = "FAULT"
                with m.Elif(u_ns_gate.ns_gate_done):
                    m.d.sync += [
                        raw_base.eq(u_ns_gate.raw_base),
                        raw_w2.eq(u_ns_gate.raw_w2),
                    ]
                    m.next = "FETCH_HDR"

            with m.State("FETCH_HDR"):
                m.d.comb += [
                    local_mem_addr.eq(raw_base),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    _hdr = View(LUMP_HEADER_LAYOUT, self.mem_rd_data)
                    m.d.sync += [
                        cc_reg.eq(_hdr.cc),
                        cw_reg.eq(_hdr.cw),          # authoritative code-word count
                        n_minus_6_reg.eq(_hdr.n_minus_6),
                        lump_size_reg.eq(Const(1, 15) << (_hdr.n_minus_6 + 6)),
                    ]
                    m.next = "WRITE_CR14"

            with m.State("WRITE_CR14"):
                m.d.comb += [
                    local_cr_wr_addr.eq(CR_CLOOMC),
                    local_cr_wr_data.eq(cr14_out),
                    local_cr_wr_en.eq(1),
                ]
                m.next = "WRITE_CR6"

            with m.State("WRITE_CR6"):
                with m.If(cc_reg == 0):
                    m.d.comb += [
                        local_cr_wr_addr.eq(CR_CLIST),
                        local_cr_wr_data.eq(0),
                        local_cr_wr_en.eq(1),
                    ]
                with m.Else():
                    m.d.comb += [
                        local_cr_wr_addr.eq(CR_CLIST),
                        local_cr_wr_data.eq(cr6_out),
                        local_cr_wr_en.eq(1),
                    ]
                m.next = "DONE"

            with m.State("DONE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.cload_busy.eq(~fsm.ongoing("IDLE")),
            self.cload_done.eq(fsm.ongoing("DONE")),
            self.cload_fault.eq(fsm.ongoing("FAULT")),
            self.cload_fault_type.eq(fault_type_reg),
        ]

        return m
