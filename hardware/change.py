from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import (GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT,
                      LUMP_HEADER_LAYOUT, WORD2_LAYOUT)
from .mload import ChurchMLoad
from .thread_design import (
    THREAD_CAPS_OFFSET,
    THREAD_CAP_WORDS,
    THREAD_DR_OFFSET,
    THREAD_HEAP_OFFSET,
    THREAD_STO_OFFSET,
    THREAD_MIN_N_MINUS_6,
    THREAD_MAX_N_MINUS_6,
)


class ChurchChange(Elaboratable):
    def __init__(self):
        self.change_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(16)
        self.change_mask = Signal(16)
        self.change_busy = Signal()
        self.change_complete = Signal()
        self.change_fault = Signal()
        self.fault_type = Signal(5)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.cr_dst = Signal(4)       # 12/13 = system-wide; 14/15 = per-thread ctx switch
        self.m_elevated = Signal()    # 1 during boot — bypasses CR12/CR13 authority check

        self.cr12_thread = Signal(CAP_REG_LAYOUT)
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

        self.dr_rd_addr = Signal(4)
        self.dr_rd_data = Signal(32)
        # THREAD_HDR: hidden per-thread machine register.
        # On thread restore CHANGE reads Mem[thread_base+0] (the thread lump header
        # word) and stores it here. CALL reads stack bounds from this register
        # directly, eliminating FETCH_THREAD_HDR from the CALL pipeline.
        self.thread_hdr_out = Signal(32)

        # 1 during BOOT_PROGRAM microcode (same signal the core feeds u_call).
        # During the boot window LOAD_THREAD resolves the Thread NS slot via
        # mLoad's direct-GT path instead of fetching a GT from the namespace
        # c-list: NS slot 0 word1 is the namespace LIMIT word, and a GT's
        # slot_id occupies the same bits[15:0], so one word cannot serve both.
        self.boot_window = Signal()
        # Scheduler-only start path used by the physical M6 round-robin
        # control.  It is not an instruction privilege bypass: the target still
        # goes through the regular direct Namespace mLoad validation.  It only
        # supplies the trusted scheduler's target selector and asks CHANGE to
        # preserve a complete thread context.
        self.scheduler_mode = Signal()
        # CR12 remains the system Thread root; the physical scheduler carries
        # the active Thread body's backing address independently.
        self.active_thread_base = Signal(32)
        self.thread_base_restore_en = Signal()
        self.thread_base_restore_val = Signal(32)
        self.dr_wr_en = Signal()
        self.dr_wr_addr = Signal(4)
        self.dr_wr_data = Signal(32)
        self.nia_restore_en = Signal()
        self.nia_restore_val = Signal(32)
        self.flags_in = Signal(COND_FLAGS_LAYOUT)
        self.flags_restore_en = Signal()
        self.flags_restore_data = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        RESERVED_MASK = 0b1000_0001_1000_0000

        u_mload = ChurchMLoad()
        m.submodules.u_mload = u_mload

        cr_index = Signal(4)
        crn_reg_latched = Signal(CAP_REG_LAYOUT)
        index_latched    = Signal(16)
        mask_latched     = Signal(16)
        cr_src_latched   = Signal(4)   # latched at change_start; self.cr_src is only valid
        cr_dst_latched   = Signal(4)   # at the decode cycle; NIA advances before FSM runs
        scheduler_mode_lat = Signal()
        outgoing_thread_base = Signal(32)
        incoming_thread_base = Signal(32)
        thread_loaded = Signal()
        fault_latched    = Signal()
        fault_type_latched = Signal(5)

        # THREAD_HDR hidden register — loaded from Mem[thread_base+0] on thread restore.
        # No switch-out save is needed: the lump header is architecturally immutable
        # (code lumps are write-protected), so CHANGE always re-reads the same value
        # on the next switch-in.  The register is populated once per restore, consumed
        # by every CALL until the next thread switch (zero extra reads per CALL).
        thread_hdr_reg = Signal(32)
        fetch_thr_hdr_active = Signal()  # high during FETCH_THREAD_HDR state

        save_index = Signal(5)
        save_cr_index = Signal(4)
        restore_cr8_final = Signal()

        mload_start_reg = Signal()
        mload_done_latched = Signal()
        mload_fault_latched = Signal()

        effective_mask = Signal(16)
        # Boot-window (M-elevated) restore mask: CR0 only.
        # The decoder permanently scrubs call_mask to 0 (imm15 now carries a
        # method index, not a mask), which silently turned RESTORE_CALL into a
        # universal no-op — but BOOT_PROGRAM[2] = CALL CR0 depends on CHANGE
        # restoring CR0 from Thread.caps[0] (DMEM word 244). CR12 is installed
        # by the boot ladder and has no serialized Thread home.
        BOOT_RESTORE_MASK = (1 << 0)
        # Dormant Threads store only the twelve software capability homes.
        # CR14 is transparently derived from restored CR0 on every activation.
        SCHEDULER_RESTORE_MASK = (1 << THREAD_CAP_WORDS) - 1
        m.d.comb += effective_mask.eq(
            Mux(self.m_elevated,
                C(BOOT_RESTORE_MASK, 16),
                Mux(scheduler_mode_lat, C(SCHEDULER_RESTORE_MASK, 16),
                    mask_latched & ~RESERVED_MASK)))

        skip_current_cr = Signal()
        m.d.comb += skip_current_cr.eq(
            (cr_index > 14) |
            ~effective_mask.bit_select(cr_index, 1) |
            (scheduler_mode_lat & (cr_index == 8) & ~restore_cr8_final))

        crn_view = View(CAP_REG_LAYOUT, crn_reg_latched)
        crn_gt = View(GT_LAYOUT, crn_view.word0_gt)
        crn_has_l_perm = crn_gt.dom & crn_gt.perm[0]   # Church dom=1, perm[0]=L
        crn_has_s_perm = crn_gt.dom & crn_gt.perm[1]   # Church dom=1, perm[1]=S

        # Authority check for CHANGE CR12/CR13: source cap location must equal
        # the corresponding CR port address in the Church Hardware Address Range.
        cr_port_match = Signal()
        m.d.comb += cr_port_match.eq(
            Mux(cr_dst_latched == 12,
                crn_view.word1_location == CR_PORT_CR12,
                crn_view.word1_location == CR_PORT_CR13)
        )

        cr12_view = View(CAP_REG_LAYOUT, self.cr12_thread)
        cr12_gt = View(GT_LAYOUT, cr12_view.word0_gt)
        cr12_null = Signal()
        m.d.comb += cr12_null.eq(cr12_gt.gt_type == GT_TYPE_NULL)

        thread_base = cr12_view.word1_location
        restore_base = Mux(
            scheduler_mode_lat | thread_loaded,
            incoming_thread_base,
            thread_base)

        fetched_gt_latched = Signal(32)

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        mload_direct = Signal()
        mload_direct_gt = Signal(32)
        boot_window_lat = Signal()
        scheduler_gt_seq = Signal(9)
        entry_gt_latched = Signal(32)
        entry_raw_base = Signal(32)
        entry_header = Signal(32)

        # Boot-window direct Thread GT: Inform-type, S-perm, slot_id = CHANGE
        # index operand (BOOT_PROGRAM[1] = CHANGE CR12, CR15[1] → NS slot 1).
        boot_thread_gt = Signal(32)
        boot_gt_view = View(GT_LAYOUT, boot_thread_gt)
        m.d.comb += [
            boot_gt_view.slot_id.eq(index_latched),
            # Scheduler direct-mLoad has no c-list GT from which to inherit a
            # generation. The target descriptor is read first so ns_gate keeps
            # enforcing the normal generation/revocation check.
            boot_gt_view.gt_seq.eq(Mux(scheduler_mode_lat, scheduler_gt_seq, 0)),
            boot_gt_view.gt_type.eq(GT_TYPE_INFORM),
            boot_gt_view.dom.eq(1),
            # Scheduler also walks the Thread body's caps through CR8, so its
            # validated transient Thread capability needs L as well as S.
            boot_gt_view.perm.eq(
                Mux(scheduler_mode_lat,
                    (PERM_MASK_L | PERM_MASK_S) >> 3,
                    PERM_MASK_S >> 3)),
        ]

        m.d.comb += [
            u_mload.sub_start.eq(mload_start_reg),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(mload_direct),
            u_mload.sub_direct_gt.eq(Mux(mload_direct, mload_direct_gt, 0)),
            u_mload.sub_m_elevated.eq(self.m_elevated),
            u_mload.sub_validate_only.eq(0),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            # Forward the internal mload's register-read address by default so
            # its FETCH_SRC reads the real source cap (e.g. CR8 during
            # RESTORE_CALL).  FSM states that need their own reads override
            # this with later comb assignments.
            self.cr_rd_addr.eq(u_mload.cr_rd_addr),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        mem_wr_addr_reg = Signal(32)
        mem_wr_data_reg = Signal(32)
        mem_wr_en_reg = Signal()

        # Direct memory-read path used by scheduler restore/header derivation.
        direct_rd_active = Signal()
        direct_rd_addr = Signal(32)
        preflight_hdr_active = Signal()
        preflight_base = Signal(32)
        preflight_rd_armed = Signal()
        restore_rd_armed = Signal()
        restore_word = Signal(32)
        indicator_word = Signal(32)
        scheduler_ns_active = Signal()
        scheduler_ns_rd_armed = Signal()
        scheduler_ns_addr = Signal(32)
        scheduler_ns_view = View(CAP_REG_LAYOUT, self.cr15_namespace)
        m.d.comb += scheduler_ns_addr.eq(
            scheduler_ns_view.word1_location + (index_latched << 4) + 4)

        cr5_install_active = Signal()
        cr5_cap = Signal(CAP_REG_LAYOUT)

        thr_hdr_view = View(LUMP_HEADER_LAYOUT, thread_hdr_reg)
        entry_hdr_view = View(LUMP_HEADER_LAYOUT, entry_header)
        entry_gt_view = View(GT_LAYOUT, entry_gt_latched)
        entry_cr14 = Signal(CAP_REG_LAYOUT)
        entry_cr14_view = View(CAP_REG_LAYOUT, entry_cr14)
        entry_cr14_gt = View(GT_LAYOUT, entry_cr14_view.word0_gt)
        entry_cr14_w2 = View(WORD2_LAYOUT, entry_cr14_view.word2_w2)
        cr5_cap_view = View(CAP_REG_LAYOUT, cr5_cap)
        cr5_new_gt   = View(GT_LAYOUT, cr5_cap_view.word0_gt)
        m.d.comb += [
            cr5_new_gt.slot_id.eq(0),
            cr5_new_gt.gt_seq.eq(0),
            cr5_new_gt.gt_type.eq(GT_TYPE_INFORM),
            # Turing domain (dom=0): perm=0b011 (R=perm[0]=1, W=perm[1]=1, X=perm[2]=0)
            cr5_new_gt.dom.eq(0),
            cr5_new_gt.perm.eq(0b011),   # R+W in Turing domain
            cr5_new_gt.b_flag.eq(0),
            cr5_cap_view.word1_location.eq(
                restore_base + (THREAD_HEAP_OFFSET << 2)),
            cr5_cap_view.word2_w2.eq(thr_hdr_view.cc - 1),
            entry_cr14_gt.slot_id.eq(entry_gt_view.slot_id),
            entry_cr14_gt.gt_seq.eq(entry_gt_view.gt_seq),
            entry_cr14_gt.gt_type.eq(entry_gt_view.gt_type),
            entry_cr14_gt.dom.eq(0),
            entry_cr14_gt.perm.eq(0b101),
            entry_cr14_gt.b_flag.eq(entry_gt_view.b_flag),
            entry_cr14_view.word1_location.eq(entry_raw_base + 4),
            entry_cr14_w2.limit_offset.eq(entry_hdr_view.cw - 1),
            entry_cr14_w2.gt_seq.eq(entry_gt_view.gt_seq),
            entry_cr14_w2.g_bit.eq(0),
            entry_cr14_w2.f_flag.eq(0),
        ]

        m.d.comb += [
            self.mem_wr_addr.eq(mem_wr_addr_reg),
            self.mem_wr_data.eq(mem_wr_data_reg),
            self.mem_wr_en.eq(mem_wr_en_reg),
            # Priority: preflight > scheduler descriptor > direct restore > thread-header > u_mload
            self.mem_rd_addr.eq(
                Mux(preflight_hdr_active, preflight_base,
                    Mux(scheduler_ns_active, scheduler_ns_addr,
                        Mux(direct_rd_active, direct_rd_addr,
                            Mux(fetch_thr_hdr_active, restore_base, u_mload.mem_addr))))
            ),
            self.mem_rd_en.eq(preflight_hdr_active | scheduler_ns_active |
                               direct_rd_active | fetch_thr_hdr_active |
                               u_mload.mem_rd_en),
            # CR5 install override: INSTALL_CR5 takes priority over u_mload writes
            self.cr_wr_addr.eq(Mux(cr5_install_active, 5, u_mload.cr_wr_addr)),
            self.cr_wr_data.eq(Mux(cr5_install_active, cr5_cap, u_mload.cr_wr_data)),
            self.cr_wr_en.eq(u_mload.cr_wr_en | cr5_install_active),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
            self.thread_hdr_out.eq(thread_hdr_reg),
            self.thread_base_restore_en.eq(0),
            self.thread_base_restore_val.eq(incoming_thread_base),
            self.dr_wr_en.eq(0),
            self.dr_wr_addr.eq(save_index[:4]),
            self.dr_wr_data.eq(restore_word),
            self.nia_restore_en.eq(0),
            self.nia_restore_val.eq(entry_raw_base + 4),
            self.flags_restore_en.eq(0),
            self.flags_restore_data.eq(indicator_word[28:32]),
        ]

        # Default: mload_start_reg self-clears every cycle; the FSM states that
        # need the internal mload (LOAD_THREAD / RESTORE_CALL / CR12_CR13_LOAD)
        # re-assert it (their m.d.sync assignment overrides this default).
        # Without this, mload_start_reg stayed 1 after CHANGE completed and the
        # internal mload restarted forever, hogging the DMEM bus mux (u_change
        # has priority over u_call) and starving the boot CALL's FETCH_LUMP.
        m.d.sync += mload_start_reg.eq(0)

        with m.FSM(name="change") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(self.change_start):
                    m.d.sync += [
                        index_latched.eq(self.index),
                        mask_latched.eq(self.change_mask),
                        cr_src_latched.eq(self.cr_src),
                        cr_dst_latched.eq(self.cr_dst),
                        scheduler_mode_lat.eq(self.scheduler_mode),
                        cr_index.eq(0),
                        save_index.eq(0),
                        save_cr_index.eq(0),
                        restore_cr8_final.eq(0),
                        boot_window_lat.eq(self.boot_window),
                        outgoing_thread_base.eq(
                            Mux(self.scheduler_mode, self.active_thread_base,
                                cr12_view.word1_location)),
                        thread_loaded.eq(0),
                    ]
                    m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                    m.next = "READ_CRN"

            with m.State("READ_CRN"):
                m.d.comb += self.cr_rd_addr.eq(cr_src_latched)
                m.next = "LATCH_CRN"

            with m.State("LATCH_CRN"):
                m.d.sync += crn_reg_latched.eq(self.cr_rd_data)
                m.d.comb += self.cr_rd_addr.eq(cr_src_latched)
                with m.If((cr_dst_latched == 12) | (cr_dst_latched == 13)):
                    # CR12/CR13 system-wide: authority check happens in next state
                    # (crn_reg_latched will be valid there)
                    m.next = "CHECK_CR12_AUTH"
                with m.Elif(scheduler_mode_lat):
                    # Preflight the target descriptor and private Thread body
                    # before SAVE_DR writes the outgoing context.  Fetch its
                    # live W2 first so the direct scheduler GT carries the
                    # descriptor's revocation generation.
                    m.next = "SCHED_FETCH_AUTH"
                with m.Elif(~crn_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Elif(cr12_null):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "SAVE_DR"

            with m.State("SCHED_FETCH_AUTH"):
                # Namespace entries are four words; W1 (authority + sequence)
                # is byte offset 4. The read port is synchronous, so arm this
                # request before accepting the following valid cycle.
                m.d.comb += scheduler_ns_active.eq(1)
                m.d.sync += scheduler_ns_rd_armed.eq(1)
                m.next = "SCHED_LATCH_AUTH"

            with m.State("SCHED_LATCH_AUTH"):
                m.d.comb += scheduler_ns_active.eq(1)
                with m.If(self.mem_rd_valid & scheduler_ns_rd_armed):
                    m.d.sync += [
                        scheduler_ns_rd_armed.eq(0),
                        scheduler_gt_seq.eq(View(WORD2_LAYOUT, self.mem_rd_data).gt_seq),
                    ]
                    m.next = "PREFLIGHT"

            with m.State("CHECK_CR12_AUTH"):
                # crn_reg_latched is valid here (latched at end of LATCH_CRN).
                # M-elevated boot path bypasses authority and jumps directly to
                # LOAD_THREAD (skipping SAVE_DR context save, as BOOT_PROGRAM
                # runs before any thread context exists to save).  RESTORE_CALL
                # then loads CR0–CR11 from the thread caps zone.
                # Post-boot (m_elevated=False) requires:
                #   • source cap carries S-perm
                #   • source cap location matches the target CR's port address
                with m.If(self.m_elevated):
                    m.next = "LOAD_THREAD"
                with m.Elif(~crn_has_s_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_S)]
                    m.next = "FAULT"
                with m.Elif(~cr_port_match):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_S)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CR12_CR13_LOAD"

            with m.State("CR12_CR13_LOAD"):
                # Load the GT from NS[index] (via source cap authority) directly
                # into CR12 or CR13 — no per-thread context save/restore.
                m.d.comb += [
                    mload_src.eq(cr_src_latched),
                    mload_dst.eq(cr_dst_latched),
                    mload_index.eq(index_latched),
                ]
                # One-shot: drop start as soon as this pass's mload completes,
                # otherwise the still-high start restarts the mload with stale
                # latched operands the moment it returns to IDLE.
                m.d.sync += mload_start_reg.eq(
                    ~(u_mload.sub_done | u_mload.sub_fault
                      | mload_done_latched | mload_fault_latched))
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(u_mload.sub_done):
                    m.d.sync += mload_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += mload_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(mload_fault_latched):
                    m.next = "FAULT"
                with m.Elif(mload_done_latched):
                    m.next = "COMPLETE"

            with m.State("PREFLIGHT"):
                # Direct mLoad validates the projected Namespace entry,
                # including its authority, generation, integrity, and bounds,
                # without changing a CR or clearing its G-bit.
                m.d.comb += [
                    mload_src.eq(cr_src_latched),
                    mload_dst.eq(Mux(scheduler_mode_lat, 8, cr_dst_latched)),
                    mload_index.eq(index_latched),
                    mload_direct.eq(1),
                    mload_direct_gt.eq(boot_thread_gt),
                    u_mload.sub_validate_only.eq(1),
                ]
                m.d.sync += mload_start_reg.eq(
                    ~(u_mload.sub_done | u_mload.sub_fault |
                      mload_done_latched | mload_fault_latched))
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(u_mload.sub_done):
                    m.d.sync += [
                        mload_done_latched.eq(1),
                        preflight_base.eq(u_mload.resolved_base),
                        incoming_thread_base.eq(u_mload.resolved_base),
                    ]
                with m.If(u_mload.sub_fault):
                    m.d.sync += [
                        mload_fault_latched.eq(1),
                        fault_latched.eq(1),
                        fault_type_latched.eq(u_mload.sub_fault_type),
                    ]
                with m.If(mload_fault_latched):
                    m.next = "FAULT"
                with m.Elif(mload_done_latched):
                    m.next = "PREFLIGHT_HDR"

            with m.State("PREFLIGHT_HDR"):
                # Private body must use a supported Thread allocation before
                # outgoing DR/CR state is persisted. The shared contract
                # currently admits only the fully-defined 256-word layout.
                m.d.comb += preflight_hdr_active.eq(1)
                # The DMEM read port is shared and synchronous; arm one cycle
                # before accepting valid so a final Namespace-gate response
                # cannot be mistaken for the target Thread header.
                m.d.sync += preflight_rd_armed.eq(1)
                with m.If(self.mem_rd_valid & preflight_rd_armed):
                    m.d.sync += preflight_rd_armed.eq(0)
                    # A Thread is admitted only when its header conforms to
                    # the normative fixed private ABI.  cw is stack words,
                    # cc is heap words, and the two zones must leave a
                    # non-overlapping boundary before capabilities at +244.
                    with m.If((self.mem_rd_data[27:32] == 0x1F) &
                              (self.mem_rd_data[8:10] == 2) &
                              (self.mem_rd_data[23:27] >= THREAD_MIN_N_MINUS_6) &
                              (self.mem_rd_data[23:27] <= THREAD_MAX_N_MINUS_6) &
                              (self.mem_rd_data[10:23] > 0) &
                              (self.mem_rd_data[0:8] > 0) &
                              ((self.mem_rd_data[10:23] +
                                self.mem_rd_data[0:8]) <=
                               (THREAD_CAPS_OFFSET - THREAD_HEAP_OFFSET))):
                        m.next = "SAVE_CR_READ"
                    with m.Else():
                        m.d.sync += [
                            fault_latched.eq(1),
                            fault_type_latched.eq(FaultType.BOUNDS),
                        ]
                        m.next = "FAULT"

            with m.State("SAVE_CR_READ"):
                # Scheduler contexts preserve the canonical GT word for every
                # private CR. On restore mLoad reconstructs location/authority
                # from the current sealed Namespace descriptor rather than
                # trusting stale mutable register metadata.
                m.d.comb += self.cr_rd_addr.eq(save_cr_index)
                m.next = "SAVE_CR_WRITE"

            with m.State("SAVE_CR_WRITE"):
                m.d.comb += [
                    self.cr_rd_addr.eq(save_cr_index),
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(
                        outgoing_thread_base + ((THREAD_CAPS_OFFSET + save_cr_index) << 2)),
                    mem_wr_data_reg.eq(self.cr_rd_data.as_value()[:32]),
                ]
                with m.If(self.mem_wr_done):
                    with m.If(save_cr_index == THREAD_CAP_WORDS - 1):
                        m.next = "SAVE_DR"
                    with m.Else():
                        m.d.sync += save_cr_index.eq(save_cr_index + 1)
                        m.next = "SAVE_CR_READ"

            with m.State("SAVE_DR"):
                m.d.comb += self.dr_rd_addr.eq(save_index[:4])
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(outgoing_thread_base + ((THREAD_DR_OFFSET + save_index) << 2)),
                    mem_wr_data_reg.eq(self.dr_rd_data),
                ]
                with m.If(self.mem_wr_done):
                    m.d.sync += save_index.eq(save_index + 1)
                    with m.If(save_index >= 15):
                        m.d.sync += restore_rd_armed.eq(0)
                        m.next = "SAVE_INDICATOR_READ"

            with m.State("SAVE_INDICATOR_READ"):
                m.d.comb += [
                    direct_rd_active.eq(1),
                    direct_rd_addr.eq(
                        outgoing_thread_base + (THREAD_STO_OFFSET << 2)),
                ]
                with m.If(~restore_rd_armed):
                    m.d.sync += restore_rd_armed.eq(1)
                with m.Elif(self.mem_rd_valid):
                    m.d.sync += [
                        indicator_word.eq(self.mem_rd_data),
                        restore_rd_armed.eq(0),
                    ]
                    m.next = "SAVE_INDICATOR_WRITE"

            with m.State("SAVE_INDICATOR_WRITE"):
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(
                        outgoing_thread_base + (THREAD_STO_OFFSET << 2)),
                    mem_wr_data_reg.eq(Cat(
                        indicator_word[:13], Const(0, 15),
                        self.flags_in.as_value())),
                ]
                with m.If(self.mem_wr_done):
                    m.next = "LOAD_THREAD"

            with m.State("LOAD_THREAD"):
                m.d.comb += [
                    mload_src.eq(cr_src_latched),
                    mload_dst.eq(8),
                    mload_index.eq(index_latched),
                    # Boot window: resolve NS slot <index> directly (see
                    # boot_window comment in __init__) — skips the c-list
                    # GT fetch that would misread the namespace limit word.
                    mload_direct.eq(boot_window_lat | scheduler_mode_lat),
                    mload_direct_gt.eq(boot_thread_gt),
                ]
                # One-shot: drop start as soon as this pass's mload completes,
                # otherwise the still-high start restarts the mload with stale
                # latched operands the moment it returns to IDLE.
                m.d.sync += mload_start_reg.eq(
                    ~(u_mload.sub_done | u_mload.sub_fault
                      | mload_done_latched | mload_fault_latched))
                m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                with m.If(u_mload.sub_done):
                    m.d.sync += mload_done_latched.eq(1)
                    m.d.sync += fetched_gt_latched.eq(self.cr_rd_data.as_value()[:32])
                    m.d.sync += incoming_thread_base.eq(u_mload.resolved_base)
                    m.d.sync += thread_loaded.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += mload_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(mload_fault_latched):
                    m.next = "FAULT"
                with m.Elif(mload_done_latched):
                    m.d.sync += cr_index.eq(0)
                    m.next = "RESTORE_CALL"

            with m.State("RESTORE_CALL"):
                m.d.comb += [
                    mload_src.eq(8),
                    mload_dst.eq(cr_index),
                    # Thread.caps[n] is at thread_lump_base + (THREAD_CAPS_OFFSET+n)*4.
                    # CR8.word1_location = thread_lump_base (set by LOAD_THREAD ns_gate).
                    # Using THREAD_CAPS_OFFSET+cr_index addresses caps[0] at word 244
                    # and caps[n] at word 244+n, matching the hardware thread layout.
                    mload_index.eq(THREAD_CAPS_OFFSET + cr_index),
                ]
                with m.If(skip_current_cr):
                    m.d.sync += cr_index.eq(cr_index + 1)
                    with m.If(cr_index >= 15):
                        with m.If(scheduler_mode_lat & ~restore_cr8_final):
                            m.d.sync += [
                                cr_index.eq(8),
                                restore_cr8_final.eq(1),
                            ]
                            m.next = "RESTORE_CALL"
                        with m.Elif(scheduler_mode_lat):
                            m.next = "RESTORE_DR"
                        with m.Else():
                            m.next = "FETCH_THREAD_HDR"
                with m.Else():
                    m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                    # One-shot: drop start as soon as this pass's mload completes,
                    # otherwise the still-high start restarts the mload with stale
                    # latched operands the moment it returns to IDLE.
                    m.d.sync += mload_start_reg.eq(
                        ~(u_mload.sub_done | u_mload.sub_fault
                          | mload_done_latched | mload_fault_latched))
                    with m.If(u_mload.sub_done):
                        m.d.sync += mload_done_latched.eq(1)
                    with m.If(u_mload.sub_fault):
                        m.d.sync += mload_fault_latched.eq(1)
                        m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                    with m.If(mload_fault_latched):
                        m.next = "FAULT"
                    with m.Elif(mload_done_latched):
                        m.next = "RESTORE_NEXT"

            with m.State("RESTORE_NEXT"):
                m.d.sync += cr_index.eq(cr_index + 1)
                with m.If(scheduler_mode_lat & restore_cr8_final):
                    m.d.sync += [
                        save_index.eq(0),
                        restore_rd_armed.eq(0),
                    ]
                    m.next = "RESTORE_DR"
                with m.Elif(scheduler_mode_lat & (cr_index >= 11)):
                    m.d.sync += [
                        cr_index.eq(8),
                        restore_cr8_final.eq(1),
                    ]
                    m.next = "RESTORE_CALL"
                with m.Elif(cr_index >= 15):
                    with m.If(scheduler_mode_lat):
                        m.d.sync += [
                            save_index.eq(0),
                            restore_rd_armed.eq(0),
                        ]
                        m.next = "RESTORE_DR"
                    with m.Else():
                        m.next = "FETCH_THREAD_HDR"
                with m.Else():
                    m.next = "RESTORE_CALL"

            with m.State("RESTORE_DR"):
                m.d.comb += [
                    direct_rd_active.eq(1),
                    direct_rd_addr.eq(
                        restore_base + ((THREAD_DR_OFFSET + save_index) << 2)),
                ]
                with m.If(~restore_rd_armed):
                    m.d.sync += restore_rd_armed.eq(1)
                with m.Elif(self.mem_rd_valid):
                    m.d.sync += [
                        restore_word.eq(self.mem_rd_data),
                        restore_rd_armed.eq(0),
                    ]
                    m.next = "RESTORE_DR_WRITE"

            with m.State("RESTORE_DR_WRITE"):
                m.d.comb += [
                    self.dr_wr_en.eq(1),
                    self.dr_wr_addr.eq(save_index[:4]),
                    self.dr_wr_data.eq(restore_word),
                ]
                with m.If(save_index >= 15):
                    m.d.sync += restore_rd_armed.eq(0)
                    m.next = "RESTORE_INDICATOR"
                with m.Else():
                    m.d.sync += save_index.eq(save_index + 1)
                    m.next = "RESTORE_DR"

            with m.State("RESTORE_INDICATOR"):
                m.d.comb += [
                    direct_rd_active.eq(1),
                    direct_rd_addr.eq(
                        restore_base + (THREAD_STO_OFFSET << 2)),
                ]
                with m.If(~restore_rd_armed):
                    m.d.sync += restore_rd_armed.eq(1)
                with m.Elif(self.mem_rd_valid):
                    m.d.sync += [
                        indicator_word.eq(self.mem_rd_data),
                        restore_rd_armed.eq(0),
                    ]
                    m.next = "RESTORE_INDICATOR_COMMIT"

            with m.State("RESTORE_INDICATOR_COMMIT"):
                m.d.comb += self.flags_restore_en.eq(1)
                m.next = "ENTRY_CR0_READ"

            with m.State("ENTRY_CR0_READ"):
                m.d.comb += self.cr_rd_addr.eq(0)
                m.next = "ENTRY_CR0_LATCH"

            with m.State("ENTRY_CR0_LATCH"):
                m.d.comb += self.cr_rd_addr.eq(0)
                m.d.sync += entry_gt_latched.eq(
                    View(CAP_REG_LAYOUT, self.cr_rd_data).word0_gt.as_value())
                m.next = "ENTRY_VALIDATE"

            with m.State("ENTRY_VALIDATE"):
                with m.If(
                    (entry_gt_view.gt_type != GT_TYPE_INFORM) |
                    ~entry_gt_view.dom |
                    ~entry_gt_view.perm[2]
                ):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_E),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.d.comb += [
                        mload_dst.eq(14),
                        mload_direct.eq(1),
                        mload_direct_gt.eq(entry_gt_latched),
                        u_mload.sub_validate_only.eq(1),
                    ]
                    m.d.sync += mload_start_reg.eq(
                        ~(u_mload.sub_done | u_mload.sub_fault |
                          mload_done_latched | mload_fault_latched))
                    m.d.sync += [mload_done_latched.eq(0), mload_fault_latched.eq(0)]
                    with m.If(u_mload.sub_done):
                        m.d.sync += [
                            mload_done_latched.eq(1),
                            entry_raw_base.eq(u_mload.resolved_base),
                        ]
                    with m.If(u_mload.sub_fault):
                        m.d.sync += [
                            mload_fault_latched.eq(1),
                            fault_latched.eq(1),
                            fault_type_latched.eq(u_mload.sub_fault_type),
                        ]
                    with m.If(mload_fault_latched):
                        m.next = "FAULT"
                    with m.Elif(mload_done_latched):
                        m.d.sync += restore_rd_armed.eq(0)
                        m.next = "ENTRY_HEADER"

            with m.State("ENTRY_HEADER"):
                m.d.comb += [
                    direct_rd_active.eq(1),
                    direct_rd_addr.eq(entry_raw_base),
                ]
                with m.If(~restore_rd_armed):
                    m.d.sync += restore_rd_armed.eq(1)
                with m.Elif(self.mem_rd_valid):
                    m.d.sync += [
                        entry_header.eq(self.mem_rd_data),
                        restore_rd_armed.eq(0),
                    ]
                    with m.If((self.mem_rd_data[27:32] == 0x1F) &
                              (self.mem_rd_data[10:23] != 0)):
                        m.next = "ENTRY_COMMIT"
                    with m.Else():
                        m.d.sync += [
                            fault_latched.eq(1),
                            fault_type_latched.eq(FaultType.BOUNDS),
                        ]
                        m.next = "FAULT"

            with m.State("ENTRY_COMMIT"):
                m.d.comb += [
                    self.cr_wr_addr.eq(14),
                    self.cr_wr_data.eq(entry_cr14),
                    self.cr_wr_en.eq(1),
                    self.nia_restore_en.eq(1),
                    self.nia_restore_val.eq(entry_raw_base + 4),
                ]
                m.next = "FETCH_THREAD_HDR"

            with m.State("FETCH_THREAD_HDR"):
                # After RESTORE_CALL the incoming thread's CRs are all committed
                # to the register file, so CR12 now holds the new thread capability.
                # CR12 is M-elevated (perms always 0) — validate null only.
                #
                # M-elevated exception: during BOOT_PROGRAM microcode, the CHANGE
                # mask is 0 (decoder scrubs call_mask to 0), so RESTORE_CALL skips
                # all ordinary CR homes and CR12 remains null. The boot path does not need
                # thread-header validation (there is no existing thread stack to
                # bound-check), so we bypass the null check and use thread_hdr=0.
                with m.If(scheduler_mode_lat):
                    m.next = "READ_THREAD_HDR"
                with m.Elif(cr12_null & ~self.m_elevated):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Elif(cr12_null & self.m_elevated):
                    # M-elevated + null CR12: skip header read, default hdr=0.
                    m.d.sync += thread_hdr_reg.eq(0)
                    m.next = "INSTALL_CR5"
                with m.Else():
                    m.next = "READ_THREAD_HDR"

            with m.State("READ_THREAD_HDR"):
                # thread_base = CR12.word1_location = the incoming thread lump base.
                # Read Mem[thread_base+0] (the lump header word) and store in
                # THREAD_HDR — CALL uses it for stack-bound validation on every call
                # without any additional memory reads.
                m.d.comb += fetch_thr_hdr_active.eq(1)
                with m.If(~restore_rd_armed):
                    m.d.sync += restore_rd_armed.eq(1)
                with m.Elif(self.mem_rd_valid):
                    m.d.sync += [
                        thread_hdr_reg.eq(self.mem_rd_data),
                        restore_rd_armed.eq(0),
                    ]
                    m.next = "INSTALL_CR5"

            with m.State("INSTALL_CR5"):
                # Synthesise the Zone ④ heap GT from the incoming thread's lump header
                # and install it into CR5 (the heap cap).
                # CR5 covers only ordinary heap words. The protected STO word
                # at +17 is outside this capability.
                # base = thread_base + 18 words; limit_offset = heapWords - 1.
                m.d.comb += cr5_install_active.eq(1)
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                with m.If(thread_loaded):
                    m.d.comb += self.thread_base_restore_en.eq(1)
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.change_busy.eq(~fsm.ongoing("IDLE")),
            self.change_complete.eq(fsm.ongoing("COMPLETE")),
            self.change_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
        ]

        return m
