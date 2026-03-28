from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, WORD3_LAYOUT, LUMP_HEADER_LAYOUT


class ChurchCLoad(Elaboratable):
    """cLoad — shared CR14 + CR6 rebuild routine.

    Takes an original Mint-issued E-GT (32-bit Word 0 only), validates it
    against the NS table, then writes the transient capabilities:

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
    CHECK_VERSION (gt_seq match) and CHECK_CRC (CRC-16/CCITT over raw NS
    values: e_gt[24:0] + raw_base + raw_w2) both complete BEFORE any CR write.
    The CRC input is the raw NS data, not the reduced replacement values.
    No register is written if the gate faults.

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

        self.mem_addr    = Signal(32)
        self.mem_rd_en   = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        # ── Latched inputs ─────────────────────────────────────────────────────
        e_gt_latched   = Signal(32)
        e_gt_view      = View(GT_LAYOUT, e_gt_latched)
        fault_type_reg = Signal(5)

        # ── Raw NS values (verified before any replacement) ────────────────────
        raw_base = Signal(32)   # NS[+0]  full lump base (byte address)
        raw_w2   = Signal(32)   # NS[+4]  gt_seq | full limit_offset
        raw_w3   = Signal(32)   # NS[+8]  crc | g_bit  (only when seal check on)

        # ── Decoded lump header (latched from NS[+12]) ─────────────────────────
        cc_reg        = Signal(8)    # c-list slot count (0..255)
        n_minus_6_reg = Signal(4)    # lumpSize = 1 << (n_minus_6 + 6)
        lump_size_reg = Signal(15)   # matches call.py: range 64..16384 words

        # ── NS entry address (combinatorial over e_gt_latched) ─────────────────
        ns_view       = View(CAP_REG_LAYOUT, self.cr15_namespace)
        ns_entry_addr = Signal(32)
        m.d.comb += ns_entry_addr.eq(
            ns_view.word1_location + (e_gt_view.slot_id * 12)
        )

        # ── CRC-16/CCITT (conditional; same polynomial as mload.py) ───────────
        # Input: e_gt_latched[24:0] (25 b) + raw_base (32 b) + raw_w2 (32 b) = 89 b
        # Computed combinatorially over latched registers; valid when all three
        # registers are stable (i.e. from CHECK_VERSION onward).
        if self.enable_seal_check:
            raw_w2_view  = View(WORD2_LAYOUT, raw_w2)
            raw_w3_view  = View(WORD3_LAYOUT, raw_w3)

            gt_seq_match = Signal()
            m.d.comb += gt_seq_match.eq(e_gt_view.gt_seq == raw_w2_view.gt_seq)

            crc_stages = [Signal(16, name=f"cl_crc16_{i}") for i in range(90)]
            m.d.comb += crc_stages[0].eq(CRC16_INIT)
            for i in range(89):
                if i < 25:
                    data_bit = e_gt_latched[24 - i]    # GT W0 bits 24..0
                elif i < 57:
                    data_bit = raw_base[56 - i]        # raw_base bits 31..0
                else:
                    data_bit = raw_w2[88 - i]          # raw_w2 bits 31..0
                top_bit = Signal(name=f"cl_crc16_top_{i}")
                shifted  = Signal(16, name=f"cl_crc16_sh_{i}")
                m.d.comb += top_bit.eq(crc_stages[i][15] ^ data_bit)
                m.d.comb += shifted.eq(Cat(Const(0, 1), crc_stages[i][:15]))
                m.d.comb += crc_stages[i + 1].eq(
                    shifted ^ Mux(top_bit, CRC16_POLY, 0)
                )

            crc16_result = Signal(16, name="cl_crc16_result")
            m.d.comb += crc16_result.eq(crc_stages[89])

            seal_ok = Signal()
            m.d.comb += seal_ok.eq(crc16_result == raw_w3_view.crc)

        # ── CR14 build (X-only, M=1, B=0) ─────────────────────────────────────
        # All fields combinatorial over latched registers; written in WRITE_CR14.
        cr14_out     = Signal(CAP_REG_LAYOUT)
        cr14_view    = View(CAP_REG_LAYOUT, cr14_out)
        cr14_gt_view = View(GT_LAYOUT, cr14_view.word0_gt)
        cr14_w2_view = View(WORD2_LAYOUT, cr14_view.word2_w2)
        m.d.comb += [
            cr14_gt_view.slot_id.eq(e_gt_view.slot_id),
            cr14_gt_view.gt_seq.eq(e_gt_view.gt_seq),
            cr14_gt_view.gt_type.eq(e_gt_view.gt_type),
            cr14_gt_view.perms.eq(PERM_MASK_X),       # X-only (M=1); E/B/L/S/R/W cleared
            cr14_gt_view.b_flag.eq(0),                # B cleared for transient code cap
            cr14_view.word1_location.eq(raw_base + 4),
            cr14_w2_view.limit_offset.eq(lump_size_reg - cc_reg - 2),
            cr14_w2_view.gt_seq.eq(e_gt_view.gt_seq),
            cr14_w2_view.spare.eq(0),
            cr14_view.word3_w3.eq(raw_w3),            # original NS CRC retained
        ]

        # ── CR6 build (original E-GT in W0, reduced c-list view in W1–W3) ──────
        # CR6.W0 = e_gt_latched exactly as received from Mint — never altered.
        cr6_out     = Signal(CAP_REG_LAYOUT)
        cr6_view    = View(CAP_REG_LAYOUT, cr6_out)
        cr6_w2_view = View(WORD2_LAYOUT, cr6_view.word2_w2)
        m.d.comb += [
            cr6_view.word0_gt.eq(e_gt_latched),       # unaltered: B+E perms from Mint
            cr6_view.word1_location.eq(
                raw_base + ((lump_size_reg - cc_reg) << 2)
            ),
            cr6_w2_view.limit_offset.eq(cc_reg - 1),
            cr6_w2_view.gt_seq.eq(e_gt_view.gt_seq),
            cr6_w2_view.spare.eq(0),
            cr6_view.word3_w3.eq(raw_w3),             # original NS CRC retained
        ]

        # ── Local CR write wires ───────────────────────────────────────────────
        local_cr_wr_addr = Signal(4)
        local_cr_wr_data = Signal(CAP_REG_LAYOUT)
        local_cr_wr_en   = Signal()
        m.d.comb += [
            self.cr_wr_addr.eq(local_cr_wr_addr),
            self.cr_wr_data.eq(local_cr_wr_data),
            self.cr_wr_en.eq(local_cr_wr_en),
        ]

        # ── FSM ───────────────────────────────────────────────────────────────
        with m.FSM(name="cload") as fsm:

            with m.State("IDLE"):
                with m.If(self.cload_start):
                    m.d.sync += [
                        e_gt_latched.eq(self.e_gt),
                        raw_base.eq(0),
                        raw_w2.eq(0),
                        raw_w3.eq(0),
                        cc_reg.eq(0),
                        n_minus_6_reg.eq(0),
                        lump_size_reg.eq(0),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    m.next = "CHECK_TYPE"

            # ── Validate E-GT before touching the NS table ─────────────────────
            with m.State("CHECK_TYPE"):
                # e_gt_latched is valid (written in previous IDLE cycle).
                # Must be a Real GT (typ=01) carrying E-perm.
                with m.If(e_gt_view.gt_type != GT_TYPE_REAL):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)
                    m.next = "FAULT"
                with m.Elif(~e_gt_view.perms[PERM_E]):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_E)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "FETCH_LOC"

            # ── NS fetch: three sequential reads ──────────────────────────────
            with m.State("FETCH_LOC"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr),      # NS[+0]: lump base
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_base.eq(self.mem_rd_data)
                    m.next = "FETCH_W2"

            with m.State("FETCH_W2"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr + 4),  # NS[+4]: gt_seq | limit
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_w2.eq(self.mem_rd_data)
                    if self.enable_seal_check:
                        m.next = "FETCH_W3"
                    else:
                        m.next = "CHECK_VERSION"

            if self.enable_seal_check:
                with m.State("FETCH_W3"):
                    m.d.comb += [
                        self.mem_addr.eq(ns_entry_addr + 8),  # NS[+8]: crc | g_bit
                        self.mem_rd_en.eq(1),
                    ]
                    with m.If(self.mem_rd_valid):
                        m.d.sync += raw_w3.eq(self.mem_rd_data)
                        m.next = "CHECK_VERSION"

            # ── INTEGRITY GATE ────────────────────────────────────────────────
            # CRC is over raw NS values (raw_base, raw_w2).
            # FETCH_HDR, WRITE_CR14, WRITE_CR6 are unreachable via FAULT.
            with m.State("CHECK_VERSION"):
                if self.enable_seal_check:
                    with m.If(~gt_seq_match):
                        m.d.sync += fault_type_reg.eq(FaultType.VERSION)
                        m.next = "FAULT"
                    with m.Elif(~seal_ok):
                        m.d.sync += fault_type_reg.eq(FaultType.SEAL)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "FETCH_HDR"
                else:
                    m.next = "FETCH_HDR"

            # ── Gate passed — transient replacement begins ─────────────────────
            with m.State("FETCH_HDR"):
                m.d.comb += [
                    self.mem_addr.eq(raw_base),           # lump word 0 = lump header
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    _hdr = View(LUMP_HEADER_LAYOUT, self.mem_rd_data)
                    m.d.sync += [
                        cc_reg.eq(_hdr.cc),
                        n_minus_6_reg.eq(_hdr.n_minus_6),
                        lump_size_reg.eq(Const(1, 15) << (_hdr.n_minus_6 + 6)),
                    ]
                    m.next = "WRITE_CR14"

            with m.State("WRITE_CR14"):
                # CR14: code capability (X-only, M=1, B=0).
                # cr14_out is combinatorial over the latched registers — valid here
                # because lump_size_reg / cc_reg were written at end of FETCH_HDR.
                m.d.comb += [
                    local_cr_wr_addr.eq(CR_CODE),         # CR14
                    local_cr_wr_data.eq(cr14_out),
                    local_cr_wr_en.eq(1),
                ]
                m.next = "WRITE_CR6"

            with m.State("WRITE_CR6"):
                # CR6: c-list capability, or NULL GT when cc=0.
                # CR6.W0 = original E-GT (e_gt_latched), unaltered.
                with m.If(cc_reg == 0):
                    m.d.comb += [
                        local_cr_wr_addr.eq(CR_CLIST),    # CR6
                        local_cr_wr_data.eq(0),           # NULL GT
                        local_cr_wr_en.eq(1),
                    ]
                with m.Else():
                    m.d.comb += [
                        local_cr_wr_addr.eq(CR_CLIST),    # CR6
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
