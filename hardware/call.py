from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, LUMP_HEADER_LAYOUT
from .perm_check import perm_bit
from .mload_seq import mload_wait_body
from .stack_frame import stack_slot_addr


class ChurchCall(Elaboratable):
    def __init__(self):
        self.call_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(16)
        self.call_imm = Signal(15)  # method index from CALL imm15; 0 = single entry (NIA=lump_base+4)
        self.mask = Signal(16)   # bits [0:12] → null-GT write mask for CR0–CR11
        self.call_busy = Signal()
        self.call_complete = Signal()        # COMPLETE | M_FETCH_DONE (for exec advance only)
        self.call_normal_complete = Signal() # COMPLETE only (for stack push / code fence)
        self.call_fault = Signal()
        self.fault_type = Signal(5)      # 5 bits: FaultType 0x0–0x12

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

        self.mload_start = Signal()
        self.mload_cr_src = Signal(4)
        self.mload_cr_dst = Signal(4)
        self.mload_index = Signal(16)
        self.mload_direct = Signal()
        self.mload_direct_gt = Signal(32)
        self.mload_m_elevated = Signal()

        self.mload_done = Signal()
        self.mload_fault = Signal()
        self.mload_fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18

        self.nia_set = Signal()
        self.nia_value = Signal(32)

        # Direct memory read (NS lump header fetch + stack SP read)
        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        # Direct memory write (stack frame push)
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()

        # CR15 namespace for computing NS entry address of callee
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        # CR14 code cap for NIA base (populated after Phase 2 mload)
        self.cr14_code = Signal(CAP_REG_LAYOUT)

        # CR5 heap capability — live view; word1_location is the heap base address
        # (STO is stored at Heap[0] = Mem[CR5.word1_location]; initial value = 212)
        self.cr5_heap = Signal(CAP_REG_LAYOUT)

        # Word offset of the CALL instruction itself (nia_reg >> 2, lower 15 bits).
        # Frame word encodes return_PC = caller_pc + 1 (next instruction after CALL).
        self.caller_pc = Signal(15)

        # Thread lump byte base address (CR12.word1_location)
        self.thread_base = Signal(32)

        # CR12 thread capability — live view; used for W-perm check before stack writes
        self.cr12_thread = Signal(CAP_REG_LAYOUT)

        # THREAD_HDR: hidden per-thread register populated by CHANGE on thread restore.
        # Holds Mem[thread_base+0] — the thread lump's header word — valid for the
        # entire lifetime of the thread. CALL reads stack bounds from it directly,
        # eliminating the FETCH_THREAD_HDR memory read from the CALL pipeline.
        self.thread_hdr = Signal(32)

        # Parallel domain-crossing register operations (driven for one cycle at CLEAR_B).
        # cr_b_clear_mask: bit N=1 → clear b_flag on CRN (preserved registers)
        # cr_null_mask:    bit N=1 → write NULL to CRN  (non-preserved registers)
        self.cr_b_clear_mask = Signal(12)
        self.cr_null_mask    = Signal(12)

        # Code fence bounds — driven combinatorially; valid when call_complete=1.
        # code_lo_out: byte address of first instruction (lump_base + 4)
        # code_hi_out: exclusive byte address past last instruction (lump_base + 4 + cw*4)
        # Core latches these into code_lo_reg / code_hi_reg on call_complete.
        self.code_lo_out = Signal(32)
        self.code_hi_out = Signal(32)

        # M-GT dispatch outputs — pulsed for one cycle when M_FETCH_DONE fires.
        # Signals core to load the M-window shadow (DR11-DR15) from these values
        # rather than executing the normal lump/stack pipeline.
        self.mgt_set_trigger  = Signal()
        self.mgt_gt_word      = Signal(32)   # raw 32-bit Abstract GT (src cap's word0_gt)
        self.mgt_ns_location  = Signal(32)   # NS entry word0_location
        self.mgt_ns_authority = Signal(32)   # NS entry word1_authority
        self.mgt_ns_integrity = Signal(32)   # NS entry word2_integrity
        self.mgt_ns_seals     = Signal(32)   # NS entry word3_abstract_gt (advisory seals)

        # Lazy-load IRQ outputs (Task #1523): pulsed when FETCH_LUMP detects cw=0
        # (CODE_NOT_RESIDENT).  No stack frame has been pushed at this point in
        # the CALL pipeline.  Core uses these to trigger ChurchIRQDispatch.
        self.lazy_load_irq     = Signal()     # 1-cycle pulse: evicted lump detected
        self.lazy_load_ns_slot = Signal(16)   # NS slot of the evicted lump

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST   = 6
        CR14_CODE   = 14
        MAX_SRC_REG = 11   # cr_src must be in CR0–CR11

        phase = Signal()
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(16)
        call_imm_latched = Signal(15)   # method index latched from self.call_imm at call_start
        fault_latched = Signal()
        fault_type_latched = Signal(5)      # 5 bits: covers FaultType 0x0–0x12 (STACK_CORRUPT)
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()
        # Method-table dispatch state
        method_entry_reg  = Signal(32)  # lump-base-relative word offset fetched from method table
        use_method_table  = Signal()    # 1 = NIA derived from method_entry_reg, 0 = word 1 default

        local_cr_rd_addr = Signal(4)
        local_cr_wr_en = Signal()
        local_cr_wr_addr = Signal(4)
        local_cr_wr_data = Signal(CAP_REG_LAYOUT)

        local_mem_wr_addr = Signal(32)
        local_mem_wr_data = Signal(32)
        local_mem_wr_en = Signal()

        sp_latched = Signal(32)    # STO read from Heap[0] = Mem[CR5.word1_location]

        # Thread header — decoded combinatorially from THREAD_HDR hidden register.
        # THREAD_HDR is loaded once by CHANGE on thread restore; valid for the entire
        # lifetime of the thread. No memory read needed per CALL.
        thread_hdr_view = View(LUMP_HEADER_LAYOUT, self.thread_hdr)
        thr_lump_sz = Signal(15)
        m.d.comb += thr_lump_sz.eq(Const(1, 15) << (thread_hdr_view.n_minus_6 + 6))

        # sp_max = thr_lump_sz − 12 − 1      (top of Stack zone; caps zone = 12, fixed)
        # sp_min = thr_lump_sz − 12 − sw + 2 (CALL needs 2 words: STO >= sp_min)
        # Break into two binary subtractions so Yosys does not merge into a
        # multi-term $macc cell that write_verilog cannot emit as plain Verilog.
        sp_max      = Signal(15)
        sp_min      = Signal(15)
        sp_min_base = Signal(15)   # thr_lump_sz − 10  (= − 12 + 2, binary step)
        m.d.comb += [
            sp_max.eq(thr_lump_sz - 12 - 1),
            sp_min_base.eq(thr_lump_sz - 10),
            sp_min.eq(sp_min_base - thread_hdr_view.cw),
        ]

        # Callee E-GT: the raw 32-bit GT deposited into CR6 by Phase 1 mLoad.
        # Latched in PHASE1_DONE (while cr_rd_addr == CR6, combinatorial read-back).
        callee_egt_latched = Signal(32)

        # M-GT dispatch latches: populated during M_FETCH_NS0/1/2/3 states.
        # mgt_gt_lat: raw Abstract GT word from src_reg_latched.word0_gt.
        # ns_*_lat: 4 NS entry words fetched from Mem[CR15.loc + slot_id<<4 + N].
        mgt_gt_lat   = Signal(32)
        mgt_gt_view  = View(GT_LAYOUT, mgt_gt_lat)
        ns_loc_lat   = Signal(32)
        ns_auth_lat  = Signal(32)
        ns_int_lat   = Signal(32)
        ns_seal_lat  = Signal(32)

        # CALL frame word (spec §"Zone ② — LIFO Stack"):
        #   bit[31]    = SZ = 1  (CALL frame tag)
        #   bits[30:16] = return_PC = caller_pc + 1  (word offset after CALL)
        #   bits[15:0]  = prev_STO = sp_latched[15:0]
        # Written to thread_base + STO*4 (STO+0); E-GT written to STO-1.
        frame_word = Signal(32)
        m.d.comb += frame_word.eq(
            Cat(sp_latched[:16], (self.caller_pc + 1)[:15], Const(1, 1))
        )

        cr5_heap_view = View(CAP_REG_LAYOUT, self.cr5_heap)
        cr5_gt = View(GT_LAYOUT, cr5_heap_view.word0_gt)
        cr5_null = Signal()
        cr5_has_r = Signal()
        m.d.comb += [
            cr5_null.eq(cr5_gt.gt_type == GT_TYPE_NULL),
            cr5_has_r.eq(~cr5_gt.dom & cr5_gt.perm[PERM_R]),   # Turing dom=0, perm[0]=R
        ]

        cr12_cap_view = View(CAP_REG_LAYOUT, self.cr12_thread)
        cr12_gt = View(GT_LAYOUT, cr12_cap_view.word0_gt)
        cr12_null = Signal()
        m.d.comb += cr12_null.eq(cr12_gt.gt_type == GT_TYPE_NULL)

        # Latched CR14 for M-bit write-back after Phase 2
        cr14_latched = Signal(CAP_REG_LAYOUT)
        cr14_lat_view = View(CAP_REG_LAYOUT, cr14_latched)
        cr14_lat_gt   = View(GT_LAYOUT, cr14_lat_view.word0_gt)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_e_perm = perm_bit(src_view.word0_gt, PERM_E)

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        m.d.comb += [
            mload_src.eq(Mux(phase, CR6_CLIST, self.cr_src)),
            mload_dst.eq(Mux(phase, CR14_CODE, CR6_CLIST)),
            mload_index.eq(Mux(phase, 0, self.index)),
        ]

        # M-elevation is permanently asserted: CALL's FSM validates E-perm
        # in CHECK_PERM before any mLoad fires, so CHECK_L is externalised.
        m.d.comb += [
            self.mload_start.eq(sub_start_reg),
            self.mload_cr_src.eq(mload_src),
            self.mload_cr_dst.eq(mload_dst),
            self.mload_index.eq(mload_index),
            self.mload_direct.eq(0),
            self.mload_m_elevated.eq(1),
            self.mload_direct_gt.eq(0),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(local_cr_wr_addr),
            self.cr_wr_data.eq(local_cr_wr_data),
            self.cr_wr_en.eq(local_cr_wr_en),
            self.cr_rd_addr.eq(local_cr_rd_addr),
            self.mem_wr_addr.eq(local_mem_wr_addr),
            self.mem_wr_data.eq(local_mem_wr_data),
            self.mem_wr_en.eq(local_mem_wr_en),
        ]

        # NS lump header fetch
        cr14_view = View(CAP_REG_LAYOUT, self.cr14_code)
        cr14_gt = View(GT_LAYOUT, cr14_view.word0_gt)
        cr15_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

        # NS entry base address for Abstract GT M-GT dispatch: CR15.location + (slot_id << 4)
        mgt_ns_entry_base = Signal(32)
        m.d.comb += mgt_ns_entry_base.eq(
            cr15_view.word1_location + (mgt_gt_view.slot_id << 4)
        )

        callee_ns_entry_addr = Signal(32)
        m.d.comb += callee_ns_entry_addr.eq(
            cr15_view.word1_location + (cr14_gt.slot_id << 4)
        )

        lump_reg = Signal(32)
        lump_view = View(LUMP_HEADER_LAYOUT, lump_reg)

        cw_reg        = Signal(13)
        cc_reg        = Signal(8)
        n_minus_6_reg = Signal(4)
        lumpSize_reg  = Signal(15)   # 1 << (n_minus_6 + 6); range 64..16384 words

        # CR14 with M=1 (PERM_X asserted, PERM_R optional) for SET_M_WRITE
        # CR14 permissions: RX only (no W — code is read-execute, not writable)
        cr14_with_m = Signal(CAP_REG_LAYOUT)
        cr14_wm_view = View(CAP_REG_LAYOUT, cr14_with_m)
        cr14_wm_gt   = View(GT_LAYOUT, cr14_wm_view.word0_gt)
        m.d.comb += [
            cr14_wm_gt.slot_id.eq(cr14_lat_gt.slot_id),
            cr14_wm_gt.gt_seq.eq(cr14_lat_gt.gt_seq),
            cr14_wm_gt.gt_type.eq(cr14_lat_gt.gt_type),
            # Turing domain (dom=0), force X=1, preserve R from source, W=0.
            # Source CR14 is always Turing (code cap), so cr14_lat_gt.perm[0] = R bit.
            cr14_wm_gt.dom.eq(0),
            cr14_wm_gt.perm.eq(Cat(cr14_lat_gt.perm[0], C(0, 1), C(1, 1))),  # {X=1, W=0, R=src}
            cr14_wm_gt.b_flag.eq(cr14_lat_gt.b_flag),
            cr14_wm_view.word1_location.eq(cr14_lat_view.word1_location + 4),
            cr14_wm_view.word2_w2.eq(cr14_lat_view.word2_w2),
        ]

        # mLoad stores raw NS[+0] = lump_base into CR14.word1_location (no +4 offset).
        # SET_M_WRITE applies +4 so the final CR14.base points at the first instruction word.
        # ns_base_from_cr14 therefore equals the raw lump base (= lump header address).
        ns_base_from_cr14 = Signal(32)
        m.d.comb += ns_base_from_cr14.eq(cr14_lat_view.word1_location)

        # NIA: callee's entry point.
        # imm=0  → fast path: NIA = lump_base + 4 (word 1, backward-compat entry).
        # imm>0  → table dispatch: NIA = lump_base + entry*4 where entry = memory[lump_base + imm*4].
        # Layout: word 0 = lump header; word k = table entry for method k-1 (k = call_imm, k>=1).
        nia_computed = Signal(32)
        m.d.comb += nia_computed.eq(
            Mux(call_imm_latched == 0,
                ns_base_from_cr14 + 4,                       # fast path: word 1 byte address
                ns_base_from_cr14 + (method_entry_reg << 2)  # table dispatch: entry is word offset
            )
        )

        # CR14 with M=1 AND corrected limit_offset — written in SET_CR14_LIMIT_WRITE
        cr14_with_limit = Signal(CAP_REG_LAYOUT)
        cr14_wl_view = View(CAP_REG_LAYOUT, cr14_with_limit)
        cr14_wl_gt   = View(GT_LAYOUT, cr14_wl_view.word0_gt)
        cr14_wl_w2   = View(WORD2_LAYOUT, cr14_wl_view.word2_w2)
        cr14_lat_w2  = View(WORD2_LAYOUT, cr14_lat_view.word2_w2)
        m.d.comb += [
            cr14_wl_gt.slot_id.eq(cr14_wm_gt.slot_id),
            cr14_wl_gt.gt_seq.eq(cr14_wm_gt.gt_seq),
            cr14_wl_gt.gt_type.eq(cr14_wm_gt.gt_type),
            cr14_wl_gt.dom.eq(cr14_wm_gt.dom),    # copy dom+perm (includes PERM_X / M=1)
            cr14_wl_gt.perm.eq(cr14_wm_gt.perm),
            cr14_wl_gt.b_flag.eq(cr14_wm_gt.b_flag),
            cr14_wl_view.word1_location.eq(cr14_wm_view.word1_location),  # NS_base+4
            cr14_wl_w2.limit_offset.eq(cw_reg - 1),                       # cw-1 (inclusive last valid PC; matches NS format convention)
            cr14_wl_w2.gt_seq.eq(cr14_lat_w2.gt_seq),
            cr14_wl_w2.g_bit.eq(0),
            cr14_wl_w2.f_flag.eq(0),
        ]

        # CR6 read latch — filled by SET_CR6_BASE
        cr6_latched  = Signal(CAP_REG_LAYOUT)
        cr6_lat_view = View(CAP_REG_LAYOUT, cr6_latched)
        cr6_lat_gt   = View(GT_LAYOUT, cr6_lat_view.word0_gt)
        cr6_lat_w2   = View(WORD2_LAYOUT, cr6_lat_view.word2_w2)

        # CR6 with corrected base, limit; perms fixed to E-only — matching boot LOAD_NUC convention.
        # CR6 always carries E perm (enables recursive CALL via CR6), regardless of source GT perms.
        # Device GTs (L+S+E) have L and S stripped; regular E-GTs are unchanged.
        # M-elevation for CR6 is implicit: CALL FSM always sets mload_m_elevated=1 (Phase 1).
        # It is NOT encoded as a perm bit — contrast with CR14 where PERM_X = M flag.
        cr6_adjusted = Signal(CAP_REG_LAYOUT)
        cr6_adj_view = View(CAP_REG_LAYOUT, cr6_adjusted)
        cr6_adj_gt   = View(GT_LAYOUT, cr6_adj_view.word0_gt)
        cr6_adj_w2   = View(WORD2_LAYOUT, cr6_adj_view.word2_w2)
        m.d.comb += [
            cr6_adj_gt.slot_id.eq(cr6_lat_gt.slot_id),
            cr6_adj_gt.gt_seq.eq(cr6_lat_gt.gt_seq),
            cr6_adj_gt.gt_type.eq(cr6_lat_gt.gt_type),
            # Fixed E-only — CR6 always carries E (recursive CALL; matches boot LOAD_NUC).
            # Church domain (dom=1), perm[2]=E.
            cr6_adj_gt.dom.eq(1),
            cr6_adj_gt.perm.eq(0b100),   # E = perm[2] in Church domain
            cr6_adj_gt.b_flag.eq(cr6_lat_gt.b_flag),
            # base = NS_base + (lumpSize − cc) × 4  (byte address of c-list word 0)
            cr6_adj_view.word1_location.eq(
                ns_base_from_cr14 + ((lumpSize_reg - cc_reg) << 2)
            ),
            cr6_adj_w2.limit_offset.eq(cc_reg - 1),       # cc − 1 (inclusive count)
            cr6_adj_w2.gt_seq.eq(cr6_lat_w2.gt_seq),
            cr6_adj_w2.g_bit.eq(0),
            cr6_adj_w2.f_flag.eq(0),
        ]


        # Code fence bounds — always-valid combinatorial outputs for core to latch
        # on call_complete.  ns_base_from_cr14 = lump_base (byte address before +4).
        # cw_reg is latched from the lump header in FETCH_LUMP and stable for the
        # remainder of the CALL pipeline.
        #
        # code_hi_out reuses code_lo_out (already binary) as its base so that
        # Yosys alumacc never sees a 3-term chain and cannot fold it into a
        # multi-term $macc cell that write_verilog cannot emit as plain Verilog.
        m.d.comb += self.code_lo_out.eq(ns_base_from_cr14 + 4)
        m.d.comb += self.code_hi_out.eq(self.code_lo_out + (cw_reg << 2))

        # Explicit combinatorial defaults so these signals are always driven to 0
        # except during the single CLEAR_B state that pulses them.
        m.d.comb += [
            self.cr_null_mask.eq(0),
            self.cr_b_clear_mask.eq(0),
        ]

        with m.FSM(name="call") as fsm:
            with m.State("IDLE"):
                m.d.sync += [phase.eq(0), fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += [use_method_table.eq(0), method_entry_reg.eq(0)]
                with m.If(self.call_start):
                    m.d.sync += mask_latched.eq(self.mask)
                    m.d.sync += call_imm_latched.eq(self.call_imm)
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                m.d.comb += local_cr_rd_addr.eq(self.cr_src)
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += local_cr_rd_addr.eq(self.cr_src)
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(src_gt.gt_type == GT_TYPE_ABSTRACT):
                    # M-GT dispatch: latch the Abstract GT word and fetch 3 NS entry
                    # words (location/authority/integrity) from Mem[CR15.loc+slot<<4].
                    # No lump or stack frame — M-window set fires at M_FETCH_DONE.
                    m.d.sync += mgt_gt_lat.eq(src_view.word0_gt.as_value())
                    m.next = "M_FETCH_NS0"
                with m.Elif(~src_has_e_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "PHASE1"

            with m.State("PHASE1"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=self.mload_done,
                    fault_sig=self.mload_fault,
                    fault_type_sig=self.mload_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="PHASE1_DONE",
                )

            with m.State("PHASE1_DONE"):
                # Combinatorially read back CR6 — Phase 1 mLoad has just deposited
                # the callee's cap entry there.  Latch word0_gt (pre-SET_CR6_LIMIT,
                # original perms from cload.py Phase 1) for STACK_WRITE_EGT.
                # Note: cr6_adjusted (PERM_MASK_L) is the *final* CR6 written later.
                m.d.comb += local_cr_rd_addr.eq(CR6_CLIST)
                m.d.sync += callee_egt_latched.eq(
                    View(CAP_REG_LAYOUT, self.cr_rd_data).word0_gt.as_value()
                )
                m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE2"

            with m.State("PHASE2"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=self.mload_done,
                    fault_sig=self.mload_fault,
                    fault_type_sig=self.mload_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="SET_M_READ",
                )

            with m.State("SET_M_READ"):
                # Read CR14 so we can assert M=1 (PERM_X) on the code capability
                m.d.comb += local_cr_rd_addr.eq(CR14_CODE)
                m.d.sync += cr14_latched.eq(self.cr_rd_data)
                m.next = "SET_M_WRITE"

            with m.State("SET_M_WRITE"):
                # Write CR14 back with PERM_X forced to 1 (M=1 for method entry)
                m.d.comb += [
                    local_cr_wr_addr.eq(CR14_CODE),
                    local_cr_wr_data.eq(cr14_with_m),
                    local_cr_wr_en.eq(1),
                ]
                m.next = "FETCH_LUMP"

            with m.State("FETCH_LUMP"):
                m.d.comb += [
                    self.mem_rd_addr.eq(ns_base_from_cr14),  # lump word 0 = lump header
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    _hdr = View(LUMP_HEADER_LAYOUT, self.mem_rd_data)
                    m.d.sync += lump_reg.eq(self.mem_rd_data)
                    m.d.sync += [
                        cw_reg.eq(_hdr.cw),
                        cc_reg.eq(_hdr.cc),
                        n_minus_6_reg.eq(_hdr.n_minus_6),
                        lumpSize_reg.eq(Const(1, 15) << (_hdr.n_minus_6 + 6)),
                    ]
                    # If method index > 0, read the method table before setting CR14 limit.
                    # Index 0 = single entry point (NIA = lump_base + 4); skip table fetch.
                    with m.If(_hdr.cw == 0):
                        m.next = "LAZY_LOAD_ABORT"
                    with m.Elif(call_imm_latched > 0):
                        m.next = "FETCH_METHOD_ENTRY"
                    with m.Else():
                        m.next = "SET_CR14_LIMIT_WRITE"

            with m.State("FETCH_METHOD_ENTRY"):
                # Read method table entry at memory[lump_base + call_imm * 4].
                # ns_base_from_cr14 = lump_base (byte address of lump word 0 = header).
                # call_imm_latched is the 15-bit method index (≥1 when this state is reached).
                # The fetched word is a lump-base-relative WORD offset of the method body.
                m.d.comb += [
                    self.mem_rd_addr.eq(ns_base_from_cr14 + (call_imm_latched.as_unsigned() << 2)),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += method_entry_reg.eq(self.mem_rd_data)
                    with m.If(self.mem_rd_data == 0):
                        # Table entry = 0 → private method or out-of-range index → FAULT.
                        m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "SET_CR14_LIMIT_WRITE"

            with m.State("SET_CR14_LIMIT_WRITE"):
                # Write CR14 with PERM_X (M=1) and corrected limit_offset = cw-1 (authoritative code-word count from lump header)
                m.d.comb += [
                    local_cr_wr_addr.eq(CR14_CODE),
                    local_cr_wr_data.eq(cr14_with_limit),
                    local_cr_wr_en.eq(1),
                ]
                m.next = "SET_CR6_BASE"

            with m.State("SET_CR6_BASE"):
                # cc=0: c-list absent — write NULL GT to CR6 per spec step 7
                # cc>0: read CR6 (Phase 1 deposited the E-GT there) to latch for adjustment
                with m.If(cc_reg == 0):
                    m.d.comb += [
                        local_cr_wr_en.eq(1),
                        local_cr_wr_addr.eq(CR6_CLIST),
                        local_cr_wr_data.eq(0),
                    ]
                    m.next = "CLEAR_B"
                with m.Else():
                    m.d.comb += local_cr_rd_addr.eq(CR6_CLIST)
                    m.d.sync += cr6_latched.eq(self.cr_rd_data)
                    m.next = "SET_CR6_LIMIT"

            with m.State("SET_CR6_LIMIT"):
                # Write CR6 with new base (c-list start) and limit_offset = cc−1
                m.d.comb += [
                    local_cr_wr_addr.eq(CR6_CLIST),
                    local_cr_wr_data.eq(cr6_adjusted),
                    local_cr_wr_en.eq(1),
                ]
                m.next = "CLEAR_B"

            with m.State("CLEAR_B"):
                # Single-cycle domain-crossing register cleanup via parallel mask ports:
                #   mask bit=1 (null mask) → write NULL to whole register (b_flag → 0 implicitly)
                #   mask bit=0 (b_clear)   → preserve register, clear only b_flag (bit 31 of GT)
                # sp_max/sp_min are derived combinatorially from self.thread_hdr — no memory read.
                m.d.comb += [
                    self.cr_null_mask.eq(mask_latched[:12]),
                    self.cr_b_clear_mask.eq(~mask_latched[:12]),
                ]
                m.next = "CHECK_CR5_CR12"

            with m.State("CHECK_CR5_CR12"):
                with m.If(cr5_null):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Elif(~cr5_has_r):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_R)]
                    m.next = "FAULT"
                with m.Elif(cr12_null):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "STACK_READ_SP"

            with m.State("STACK_READ_SP"):
                # Read STO from Heap[0] = Mem[CR5.word1_location].
                # STO is a word offset; the stack grows downward (STO -= 2 per CALL).
                m.d.comb += [
                    self.mem_rd_addr.eq(cr5_heap_view.word1_location),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += sp_latched.eq(self.mem_rd_data)
                    m.next = "STACK_CHECK"

            with m.State("STACK_CHECK"):
                # Upper bound: STO > sp_max means the pointer is corrupted or
                # the header is wrong (STO was never at most lumpSize−cc−1).
                # Lower bound: STO < sp_min means a CALL would push the frame
                # below the stack zone floor (lumpSize−cc−sw+2).
                # Both bounds are IDE-set via the thread header sw field.
                with m.If(sp_latched > sp_max):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.STACK_CORRUPT),
                    ]
                    m.next = "FAULT"
                with m.Elif(sp_latched < sp_min):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.STACK_OVERFLOW),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "STACK_WRITE_EGT"

            with m.State("STACK_WRITE_EGT"):
                # Spec: STO-1 holds E-GT Word 0 of the callee.
                # callee_egt_latched = CR6.word0_gt as read back in PHASE1_DONE.
                # Byte address = thread_base + (STO-1)*4
                m.d.comb += [
                    local_mem_wr_addr.eq(stack_slot_addr(self.thread_base, sp_latched, -1)),
                    local_mem_wr_data.eq(callee_egt_latched),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "STACK_WRITE_FRAME"

            with m.State("STACK_WRITE_FRAME"):
                # Spec: STO+0 holds the frame word: SZ[1] | return_PC[15] | prev_STO[16].
                # frame_word is a combinatorial signal computed above.
                # Byte address = thread_base + STO*4
                m.d.comb += [
                    local_mem_wr_addr.eq(stack_slot_addr(self.thread_base, sp_latched, 0)),
                    local_mem_wr_data.eq(frame_word),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "STACK_WRITE_SP"

            with m.State("STACK_WRITE_SP"):
                # STO -= 2: write STO-2 back to Heap[0] = Mem[CR5.word1_location].
                m.d.comb += [
                    local_mem_wr_addr.eq(cr5_heap_view.word1_location),
                    local_mem_wr_data.eq(sp_latched - 2),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

            # ── M-GT dispatch states ──────────────────────────────────────────
            # Entered from CHECK_PERM when src GT has gt_type == GT_TYPE_ABSTRACT.
            # Reads all 4 NS entry words (location, authority, integrity, seals)
            # via the direct memory bus; mgt_set_trigger pulses for one cycle at
            # M_FETCH_DONE to populate DR11-DR15 in hardware/registers.py.
            # No lump is loaded, no stack frame is pushed, nia_set is NOT asserted.

            with m.State("M_FETCH_NS0"):
                # Fetch NS entry word0_location
                m.d.comb += [
                    self.mem_rd_addr.eq(mgt_ns_entry_base),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_loc_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS1"

            with m.State("M_FETCH_NS1"):
                # Fetch NS entry word1_authority
                m.d.comb += [
                    self.mem_rd_addr.eq(mgt_ns_entry_base + 4),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_auth_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS2"

            with m.State("M_FETCH_NS2"):
                # Fetch NS entry word2_integrity
                m.d.comb += [
                    self.mem_rd_addr.eq(mgt_ns_entry_base + 8),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_int_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS3"

            with m.State("M_FETCH_NS3"):
                # Fetch NS entry word3_abstract_gt (advisory seals annotation)
                m.d.comb += [
                    self.mem_rd_addr.eq(mgt_ns_entry_base + 12),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_seal_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_DONE"

            with m.State("M_FETCH_DONE"):
                # mgt_set_trigger pulses for this one cycle (driven combinatorially below).
                # call_complete is also asserted so core proceeds past the CALL instruction.
                # The FSM returns to IDLE on the next cycle.
                m.next = "IDLE"

            with m.State("LAZY_LOAD_ABORT"):
                # cw=0 detected in FETCH_LUMP: lump is CODE_NOT_RESIDENT.
                # No stack frame has been pushed at this point in the pipeline.
                # Abort the CALL silently; core dispatches to Scheduler.IRQ
                # via ChurchIRQDispatch (Task #1523, IRQ_REASON_LAZY_LOAD).
                m.next = "IDLE"

        m.d.comb += [
            self.call_busy.eq(~fsm.ongoing("IDLE")),
            self.call_complete.eq(fsm.ongoing("COMPLETE") | fsm.ongoing("M_FETCH_DONE")),
            self.call_normal_complete.eq(fsm.ongoing("COMPLETE")),
            self.call_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(nia_computed),
            self.mgt_set_trigger.eq(fsm.ongoing("M_FETCH_DONE")),
            self.mgt_gt_word.eq(mgt_gt_lat),
            self.mgt_ns_location.eq(ns_loc_lat),
            self.mgt_ns_authority.eq(ns_auth_lat),
            self.mgt_ns_integrity.eq(ns_int_lat),
            self.mgt_ns_seals.eq(ns_seal_lat),
            self.lazy_load_irq.eq(fsm.ongoing("LAZY_LOAD_ABORT")),
            self.lazy_load_ns_slot.eq(View(GT_LAYOUT, callee_egt_latched).slot_id),
        ]

        return m
