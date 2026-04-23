from amaranth import *
from amaranth.lib.data import View

from .hw_types import GT_TYPE_INFORM
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchOutformFSM(Elaboratable):
    """Mode 2 CALL intercept: promotes an Outform GT in a source CR to Inform GT.

    When a CALL instruction's source register contains an Outform GT
    (gt_type == 0b10), this FSM intercepts before the CALL unit starts,
    triggers the ChurchOutform download engine to lazily install the absent
    lump, waits for the download and Mint steps to complete, then promotes
    the source register's GT from Outform (type=0b10) to Inform (type=0b01)
    using the freshly minted result GT's sequence number.  The CALL then
    retries with the promoted Inform GT in the source register.

    FSM: IDLE -> TRIGGER_OUTFORM -> WAIT_OUTFORM -> PROMOTE_WRITE -> DONE
                                                 \\-> FAULT

    Interface to core.py:
      intercept_start / src_cr / src_cr_data  — driven by decode logic
      cr_wr_en / cr_wr_addr / cr_wr_data      — muxed into register file
      outform_start_out / outform_gt_raw_out / outform_slot_id_out
                                               — connects to _outform_start mux
      outform_done_in / outform_fault_in / outform_fault_type_in / result_gt_in
                                               — from outform engine (gated by
                                                 outform_mode2_active in core)
    """

    def __init__(self):
        # ── Intercept trigger (driven by core decode logic) ──────────────────
        self.intercept_start = Signal()          # pulse: CALL + Outform GT detected
        self.src_cr          = Signal(4)         # source CR index (cr_src)
        self.src_cr_data     = Signal(CAP_REG_LAYOUT)  # full cap-reg content of src CR

        # ── CR write-back (muxed into register file alongside other units) ───
        self.cr_wr_en   = Signal()
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)

        # ── Outform engine interface ──────────────────────────────────────────
        self.outform_start_out      = Signal()   # triggers ChurchOutform download
        self.outform_gt_raw_out     = Signal(32) # raw Outform GT word
        self.outform_slot_id_out    = Signal(16) # slot_id from the Outform GT
        self.outform_clist_addr_out = Signal(32) # dummy c-list addr for Mint write-back

        self.outform_done_in       = Signal()    # download + Mint complete
        self.outform_fault_in      = Signal()    # download or Mint faulted
        self.outform_fault_type_in = Signal(5)   # fault type code
        self.result_gt_in          = Signal(32)  # minted Inform GT (from outform engine)

        # ── Status ───────────────────────────────────────────────────────────
        self.busy       = Signal()
        self.done       = Signal()   # 1-cycle pulse on successful completion
        self.fault      = Signal()   # 1-cycle pulse on failure
        self.fault_type = Signal(5)

    def elaborate(self, platform):
        m = Module()

        # ── Latched intercept context ─────────────────────────────────────────
        src_cr_lat      = Signal(4)
        src_cr_data_lat = Signal(CAP_REG_LAYOUT)
        gt_raw_lat      = Signal(32)
        slot_id_lat     = Signal(16)
        fault_type_lat  = Signal(5)

        # ── Combinatorial views of latched / incoming signals ─────────────────
        src_in_view  = View(CAP_REG_LAYOUT, self.src_cr_data)
        src_in_gt    = View(GT_LAYOUT, src_in_view.word0_gt)

        src_lat_view = View(CAP_REG_LAYOUT, src_cr_data_lat)
        src_lat_gt   = View(GT_LAYOUT, src_lat_view.word0_gt)

        result_gt_view = View(GT_LAYOUT, self.result_gt_in)

        # ── Promoted Inform GT ────────────────────────────────────────────────
        # Preserve slot_id, perms, b_flag from the original Outform GT.
        # Replace gt_type with Inform (0b01) and gt_seq with the Mint result seq.
        promoted_gt = Signal(32)
        prom_gt_view = View(GT_LAYOUT, promoted_gt)
        m.d.comb += [
            prom_gt_view.slot_id.eq(src_lat_gt.slot_id),
            prom_gt_view.gt_seq.eq(result_gt_view.gt_seq),
            prom_gt_view.gt_type.eq(GT_TYPE_INFORM),
            prom_gt_view.perms.eq(src_lat_gt.perms),
            prom_gt_view.b_flag.eq(src_lat_gt.b_flag),
        ]

        # ── Promoted cap register ─────────────────────────────────────────────
        # Replace word0_gt with the promoted Inform GT; preserve word1 and word2.
        promoted_cap = Signal(CAP_REG_LAYOUT)
        prom_cap_view = View(CAP_REG_LAYOUT, promoted_cap)
        m.d.comb += [
            prom_cap_view.word0_gt.eq(promoted_gt),
            prom_cap_view.word1_location.eq(src_lat_view.word1_location),
            prom_cap_view.word2_w2.eq(src_lat_view.word2_w2),
        ]

        # ── Combinatorial output defaults ─────────────────────────────────────
        m.d.comb += [
            self.outform_start_out.eq(0),
            self.outform_gt_raw_out.eq(gt_raw_lat),
            self.outform_slot_id_out.eq(slot_id_lat),
            self.outform_clist_addr_out.eq(0),
            self.cr_wr_en.eq(0),
            self.cr_wr_addr.eq(src_cr_lat),
            self.cr_wr_data.eq(promoted_cap),
            self.busy.eq(0),
            self.done.eq(0),
            self.fault.eq(0),
            self.fault_type.eq(0),
        ]

        # ── FSM ───────────────────────────────────────────────────────────────
        with m.FSM(name="church_outform"):

            with m.State("IDLE"):
                with m.If(self.intercept_start):
                    m.d.sync += [
                        src_cr_lat.eq(self.src_cr),
                        src_cr_data_lat.eq(self.src_cr_data.as_value()),
                        gt_raw_lat.eq(src_in_view.word0_gt.as_value()),
                        slot_id_lat.eq(src_in_gt.slot_id),
                    ]
                    m.next = "TRIGGER_OUTFORM"

            with m.State("TRIGGER_OUTFORM"):
                # Assert outform_start_out combinatorially for this one cycle.
                # The outform engine latches the start on the rising edge and
                # proceeds to download the absent lump.
                m.d.comb += [
                    self.busy.eq(1),
                    self.outform_start_out.eq(1),
                    self.outform_gt_raw_out.eq(gt_raw_lat),
                    self.outform_slot_id_out.eq(slot_id_lat),
                ]
                m.next = "WAIT_OUTFORM"

            with m.State("WAIT_OUTFORM"):
                m.d.comb += self.busy.eq(1)
                with m.If(self.outform_fault_in):
                    m.d.sync += fault_type_lat.eq(self.outform_fault_type_in)
                    m.next = "FAULT"
                with m.Elif(self.outform_done_in):
                    m.next = "PROMOTE_WRITE"

            with m.State("PROMOTE_WRITE"):
                # Write the promoted Inform GT into the source CR register.
                # promoted_cap has gt_type=Inform (0b01), gt_seq from Mint result,
                # slot_id + perms + b_flag preserved from the original Outform GT,
                # and word1_location + word2_w2 preserved unchanged.
                m.d.comb += [
                    self.busy.eq(1),
                    self.cr_wr_en.eq(1),
                    self.cr_wr_addr.eq(src_cr_lat),
                    self.cr_wr_data.eq(promoted_cap),
                ]
                m.next = "DONE"

            with m.State("DONE"):
                # 1-cycle done pulse — core decode will re-attempt the CALL on
                # the next cycle; the source CR now holds an Inform GT.
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += [
                    self.fault.eq(1),
                    self.fault_type.eq(fault_type_lat),
                ]
                m.next = "IDLE"

        return m
