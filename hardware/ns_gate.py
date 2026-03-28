from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, WORD3_LAYOUT


class ChurchNSGate(Elaboratable):
    """Shared NS integrity gate used by both mLoad and cLoad.

    Given a 32-bit GT Word 0, performs the three sequential NS table reads
    and the two-stage integrity check (gt_seq match + CRC-16/CCITT) that
    both mLoad and cLoad require before acting on a Golden Token.

    FSM
    ───
        IDLE → FETCH_LOC → FETCH_W2 → [FETCH_W3] → CHECK_VERSION → DONE
                                                                   → FAULT

    FETCH_W3 and both checks are compiled in only when enable_seal_check is
    True (the production default).  Without seal-check, FETCH_W2 → DONE
    via a pass-through CHECK_VERSION state.

    Outputs
    ───────
        raw_base          NS[+0]  lump base byte address
        raw_w2            NS[+4]  gt_seq | limit_offset
        raw_w3            NS[+8]  crc | g_bit  (0 when seal check disabled)
        ns_entry_addr_out byte address of the NS entry (CR15 base + slot*12)

    All four outputs are valid while ns_gate_done is asserted and remain
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
        self.raw_w3            = Signal(32)
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
            ns_view.word1_location + (gt_view.slot_id * 12)
        )

        if self.enable_seal_check:
            raw_w2_view = View(WORD2_LAYOUT, raw_w2_reg)
            raw_w3_view = View(WORD3_LAYOUT, raw_w3_reg)

            gt_seq_match = Signal()
            m.d.comb += gt_seq_match.eq(gt_view.gt_seq == raw_w2_view.gt_seq)

            crc_stages = [Signal(16, name=f"nsg_crc16_{i}") for i in range(90)]
            m.d.comb += crc_stages[0].eq(CRC16_INIT)
            for i in range(89):
                if i < 25:
                    data_bit = gt_latched[24 - i]
                elif i < 57:
                    data_bit = raw_base_reg[56 - i]
                else:
                    data_bit = raw_w2_reg[88 - i]
                top_bit = Signal(name=f"nsg_crc16_top_{i}")
                shifted  = Signal(16, name=f"nsg_crc16_sh_{i}")
                m.d.comb += top_bit.eq(crc_stages[i][15] ^ data_bit)
                m.d.comb += shifted.eq(Cat(Const(0, 1), crc_stages[i][:15]))
                m.d.comb += crc_stages[i + 1].eq(
                    shifted ^ Mux(top_bit, CRC16_POLY, 0)
                )

            crc16_result = Signal(16, name="nsg_crc16_result")
            m.d.comb += crc16_result.eq(crc_stages[89])
            seal_ok = Signal()
            m.d.comb += seal_ok.eq(crc16_result == raw_w3_view.crc)

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
                    m.next = "FETCH_LOC"

            with m.State("FETCH_LOC"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_base_reg.eq(self.mem_rd_data)
                    m.next = "FETCH_W2"

            with m.State("FETCH_W2"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr + 4),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += raw_w2_reg.eq(self.mem_rd_data)
                    if self.enable_seal_check:
                        m.next = "FETCH_W3"
                    else:
                        m.next = "CHECK_VERSION"

            if self.enable_seal_check:
                with m.State("FETCH_W3"):
                    m.d.comb += [
                        self.mem_addr.eq(ns_entry_addr + 8),
                        self.mem_rd_en.eq(1),
                    ]
                    with m.If(self.mem_rd_valid):
                        m.d.sync += raw_w3_reg.eq(self.mem_rd_data)
                        m.next = "CHECK_VERSION"

            with m.State("CHECK_VERSION"):
                if self.enable_seal_check:
                    with m.If(~gt_seq_match):
                        m.d.sync += fault_type_reg.eq(FaultType.VERSION)
                        m.next = "FAULT"
                    with m.Elif(~seal_ok):
                        m.d.sync += fault_type_reg.eq(FaultType.SEAL)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "DONE"
                else:
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
            self.raw_w3.eq(raw_w3_reg),
            self.ns_entry_addr_out.eq(ns_entry_addr),
        ]

        return m
