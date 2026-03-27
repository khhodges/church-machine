from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, LUMP_HEADER_LAYOUT


class ChurchCall(Elaboratable):
    def __init__(self):
        self.call_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(16)
        self.mask = Signal(16)   # bits [0:12] → null-GT write mask for CR0–CR11
        self.call_busy = Signal()
        self.call_complete = Signal()
        self.call_fault = Signal()
        self.fault_type = Signal(5)      # 5 bits: FaultType 0x0–0x10

        # Snapshot of caller's CR5 GT — consumed by core to save onto cr5_stack
        # at call_complete so ChurchReturn can restore it.  Wired combinatorially
        # from the cr5_heap input (always valid, core samples it on call_complete).
        self.saved_cr5_gt = Signal(GT_LAYOUT)

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
        self.mload_fault_type = Signal(4)

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
        # (SP is stored at Heap[0] = Mem[CR5.word1_location])
        self.cr5_heap = Signal(CAP_REG_LAYOUT)

        # LAMBDA hidden hardware register — holds the caller's return frame word
        # TODO: exact bit encoding of frame word (NIA offset + machine indicators)
        #       is not yet fully specified; this is a placeholder until confirmed.
        self.lambda_frame_reg = Signal(32)

        # Thread base byte address and IDE-defined stack word limit
        self.thread_base  = Signal(32)
        self.stack_limit  = Signal(16)

    def elaborate(self, platform):
        m = Module()

        CR6_CLIST   = 6
        CR14_CODE   = 14
        MAX_SRC_REG = 11   # cr_src must be in CR0–CR11

        phase = Signal()
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(16)
        fault_latched = Signal()
        fault_type_latched = Signal(5)      # 5 bits to cover FaultType.STACK_OVERFLOW=0x10
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_addr = Signal(4)
        local_cr_wr_en = Signal()
        local_cr_wr_addr = Signal(4)
        local_cr_wr_data = Signal(CAP_REG_LAYOUT)

        local_mem_wr_addr = Signal(32)
        local_mem_wr_data = Signal(32)
        local_mem_wr_en = Signal()

        sp_latched = Signal(32)    # current stack pointer (word offset) read from Heap[0]

        cr5_heap_view = View(CAP_REG_LAYOUT, self.cr5_heap)

        b_idx = Signal(4)          # 4 bits: counts 0–11 for b-flag sweep
        b_cr_data = Signal(CAP_REG_LAYOUT)

        n_idx = Signal(4)          # 4 bits: counts 0–11 for null-GT sweep

        # Latched CR14 for M-bit write-back after Phase 2
        cr14_latched = Signal(CAP_REG_LAYOUT)
        cr14_lat_view = View(CAP_REG_LAYOUT, cr14_latched)
        cr14_lat_gt   = View(GT_LAYOUT, cr14_lat_view.word0_gt)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_e_perm = src_gt.perms[PERM_E]

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
            # saved_cr5_gt: expose caller's CR5 GT so core can snapshot it onto
            # cr5_stack when call_complete asserts.  Always driven combinatorially.
            self.saved_cr5_gt.eq(View(CAP_REG_LAYOUT, self.cr5_heap).word0_gt),
        ]

        # NS lump header fetch
        cr14_view = View(CAP_REG_LAYOUT, self.cr14_code)
        cr14_gt = View(GT_LAYOUT, cr14_view.word0_gt)
        cr15_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

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

        # NIA: word offset 1 — first instruction is always lump word 1 (word 0 is header)
        nia_computed = Signal(32)
        m.d.comb += nia_computed.eq(1)

        # CR14 with M=1 (PERM_X asserted) for SET_M_WRITE
        cr14_with_m = Signal(CAP_REG_LAYOUT)
        cr14_wm_view = View(CAP_REG_LAYOUT, cr14_with_m)
        cr14_wm_gt   = View(GT_LAYOUT, cr14_wm_view.word0_gt)
        m.d.comb += [
            cr14_wm_gt.slot_id.eq(cr14_lat_gt.slot_id),
            cr14_wm_gt.gt_seq.eq(cr14_lat_gt.gt_seq),
            cr14_wm_gt.gt_type.eq(cr14_lat_gt.gt_type),
            cr14_wm_gt.perms.eq(cr14_lat_gt.perms | PERM_MASK_X),
            cr14_wm_gt.b_flag.eq(cr14_lat_gt.b_flag),
            cr14_wm_view.word1_location.eq(cr14_lat_view.word1_location),
            cr14_wm_view.word2_w2.eq(cr14_lat_view.word2_w2),
            cr14_wm_view.word3_w3.eq(cr14_lat_view.word3_w3),
        ]

        # NS_base derived from CR14.base after Phase 2 (mLoad sets CR14.base = NS_base+4)
        ns_base_from_cr14 = Signal(32)
        m.d.comb += ns_base_from_cr14.eq(cr14_lat_view.word1_location - 4)

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
            cr14_wl_gt.perms.eq(cr14_wm_gt.perms),        # includes PERM_X (M=1)
            cr14_wl_gt.b_flag.eq(cr14_wm_gt.b_flag),
            cr14_wl_view.word1_location.eq(cr14_wm_view.word1_location),  # NS_base+4
            cr14_wl_w2.limit_offset.eq(lumpSize_reg - cc_reg - 2),        # lumpSize−cc−2
            cr14_wl_w2.gt_seq.eq(cr14_lat_w2.gt_seq),
            cr14_wl_w2.spare.eq(0),
            cr14_wl_view.word3_w3.eq(cr14_wm_view.word3_w3),
        ]

        # CR6 read latch — filled by SET_CR6_BASE
        cr6_latched  = Signal(CAP_REG_LAYOUT)
        cr6_lat_view = View(CAP_REG_LAYOUT, cr6_latched)
        cr6_lat_gt   = View(GT_LAYOUT, cr6_lat_view.word0_gt)
        cr6_lat_w2   = View(WORD2_LAYOUT, cr6_lat_view.word2_w2)

        # CR6 with corrected base and limit — written in SET_CR6_LIMIT
        cr6_adjusted = Signal(CAP_REG_LAYOUT)
        cr6_adj_view = View(CAP_REG_LAYOUT, cr6_adjusted)
        cr6_adj_gt   = View(GT_LAYOUT, cr6_adj_view.word0_gt)
        cr6_adj_w2   = View(WORD2_LAYOUT, cr6_adj_view.word2_w2)
        m.d.comb += [
            cr6_adj_gt.slot_id.eq(cr6_lat_gt.slot_id),
            cr6_adj_gt.gt_seq.eq(cr6_lat_gt.gt_seq),
            cr6_adj_gt.gt_type.eq(cr6_lat_gt.gt_type),
            cr6_adj_gt.perms.eq(cr6_lat_gt.perms),
            cr6_adj_gt.b_flag.eq(cr6_lat_gt.b_flag),
            # base = NS_base + (lumpSize − cc) × 4  (byte address of c-list word 0)
            cr6_adj_view.word1_location.eq(
                ns_base_from_cr14 + ((lumpSize_reg - cc_reg) << 2)
            ),
            cr6_adj_w2.limit_offset.eq(cc_reg - 1),       # cc − 1 (inclusive count)
            cr6_adj_w2.gt_seq.eq(cr6_lat_w2.gt_seq),
            cr6_adj_w2.spare.eq(0),
            cr6_adj_view.word3_w3.eq(cr6_lat_view.word3_w3),
        ]

        # b-flag cleared capability (computed from b_cr_data, used in CLEAR_B_WRITE)
        b_cleared = Signal(CAP_REG_LAYOUT)
        b_src_view = View(CAP_REG_LAYOUT, b_cr_data)
        b_src_gt   = View(GT_LAYOUT, b_src_view.word0_gt)
        b_clr_view = View(CAP_REG_LAYOUT, b_cleared)
        b_clr_gt   = View(GT_LAYOUT, b_clr_view.word0_gt)
        m.d.comb += [
            b_clr_gt.slot_id.eq(b_src_gt.slot_id),
            b_clr_gt.gt_seq.eq(b_src_gt.gt_seq),
            b_clr_gt.gt_type.eq(b_src_gt.gt_type),
            b_clr_gt.perms.eq(b_src_gt.perms),
            b_clr_gt.b_flag.eq(0),
            b_clr_view.word1_location.eq(b_src_view.word1_location),
            b_clr_view.word2_w2.eq(b_src_view.word2_w2),
            b_clr_view.word3_w3.eq(b_src_view.word3_w3),
        ]

        with m.FSM(name="call") as fsm:
            with m.State("IDLE"):
                m.d.sync += [phase.eq(0), fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.call_start):
                    m.d.sync += mask_latched.eq(self.mask)
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
                with m.If(~src_has_e_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_E)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "PHASE1"

            with m.State("PHASE1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "PHASE1_DONE"

            with m.State("PHASE1_DONE"):
                m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "PHASE2"

            with m.State("PHASE2"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(self.mload_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(self.mload_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(self.mload_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "SET_M_READ"

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
                    self.mem_rd_addr.eq(callee_ns_entry_addr + 12),
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
                    m.next = "SET_CR14_LIMIT_WRITE"

            with m.State("SET_CR14_LIMIT_WRITE"):
                # Write CR14 with PERM_X (M=1) and corrected limit_offset = lumpSize−cc−2
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
                    m.next = "CLEAR_B_INIT"
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
                m.next = "CLEAR_B_INIT"

            with m.State("CLEAR_B_INIT"):
                m.d.sync += b_idx.eq(0)
                m.next = "CLEAR_B_CHECK"

            with m.State("CLEAR_B_CHECK"):
                # Strip b_flag from every CR0–CR11 unconditionally
                with m.If(b_idx > 11):
                    m.next = "NULL_WRITE_INIT"
                with m.Else():
                    m.d.comb += local_cr_rd_addr.eq(b_idx)
                    m.next = "CLEAR_B_READ"

            with m.State("CLEAR_B_READ"):
                m.d.comb += local_cr_rd_addr.eq(b_idx)
                m.d.sync += b_cr_data.eq(self.cr_rd_data)
                m.next = "CLEAR_B_WRITE"

            with m.State("CLEAR_B_WRITE"):
                m.d.comb += [
                    local_cr_wr_en.eq(1),
                    local_cr_wr_addr.eq(b_idx),
                    local_cr_wr_data.eq(b_cleared),
                ]
                m.d.sync += b_idx.eq(b_idx + 1)
                m.next = "CLEAR_B_CHECK"

            with m.State("NULL_WRITE_INIT"):
                # Write null GT to each CR0–CR11 slot flagged in mask_latched[0:12]
                m.d.sync += n_idx.eq(0)
                m.next = "NULL_WRITE_CHECK"

            with m.State("NULL_WRITE_CHECK"):
                with m.If(n_idx > 11):
                    m.next = "STACK_READ_SP"
                with m.Elif(mask_latched.bit_select(n_idx, 1)):
                    m.d.comb += [
                        local_cr_wr_en.eq(1),
                        local_cr_wr_addr.eq(n_idx),
                        local_cr_wr_data.eq(0),
                    ]
                    m.d.sync += n_idx.eq(n_idx + 1)
                with m.Else():
                    m.d.sync += n_idx.eq(n_idx + 1)

            with m.State("STACK_READ_SP"):
                # Read the stack pointer from Heap[0] = Mem[CR5.word1_location]
                # SP is a word offset; the stack grows upward (SP+2 per CALL frame)
                m.d.comb += [
                    self.mem_rd_addr.eq(cr5_heap_view.word1_location),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += sp_latched.eq(self.mem_rd_data)
                    m.next = "STACK_CHECK"

            with m.State("STACK_CHECK"):
                # Overflow: sp + 2 > stack_limit means no room for the 2-word frame
                with m.If((sp_latched + 2) > self.stack_limit):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.STACK_OVERFLOW),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "STACK_WRITE_EGT"

            with m.State("STACK_WRITE_EGT"):
                # Push word 0 of frame: raw E-GT of callee (32-bit GT word from src CR)
                # Byte address = thread_base + sp * 4
                m.d.comb += [
                    local_mem_wr_addr.eq(self.thread_base + (sp_latched << 2)),
                    local_mem_wr_data.eq(src_reg_latched.as_value()[:32]),   # raw 32-bit GT word
                    local_mem_wr_en.eq(1),
                ]
                m.next = "STACK_WRITE_FRAME"

            with m.State("STACK_WRITE_FRAME"):
                # Push word 1 of frame: LAMBDA hidden register (caller return frame word)
                # TODO: exact bit encoding of lambda_frame_reg (NIA offset + machine
                #       indicators) is not yet fully specified — placeholder until confirmed
                # Byte address = thread_base + (sp + 1) * 4
                m.d.comb += [
                    local_mem_wr_addr.eq(self.thread_base + ((sp_latched + 1) << 2)),
                    local_mem_wr_data.eq(self.lambda_frame_reg),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "STACK_WRITE_SP"

            with m.State("STACK_WRITE_SP"):
                # Update SP: write sp + 2 back to Heap[0] = Mem[CR5.word1_location]
                m.d.comb += [
                    local_mem_wr_addr.eq(cr5_heap_view.word1_location),
                    local_mem_wr_data.eq(sp_latched + 2),
                    local_mem_wr_en.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.call_busy.eq(~fsm.ongoing("IDLE")),
            self.call_complete.eq(fsm.ongoing("COMPLETE")),
            self.call_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(nia_computed),
        ]

        return m
