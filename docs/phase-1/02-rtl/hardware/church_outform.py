from amaranth import *
from amaranth.lib.data import View

from .hw_types import GT_TYPE_INFORM, FaultType
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchOutformFSM(Elaboratable):
    """Mode 2 CALL intercept: promotes an Outform GT in a source CR to Inform GT.

    When a CALL instruction's source register contains an Outform GT
    (gt_type == 0b10), this FSM intercepts before the CALL unit starts.

    ── Fail-closed Outform ingress containment (Task #2862) ──
    Historically this FSM would trigger the ChurchOutform download engine to
    lazily install the absent lump over the network, wait for download + Mint,
    then promote the source register's GT from Outform (0b10) to Inform (0b01).
    That promotion is authenticated ONLY by a fused CRC-32 + integrity32(T),
    neither of which is an authentication primitive, and no trusted externally-
    authenticated Mint identity/hash input exists on this hardware.  The
    intercept is therefore now fault-closed: it transitions straight to FAULT
    (fault_type = OUTFORM_UNAUTH) without asserting outform_start_out and without
    reaching PROMOTE_WRITE, so no allocation / Mint / NS / c-list write and no CR
    promotion ever occur.  See the IDLE state for the full rationale and the
    conditions under which promotion may be re-enabled.

    FSM (contained): IDLE -> FAULT
    FSM (dead / re-entry point for a future authenticated Mint input):
                     TRIGGER_OUTFORM -> WAIT_OUTFORM -> PROMOTE_WRITE -> DONE

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
            prom_gt_view.dom.eq(src_lat_gt.dom),    # copy dom+perm from source
            prom_gt_view.perm.eq(src_lat_gt.perm),
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
                    # ── Fail-closed Outform ingress containment (Task #2862) ──
                    # A CALL whose source CR holds an Outform GT (gt_type=0b10)
                    # names a non-resident lump that would be fetched over the
                    # network and minted into a resident Inform capability.  That
                    # download path is authenticated ONLY by a fused CRC-32 (in the
                    # download engine) plus integrity32(T) (in Mint).  Neither
                    # CRC-32 nor T is authentication — they detect accidental
                    # corruption, not attacker-controlled payload — and NO trusted
                    # externally-authenticated Mint identity/hash input exists on
                    # this hardware.  Promoting here would write attacker code into
                    # an NS entry + c-list slot (Mint FSM in core.py) and stamp the
                    # source CR with an E-perm Inform GT (PROMOTE_WRITE).
                    #
                    # Therefore the intercept is fault-closed immediately: this FSM
                    # transitions straight to FAULT WITHOUT ever asserting
                    # outform_start_out (so no download / alloc / Mint / NS / c-list
                    # write occurs) and WITHOUT ever reaching PROMOTE_WRITE (so
                    # cr_wr_en stays low and the source CR is never promoted).  The
                    # CALL that triggered the intercept never runs — the machine
                    # faults instead.
                    #
                    # TO RE-ENABLE network Outform promotion, a future revision must
                    # add an externally-authenticated Mint input (a trusted full
                    # identity/hash verified against the downloaded lump) and gate
                    # this transition on it; only then may the FSM proceed to
                    # TRIGGER_OUTFORM again.  Until then this MUST stay a hard fault.
                    m.d.sync += fault_type_lat.eq(FaultType.OUTFORM_UNAUTH)
                    m.next = "FAULT"

            # ── DEAD STATES (Task #2862) ──────────────────────────────────────
            # TRIGGER_OUTFORM / WAIT_OUTFORM / PROMOTE_WRITE / DONE implement the
            # OLD unauthenticated network Outform promotion path.  IDLE no longer
            # transitions here (it fault-closes with OUTFORM_UNAUTH), so these
            # states are unreachable: outform_start_out and cr_wr_en never assert.
            # They are retained, unmodified and dead, as the exact re-entry point
            # for a future revision that adds an externally-authenticated Mint
            # input — restoring the IDLE → TRIGGER_OUTFORM edge (gated on that
            # authenticated input) re-enables promotion.  Do NOT re-wire IDLE here
            # without it.
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
