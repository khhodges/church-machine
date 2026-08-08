from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT, LUMP_HEADER_LAYOUT
from .mload import ChurchMLoad

# Offset (in words) from the thread lump base to the first thread capability.
# Thread.caps[0..14] live at thread_lump_base + THREAD_CAPS_OFFSET*4 .. +58.
# RESTORE_CALL loads CR0–CR14 by reading CR8[THREAD_CAPS_OFFSET + cr_index].
# Cross-reference: simulator.js THREAD_CAPS_OFFSET, hw_types.py §"Thread layout".
THREAD_CAPS_OFFSET = 244


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
        self.nia = Signal(32)
        self.flags = Signal(COND_FLAGS_LAYOUT)

        # THREAD_HDR: hidden per-thread machine register.
        # On thread restore CHANGE reads Mem[thread_base+0] (the thread lump header
        # word) and stores it here. CALL reads stack bounds from this register
        # directly, eliminating FETCH_THREAD_HDR from the CALL pipeline.
        self.thread_hdr_out = Signal(32)

        # M-flag save/restore (Task #432)
        # cr15_m_flag_in:   current thread's M-flag (from u_regs) — saved on switch-out
        # m_flag_restore_en:  pulses 1 when new thread's M-flag is ready to restore
        # m_flag_restore_val: the M-flag value for the incoming thread
        self.cr15_m_flag_in     = Signal()
        self.m_flag_restore_en  = Signal()
        self.m_flag_restore_val = Signal()

        # 1 during BOOT_PROGRAM microcode (same signal the core feeds u_call).
        # During the boot window LOAD_THREAD resolves the Thread NS slot via
        # mLoad's direct-GT path instead of fetching a GT from the namespace
        # c-list: NS slot 0 word1 is the namespace LIMIT word, and a GT's
        # slot_id occupies the same bits[15:0], so one word cannot serve both.
        self.boot_window = Signal()

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

        mload_start_reg = Signal()
        mload_done_latched = Signal()
        mload_fault_latched = Signal()

        effective_mask = Signal(16)
        # Boot-window (M-elevated) restore mask: CR0 + CR12 only.
        # The decoder permanently scrubs call_mask to 0 (imm15 now carries a
        # method index, not a mask), which silently turned RESTORE_CALL into a
        # universal no-op — but BOOT_PROGRAM[2] = CALL CR0 depends on CHANGE
        # restoring CR0 from Thread.caps[0] (DMEM word 244) and CR12 from
        # caps[12] (word 256).  Restore exactly those two during boot.
        BOOT_RESTORE_MASK = (1 << 0) | (1 << 12)
        m.d.comb += effective_mask.eq(
            Mux(self.m_elevated,
                C(BOOT_RESTORE_MASK, 16),
                mask_latched & ~RESERVED_MASK))

        skip_current_cr = Signal()
        m.d.comb += skip_current_cr.eq((cr_index > 14) | ~effective_mask.bit_select(cr_index, 1))

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

        cr7_base = Signal(32)

        fetched_gt_latched = Signal(32)

        DR_OFFSET = 1
        PACKED_PC_OFFSET = 17
        M_FLAG_OFFSET   = 18   # thread_base + 72: saved M-flag word (LSB = flag value)

        pc_offset = Signal(32)
        packed_pc_word = Signal(32)
        m.d.comb += pc_offset.eq(self.nia - cr7_base)
        m.d.comb += packed_pc_word.eq(Cat(pc_offset[:28], self.flags))

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        mload_direct = Signal()
        boot_window_lat = Signal()

        # Boot-window direct Thread GT: Inform-type, S-perm, slot_id = CHANGE
        # index operand (BOOT_PROGRAM[1] = CHANGE CR12, CR15[1] → NS slot 1).
        boot_thread_gt = Signal(32)
        boot_gt_view = View(GT_LAYOUT, boot_thread_gt)
        m.d.comb += [
            boot_gt_view.slot_id.eq(index_latched),
            boot_gt_view.gt_type.eq(GT_TYPE_INFORM),
            boot_gt_view.dom.eq(1),
            boot_gt_view.perm.eq(PERM_MASK_S >> 1),
        ]

        m.d.comb += [
            u_mload.sub_start.eq(mload_start_reg),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(mload_direct),
            u_mload.sub_direct_gt.eq(Mux(mload_direct, boot_thread_gt, 0)),
            u_mload.sub_m_elevated.eq(1),
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

        # Direct memory-read path used by RESTORE_M_FLAG_RD (bypasses u_mload)
        mflag_rd_active   = Signal()
        mflag_rd_addr     = Signal(32)
        mflag_val_latched = Signal()

        cr5_install_active = Signal()
        cr5_cap = Signal(CAP_REG_LAYOUT)

        thr_hdr_view = View(LUMP_HEADER_LAYOUT, thread_hdr_reg)
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
            cr5_cap_view.word1_location.eq(thread_base + (17 << 2)),
            cr5_cap_view.word2_w2.eq(thr_hdr_view.cc - 1),
        ]

        m.d.comb += [
            self.mem_wr_addr.eq(mem_wr_addr_reg),
            self.mem_wr_data.eq(mem_wr_data_reg),
            self.mem_wr_en.eq(mem_wr_en_reg),
            # Priority: mflag_rd_active > fetch_thr_hdr_active > u_mload
            self.mem_rd_addr.eq(
                Mux(mflag_rd_active, mflag_rd_addr,
                    Mux(fetch_thr_hdr_active, thread_base, u_mload.mem_addr))
            ),
            self.mem_rd_en.eq(mflag_rd_active | fetch_thr_hdr_active | u_mload.mem_rd_en),
            # Default m_flag_restore outputs low (overridden in RESTORE_M_FLAG_LATCH)
            self.m_flag_restore_en.eq(0),
            self.m_flag_restore_val.eq(0),
            # CR5 install override: INSTALL_CR5 takes priority over u_mload writes
            self.cr_wr_addr.eq(Mux(cr5_install_active, 5, u_mload.cr_wr_addr)),
            self.cr_wr_data.eq(Mux(cr5_install_active, cr5_cap, u_mload.cr_wr_data)),
            self.cr_wr_en.eq(u_mload.cr_wr_en | cr5_install_active),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
            self.thread_hdr_out.eq(thread_hdr_reg),
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
                        cr_index.eq(0),
                        save_index.eq(0),
                        boot_window_lat.eq(self.boot_window),
                    ]
                    m.d.comb += self.cr_rd_addr.eq(7)
                    m.next = "READ_CR7"

            with m.State("READ_CR7"):
                m.d.comb += self.cr_rd_addr.eq(7)
                m.next = "LATCH_CR7"

            with m.State("LATCH_CR7"):
                m.d.comb += self.cr_rd_addr.eq(7)
                cr7_rd_view = View(CAP_REG_LAYOUT, self.cr_rd_data)
                m.d.sync += cr7_base.eq(cr7_rd_view.word1_location)
                m.d.comb += self.cr_rd_addr.eq(cr_src_latched)
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
                with m.Elif(~crn_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Elif(cr12_null):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "SAVE_DR"

            with m.State("CHECK_CR12_AUTH"):
                # crn_reg_latched is valid here (latched at end of LATCH_CRN).
                # M-elevated boot path bypasses authority and jumps directly to
                # LOAD_THREAD (skipping SAVE_DR context save, as BOOT_PROGRAM
                # runs before any thread context exists to save).  RESTORE_CALL
                # then loads CR0–CR14 from the thread caps zone.
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

            with m.State("SAVE_DR"):
                m.d.comb += self.dr_rd_addr.eq(save_index[:4])
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(thread_base + ((DR_OFFSET + save_index) << 2)),
                    mem_wr_data_reg.eq(self.dr_rd_data),
                ]
                with m.If(self.mem_wr_done):
                    m.d.sync += save_index.eq(save_index + 1)
                    with m.If(save_index >= 15):
                        m.next = "SAVE_PACKED_PC"

            with m.State("SAVE_PACKED_PC"):
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(thread_base + (PACKED_PC_OFFSET << 2)),
                    mem_wr_data_reg.eq(packed_pc_word),
                ]
                with m.If(self.mem_wr_done):
                    m.next = "SAVE_M_FLAG"

            with m.State("SAVE_M_FLAG"):
                # Write current thread's M-flag to Mem[thread_base + M_FLAG_OFFSET * 4].
                # thread_base here is still the OLD thread's base (before LOAD_THREAD).
                m.d.comb += [
                    mem_wr_en_reg.eq(1),
                    mem_wr_addr_reg.eq(thread_base + (M_FLAG_OFFSET << 2)),
                    mem_wr_data_reg.eq(self.cr15_m_flag_in),
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
                    mload_direct.eq(boot_window_lat),
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
                    with m.If(cr_index >= 14):
                        m.next = "RESTORE_M_FLAG_RD"
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
                with m.If(cr_index >= 14):
                    m.next = "RESTORE_M_FLAG_RD"
                with m.Else():
                    m.next = "RESTORE_CALL"

            with m.State("RESTORE_M_FLAG_RD"):
                # Issue a direct memory read to Mem[thread_base + M_FLAG_OFFSET * 4].
                # thread_base at this point is the INCOMING thread's base address
                # (loaded during LOAD_THREAD).
                m.d.comb += [
                    mflag_rd_active.eq(1),
                    mflag_rd_addr.eq(thread_base + (M_FLAG_OFFSET << 2)),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += mflag_val_latched.eq(self.mem_rd_data[0])
                    m.next = "RESTORE_M_FLAG_LATCH"

            with m.State("RESTORE_M_FLAG_LATCH"):
                # Pulse m_flag_restore_en for one cycle so u_regs latches the flag.
                m.d.comb += [
                    self.m_flag_restore_en.eq(1),
                    self.m_flag_restore_val.eq(mflag_val_latched),
                ]
                m.next = "FETCH_THREAD_HDR"

            with m.State("FETCH_THREAD_HDR"):
                # After RESTORE_CALL the incoming thread's CRs are all committed
                # to the register file, so CR12 now holds the new thread capability.
                # CR12 is M-elevated (perms always 0) — validate null only.
                #
                # M-elevated exception: during BOOT_PROGRAM microcode, the CHANGE
                # mask is 0 (decoder scrubs call_mask to 0), so RESTORE_CALL skips
                # all CR0–CR14 and CR12 remains null.  The boot path does not need
                # thread-header validation (there is no existing thread stack to
                # bound-check), so we bypass the null check and use thread_hdr=0.
                with m.If(cr12_null & ~self.m_elevated):
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
                with m.If(self.mem_rd_valid):
                    m.d.sync += thread_hdr_reg.eq(self.mem_rd_data)
                    m.next = "INSTALL_CR5"

            with m.State("INSTALL_CR5"):
                # Synthesise the Zone ④ heap GT from the incoming thread's lump header
                # and install it into CR5 (the heap cap).
                # base = thread_base + 17 words; limit_offset = heapWords - 1.
                m.d.comb += cr5_install_active.eq(1)
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
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
