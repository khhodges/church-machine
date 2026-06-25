from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT
from .integrity32 import integrity32_amaranth


class ChurchNSGate(Elaboratable):
    """Shared NS integrity gate used by both mLoad and cLoad.

    Given a 32-bit GT Word 0, performs three sequential NS table reads
    and a single-cycle parallel integrity check (integrity32) before
    acting on a Golden Token.

    NS entry layout (16-byte stride, slot_id << 4):
        W0 (+0)  location      — lump base byte address
        W1 (+4)  authority     — identical layout to CR W2 (WORD2_LAYOUT)
                                 g_bit at [30], f_flag at [31]; both masked before integrity check ★v2.0
        W2 (+8)  integrity     — integrity32(W0, W1 with g_bit[30] and f_flag[31] cleared)
        W3 (+12) abstract_gt   — advisory permission-profile annotation; fetched
                                 and latched into raw_w3 (ChurchMLoad gates on M-bit)

    FSM (seal-check enabled)
    ────────────────────────
        IDLE → FETCH_LOC → FETCH_W1 → FETCH_W2 → CHECK_INTEGRITY → FETCH_W3 → DONE
                                                                   → FAULT

    FSM (seal-check disabled)
    ─────────────────────────
        IDLE → FETCH_LOC → FETCH_W1 → CHECK_VERSION → FETCH_W3 → DONE → FAULT

    Outputs
    ───────
        raw_base          NS W0  lump base byte address
        raw_w2            NS W1  authority (identical layout to CR W2)
        ns_abstract_gt    NS W3  abstract GT annotation (M-bit gated by ChurchMLoad)
        ns_entry_addr_out byte address of the NS entry (CR15 base + slot_id << 4)

    All outputs are valid while ns_gate_done is asserted and remain
    stable until the next ns_gate_start (they are registered).

    Memory bus
    ──────────
    The gate owns mem_addr / mem_rd_en and reads mem_rd_data / mem_rd_valid.
    The caller must mux these onto its external bus whenever ns_gate_busy is
    asserted; only read traffic is generated — no writes.

    Callers
    ───────
        mLoad  — passes result_view.word0_gt as gt_word0 after FETCH_GT
        cLoad  — passes e_gt_latched as gt_word0 after CHECK_TYPE/CHECK_PERM
    """

    def __init__(self, enable_seal_check=None):
        self.enable_seal_check = (
            enable_seal_check if enable_seal_check is not None else ENABLE_SEAL_CHECK
        )

        self.ns_gate_start      = Signal()
        self.ns_gate_busy       = Signal()
        self.ns_gate_done       = Signal()
        self.ns_gate_fault      = Signal()
        self.ns_gate_fault_type = Signal(5)

        self.gt_word0        = Signal(32)
        self.cr15_namespace  = Signal(CAP_REG_LAYOUT)

        self.raw_base          = Signal(32)
        self.raw_w2            = Signal(32)
        self.ns_abstract_gt    = Signal(32)
        self.ns_entry_addr_out = Signal(32)

        self.mem_addr     = Signal(32)
        self.mem_rd_en    = Signal()
        self.mem_rd_data  = Signal(32)
        self.mem_rd_valid = Signal()

    def elaborate(self, platform):
        m = Module()

        gt_latched     = Signal(32)
        gt_view        = View(GT_LAYOUT, gt_latched)
        fault_type_reg = Signal(5)

        raw_base_reg = Signal(32)
        raw_w2_reg   = Signal(32)
        raw_w3_reg   = Signal(32)

        ns_view       = View(CAP_REG_LAYOUT, self.cr15_namespace)
        ns_entry_addr = Signal(32)
        m.d.comb += ns_entry_addr.eq(
            ns_view.word1_location + (gt_view.slot_id << 4)
        )

        if self.enable_seal_check:
            raw_w2_view = View(WORD2_LAYOUT, raw_w2_reg)

            gt_seq_match = Signal()
            m.d.comb += gt_seq_match.eq(gt_view.gt_seq == raw_w2_view.gt_seq)

            raw_integrity_reg = Signal(32)
            computed_integrity = Signal(32)
            integrity32_amaranth(m, raw_base_reg, raw_w2_reg, computed_integrity)

            seal_ok = Signal()
            m.d.comb += seal_ok.eq(computed_integrity == raw_integrity_reg)

        with m.FSM(name="ns_gate") as fsm:

            with m.State("IDLE"):
                with m.If(self.ns_gate_start):
                    m.d.sync += [
                        gt_latched.eq(self.gt_word0),
                        raw_base_reg.eq(0),
                        raw_w2_reg.eq(0),
                        raw_w3_reg.eq(0),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    if self.enable_seal_check:
                        m.d.sync += raw_integrity_reg.eq(0)
                    m.next = "FETCH_LOC"

            with m.State("FETCH_LOC"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_base_reg.eq(self.mem_rd_data)
                    m.next = "FETCH_W1"

            with m.State("FETCH_W1"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr + 4),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_w2_reg.eq(self.mem_rd_data)
                    if self.enable_seal_check:
                        m.next = "FETCH_W2"
                    else:
                        m.next = "CHECK_VERSION"

            if self.enable_seal_check:
                with m.State("FETCH_W2"):
                    m.d.comb += [
                        self.mem_addr.eq(ns_entry_addr + 8),
                        self.mem_rd_en.eq(1),
                    ]
                    with m.If(self.mem_rd_valid):
                        m.d.sync += raw_integrity_reg.eq(self.mem_rd_data)
                        m.next = "CHECK_INTEGRITY"

                with m.State("CHECK_INTEGRITY"):
                    with m.If(~gt_seq_match):
                        m.d.sync += fault_type_reg.eq(FaultType.VERSION)
                        m.next = "FAULT"
                    with m.Elif(~seal_ok):
                        m.d.sync += fault_type_reg.eq(FaultType.SEAL)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "FETCH_W3"
            else:
                with m.State("CHECK_VERSION"):
                    m.next = "FETCH_W3"

            with m.State("FETCH_W3"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr + 12),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_w3_reg.eq(self.mem_rd_data)
                    m.next = "DONE"

            with m.State("DONE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.ns_gate_busy.eq(~fsm.ongoing("IDLE")),
            self.ns_gate_done.eq(fsm.ongoing("DONE")),
            self.ns_gate_fault.eq(fsm.ongoing("FAULT")),
            self.ns_gate_fault_type.eq(fault_type_reg),
            self.raw_base.eq(raw_base_reg),
            self.raw_w2.eq(raw_w2_reg),
            self.ns_abstract_gt.eq(raw_w3_reg),
            self.ns_entry_addr_out.eq(ns_entry_addr),
        ]

        return m
