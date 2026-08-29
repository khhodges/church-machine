from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, LUMP_HEADER_LAYOUT, COND_FLAGS_LAYOUT
from .mload import ChurchMLoad
from .perm_check import perm_bit
from .mload_seq import mload_wait_body
from .stack_frame import stack_slot_addr
from .thread_design import THREAD_STO_OFFSET


class ChurchELoadCall(Elaboratable):
    def __init__(self, enable_seal_check=None):
        self._enable_seal_check = enable_seal_check
        self.start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.mask = Signal(16)
        self.call_imm = Signal(15)    # method-table slot (1-based; 0 = fast-path)
        self.busy = Signal()
        self.complete = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)   # 5 bits: FaultType.STACK_OVERFLOW=0x10 requires 5 bits

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.dr_clear_mask = Signal(16)
        self.cr_clear_mask = Signal(16)

        # Call-stack frame push (ELOADCALL fix): ELOADCALL now pushes a frame
        # identical to a CALL frame so that RETURN inside an ELOADCALL-entered
        # lump can unwind cleanly instead of faulting (NIA→0 → RANGE fault).
        #
        # Frame word layout: FLAGS[31:28] | return_PC[27:13] |
        # prior_SZ[12] | prev_STO[11:0].
        #
        # Core wires these from u_regs.cr5_heap, u_regs.cr12_thread, CR12.word1_location,
        # and u_change.thread_hdr_out (per-thread LUMP_HEADER_LAYOUT word).
        self.cr5_heap    = Signal(CAP_REG_LAYOUT)   # ordinary heap cap (base = Thread +18)
        self.thread_base = Signal(32)               # CR12 thread lump byte base
        self.thread_hdr  = Signal(32)               # LUMP_HEADER_LAYOUT word (n_minus_6, cw, cc)
        self.cr12_thread = Signal(CAP_REG_LAYOUT)   # CR12 thread cap (for null check)
        self.flags = Signal(COND_FLAGS_LAYOUT)

        # Direct DMEM writes for the three frame-push words:
        #   (1) callee E-GT  at thread_base + (STO-1)*4
        #   (2) frame word   at thread_base + STO*4
        #   (3) new STO      at protected Thread word +17
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en   = Signal()

        # Lazy-resolve IRQ outputs (Task #1523): pulsed when CHECK_E detects
        # a NULL GT in the loaded c-list slot.  Core uses these to trigger
        # ChurchIRQDispatch with reason=IRQ_REASON_LAZY_RESOLVE.
        self.lazy_resolve_irq  = Signal()
        self.lazy_resolve_slot = Signal(16)   # c-list row index of the NULL GT

        # Pet-name memory interface (Task #1526): combinatorial read port.
        # Core presents the c-list slot index on pet_name_rd_addr each cycle
        # and drives pet_name_rd_data with the corresponding "has pet name" bit.
        # CHECK_E only routes NULL GTs to LAZY_RESOLVE_ABORT when this is 1;
        # otherwise the existing NULL_CAP hard fault is preserved.
        self.pet_name_rd_addr = Signal(16)   # output: current c-list slot index
        self.pet_name_rd_data = Signal(1)    # input:  1 = slot has a pet name

    def elaborate(self, platform):
        m = Module()

        MAX_SRC_REG = 5

        u_mload = ChurchMLoad(enable_seal_check=self._enable_seal_check)
        m.submodules.u_mload = u_mload

        phase = Signal(2)
        loaded_cap = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(16)
        call_imm_latched = Signal(15)
        fault_latched = Signal()
        fault_type_latched = Signal(5)   # 5 bits: matches self.fault_type width
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        cr14_latched = Signal(CAP_REG_LAYOUT)
        cr14_lat_view = View(CAP_REG_LAYOUT, cr14_latched)
        ns_base = Signal(32)
        method_entry_reg = Signal(32)
        method_entry_reading = Signal()
        method_entry_addr_sig = Signal(32)

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        # ── Call-stack frame push ──────────────────────────────────────────────
        # Sentinel return PC = 3 (word offset → NIA = 0x0C = boot ROM BRANCH -1).
        _SENTINEL_RETURN_PC = 3

        # callee_egt_latched: latched in CALL_P1_DONE by reading CR6.word0_gt.
        #   This is the phase-1 result cap GT (the capability actually committed
        #   into the callee’s c-list slot), matching what ChurchCall saves.
        callee_egt_latched = Signal(32)

        # Stack bounds from thread_hdr (LUMP_HEADER_LAYOUT), mirrors call.py.
        #   sp_max = lump_sz − 12 − 1   (max valid STO before the frame push)
        #   sp_min = lump_sz − 10 − cw  (stack floor — code zone boundary)
        thread_hdr_view = View(LUMP_HEADER_LAYOUT, self.thread_hdr)
        thr_lump_sz     = Signal(15)
        sp_max          = Signal(15)
        sp_min          = Signal(15)
        sp_min_base     = Signal(15)

        # CR5 / CR12 validity (mirrors ChurchCall.CHECK_CR5_CR12).
        cr5_view  = View(CAP_REG_LAYOUT, self.cr5_heap)
        cr5_gt    = View(GT_LAYOUT, cr5_view.word0_gt)
        cr5_null  = Signal()
        cr5_has_r = Signal()

        cr12_view = View(CAP_REG_LAYOUT, self.cr12_thread)
        cr12_gt   = View(GT_LAYOUT, cr12_view.word0_gt)
        cr12_null = Signal()

        m.d.comb += [
            thr_lump_sz.eq(Const(1, 15) << (thread_hdr_view.n_minus_6 + 6)),
            sp_max.eq(thr_lump_sz - 12 - 1),
            sp_min_base.eq(thr_lump_sz - 10),
            sp_min.eq(sp_min_base - thread_hdr_view.cw),
            cr5_null.eq(cr5_gt.gt_type == GT_TYPE_NULL),
            cr5_has_r.eq(~cr5_gt.dom & cr5_gt.perm[PERM_R]),
            cr12_null.eq(cr12_gt.gt_type == GT_TYPE_NULL),
        ]

        sto_indicator = Signal(32)
        sto_latched   = Signal(12)
        sto_reading   = Signal()     # asserted to drive the protected STO read
        sto_rd_armed  = Signal()     # one-cycle guard before trusting mem_rd_valid
        sto_read_addr = Signal(32)
        frame_word    = Signal(32)   # SZ=1 | sentinel_return_pc | prev_STO

        local_mem_wr_en   = Signal()
        local_mem_wr_addr = Signal(32)
        local_mem_wr_data = Signal(32)

        m.d.comb += [
            sto_read_addr.eq(
                self.thread_base + (THREAD_STO_OFFSET << 2)),
            frame_word.eq(Cat(
                sto_latched, sto_indicator[12],
                Const(_SENTINEL_RETURN_PC, 15), self.flags.as_value())),
        ]

        loaded_view = View(CAP_REG_LAYOUT, loaded_cap)
        loaded_gt = View(GT_LAYOUT, loaded_view.word0_gt)
        has_e_perm = perm_bit(loaded_view.word0_gt, PERM_E)
        is_null = Signal()
        m.d.comb += is_null.eq(loaded_gt.gt_type == GT_TYPE_NULL)

        index_latched = Signal(16)

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(16)
        with m.Switch(phase):
            with m.Case(0):
                m.d.comb += [
                    mload_src.eq(self.cr_src),
                    mload_dst.eq(self.cr_dst),
                    mload_index.eq(self.index),
                ]
            with m.Case(1):
                m.d.comb += [
                    mload_src.eq(self.cr_dst),
                    mload_dst.eq(CR_CLIST),
                    mload_index.eq(0),
                ]
            with m.Default():
                m.d.comb += [
                    mload_src.eq(CR_CLIST),
                    mload_dst.eq(CR_NUCLEUS),
                    mload_index.eq(0),
                ]

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_m_elevated.eq(mload_src == CR_CLIST),
            u_mload.sub_direct_gt.eq(0),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(u_mload.cr_wr_addr),
            self.cr_wr_data.eq(u_mload.cr_wr_data),
            self.cr_wr_en.eq(u_mload.cr_wr_en),
            # Mux (priority: method-entry > protected STO read > mload's normal bus).
            self.mem_addr.eq(
                Mux(method_entry_reading, method_entry_addr_sig,
                Mux(sto_reading,          sto_read_addr,
                                          u_mload.mem_addr))
            ),
            self.mem_rd_en.eq(method_entry_reading | sto_reading | u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
            # Frame-push write port (driven by PUSH_EGT/PUSH_FRAME/PUSH_STO states).
            self.mem_wr_addr.eq(local_mem_wr_addr),
            self.mem_wr_data.eq(local_mem_wr_data),
            self.mem_wr_en.eq(local_mem_wr_en),
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr)
        )
        m.d.comb += sub_start.eq(sub_start_reg)

        # ns_base: lump base address extracted from CR14 (CR_CLOOMC) after loading.
        # word1_location holds the lump's base byte address.
        m.d.comb += ns_base.eq(cr14_lat_view.word1_location[:32])

        cr_preserve = mask_latched[5:11]
        dr1_5_preserve = mask_latched[0:5]

        dr_clear_computed = Signal(16)
        cr_clear_computed = Signal(16)
        nia_computed = Signal(32)
        m.d.comb += [
            dr_clear_computed.eq(Cat(Const(0, 1), ~dr1_5_preserve, Const(0x3FF, 10))),
            cr_clear_computed.eq(Cat(~cr_preserve, Const(0, 10))),
            # imm=0 fast-path: NIA = lump word 1 = ns_base+4.
            # imm=k+1: NIA = ns_base + (method_entry_reg << 2).
            nia_computed.eq(
                Mux(call_imm_latched == 0, ns_base + 4, ns_base + (method_entry_reg << 2))
            ),
        ]

        with m.FSM(name="eloadcall") as fsm:
            with m.State("IDLE"):
                m.d.sync += [
                    phase.eq(0), fault_latched.eq(0),
                    fault_type_latched.eq(FaultType.NONE),
                    sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += [
                        mask_latched.eq(self.mask),
                        call_imm_latched.eq(self.call_imm),
                        index_latched.eq(self.index),
                    ]
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                with m.If(~src_in_range):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_L),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "LOAD_PHASE"

            with m.State("LOAD_PHASE"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=u_mload.sub_done,
                    fault_sig=u_mload.sub_fault,
                    fault_type_sig=u_mload.sub_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="LOAD_DONE",
                )

            with m.State("LOAD_DONE"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_dst)]
                m.d.sync += loaded_cap.eq(self.cr_rd_data)
                m.next = "CHECK_E"

            with m.State("CHECK_E"):
                with m.If(is_null):
                    # NULL GT in c-list slot (Task #1523 / Task #1526).
                    # Only route to Scheduler.IRQ when the slot has a pet name —
                    # the assembler registers named slots in PetNameMemory.
                    # Anonymous NULL GTs (no pet name) preserve the hard NULL_CAP
                    # fault so accidental zero-slots still crash loudly.
                    with m.If(self.pet_name_rd_data):
                        m.next = "LAZY_RESOLVE_ABORT"
                    with m.Else():
                        m.d.sync += [
                            fault_latched.eq(1),
                            fault_type_latched.eq(FaultType.NULL_CAP),
                        ]
                        m.next = "FAULT"
                with m.Elif(~has_e_perm):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_E),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += [phase.eq(1), sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "CALL_P1"

            with m.State("CALL_P1"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=u_mload.sub_done,
                    fault_sig=u_mload.sub_fault,
                    fault_type_sig=u_mload.sub_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="CALL_P1_DONE",
                )

            with m.State("CALL_P1_DONE"):
                # Latch the phase-1 callee E-GT from CR6 before phase 2 runs.
                # CR6 (CR_CLIST) has just been written by CALL_P1’s mLoad; its
                # word0_gt is the capability actually selected for the callee’s
                # c-list slot 0, matching what ChurchCall saves in PHASE1_DONE.
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(CR_CLIST)]
                m.d.sync += callee_egt_latched.eq(
                    View(CAP_REG_LAYOUT, self.cr_rd_data).word0_gt.as_value()
                )
                m.d.sync += [
                    phase.eq(2), sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                m.d.sync += sub_start_reg.eq(1)
                m.next = "CALL_P2"

            with m.State("CALL_P2"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=u_mload.sub_done,
                    fault_sig=u_mload.sub_fault,
                    fault_type_sig=u_mload.sub_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="READ_CR14",
                )

            with m.State("READ_CR14"):
                # Read CR14 (CR_CLOOMC) to get the current lump's base address (ns_base).
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(CR_CLOOMC)]
                m.d.sync += cr14_latched.eq(self.cr_rd_data)
                m.next = "DISPATCH"

            with m.State("DISPATCH"):
                # cr14_latched is now valid; ns_base is derived from it combinatorially.
                # Method-entry validation happens first; frame push follows only on success.
                with m.If(call_imm_latched == 0):
                    # Fast-path (imm=0): NIA = ns_base + 4.  Dispatch is unconditionally
                    # valid — proceed to pre-push CR5/CR12 validation.
                    m.next = "PUSH_CR5_CR12"
                with m.Else():
                    # Indexed dispatch: validate method-entry before touching the stack.
                    m.d.comb += [
                        method_entry_reading.eq(1),
                        method_entry_addr_sig.eq(ns_base + (call_imm_latched.as_unsigned() << 2)),
                    ]
                    m.next = "FETCH_METHOD_ENTRY"

            with m.State("FETCH_METHOD_ENTRY"):
                # Keep address asserted; mem_rd_valid is always 1, so entry is available now.
                m.d.comb += [
                    method_entry_reading.eq(1),
                    method_entry_addr_sig.eq(ns_base + (call_imm_latched.as_unsigned() << 2)),
                ]
                with m.If(self.mem_rd_valid):
                    with m.If(self.mem_rd_data == 0):
                        # Entry 0 = private/absent: fault WITHOUT touching the stack.
                        m.d.sync += [
                            fault_latched.eq(1),
                            fault_type_latched.eq(FaultType.PERM_E),
                        ]
                        m.next = "FAULT"
                    with m.Else():
                        # Dispatch validated — proceed to pre-push CR5/CR12 validation.
                        m.d.sync += method_entry_reg.eq(self.mem_rd_data)
                        m.next = "PUSH_CR5_CR12"

            # ── Call-stack frame push ──────────────────────────────────────
            # Six states mirror what CALL does (hardware/call.py).  They execute
            # ONLY after successful dispatch validation (DISPATCH or
            # FETCH_METHOD_ENTRY) so a failed instruction never corrupts the stack.
            #
            #   PUSH_CR5_CR12  — validate CR5 (non-null, has R-perm) and CR12 (non-null)
            #   PUSH_ARM       — arm the protected STO read
            #   PUSH_READ_STO  — wait for STO read valid; latch into sto_latched
            #   PUSH_BOUNDS    — full stack-zone bounds check using thread_hdr:
            #                      STO > sp_max → STACK_CORRUPT (pointer out of zone)
            #                      STO < sp_min → STACK_OVERFLOW (zone exhausted)
            #   PUSH_EGT       — write callee E-GT (phase-1 CR6 GT) at (STO-1)
            #   PUSH_FRAME     — write frame word  at thread_base+STO*4
            #   PUSH_STO       — write new STO (STO-2) back to Thread +17
            # After PUSH_STO the FSM proceeds to COMPLETE.

            with m.State("PUSH_CR5_CR12"):
                # Mirror ChurchCall.CHECK_CR5_CR12: validate CR5 is a live heap cap
                # with R-permission, and CR12 is a live thread cap.  Any failure here
                # is caught BEFORE touching the stack, so the frame is never half-written.
                with m.If(cr5_null):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.NULL_CAP),
                    ]
                    m.next = "FAULT"
                with m.Elif(~cr5_has_r):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_R),
                    ]
                    m.next = "FAULT"
                with m.Elif(cr12_null):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.NULL_CAP),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "PUSH_ARM"

            with m.State("PUSH_ARM"):
                m.d.comb += sto_reading.eq(1)
                m.d.sync += sto_rd_armed.eq(1)
                m.next = "PUSH_READ_STO"

            with m.State("PUSH_READ_STO"):
                m.d.comb += sto_reading.eq(1)
                with m.If(sto_rd_armed & self.mem_rd_valid):
                    m.d.sync += [
                        sto_indicator.eq(self.mem_rd_data),
                        sto_latched.eq(self.mem_rd_data[:12]),
                        sto_rd_armed.eq(0),
                    ]
                    m.next = "PUSH_BOUNDS"

            with m.State("PUSH_BOUNDS"):
                # Full bounds check using thread_hdr-derived sp_max / sp_min,
                # matching ChurchCall.STACK_CHECK exactly.
                # STO > sp_max: pointer above the stack zone → STACK_CORRUPT.
                # STO < sp_min: stack zone exhausted (floor reached) → STACK_OVERFLOW.
                with m.If(sto_latched > sp_max):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.STACK_CORRUPT),
                    ]
                    m.next = "FAULT"
                with m.Elif(sto_latched < sp_min):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.STACK_OVERFLOW),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "PUSH_EGT"

            with m.State("PUSH_EGT"):
                # Write callee E-GT to stack slot STO-1.
                # callee_egt_latched was captured from CR6.word0_gt in CALL_P1_DONE
                # (phase-1 result), matching what ChurchCall writes in STACK_WRITE_EGT.
                m.d.comb += [
                    local_mem_wr_en.eq(1),
                    local_mem_wr_addr.eq(stack_slot_addr(self.thread_base, sto_latched, -1)),
                    local_mem_wr_data.eq(callee_egt_latched),
                ]
                m.next = "PUSH_FRAME"

            with m.State("PUSH_FRAME"):
                # Write frame word (SZ=1 | sentinel_return_pc | prev_STO) to stack slot STO.
                m.d.comb += [
                    local_mem_wr_en.eq(1),
                    local_mem_wr_addr.eq(stack_slot_addr(self.thread_base, sto_latched, 0)),
                    local_mem_wr_data.eq(frame_word),
                ]
                m.next = "PUSH_STO"

            with m.State("PUSH_STO"):
                # Write new STO = STO-2 to protected Thread word +17.
                # Full 32-bit write matches ChurchCall.STACK_WRITE_SP.
                m.d.comb += [
                    local_mem_wr_en.eq(1),
                    local_mem_wr_addr.eq(sto_read_addr),
                    local_mem_wr_data.eq(Cat(
                        (sto_latched - 2)[:12], Const(1, 1),
                        Const(0, 15), self.flags.as_value())),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

            with m.State("LAZY_RESOLVE_ABORT"):
                # NULL GT in c-list slot: abort silently; core dispatches to
                # Scheduler.IRQ via ChurchIRQDispatch (Task #1523,
                # IRQ_REASON_LAZY_RESOLVE).
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(nia_computed),
            self.dr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), dr_clear_computed, 0)),
            self.cr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), cr_clear_computed, 0)),
            self.lazy_resolve_irq.eq(fsm.ongoing("LAZY_RESOLVE_ABORT")),
            self.lazy_resolve_slot.eq(index_latched),
            self.pet_name_rd_addr.eq(index_latched),
        ]

        return m


class ChurchXLoadLambda(Elaboratable):
    def __init__(self, enable_seal_check=None):
        self._enable_seal_check = enable_seal_check
        self.start = Signal()
        self.cr_src = Signal(4)
        self.cr_dst = Signal(4)
        self.index = Signal(16)
        self.busy = Signal()
        self.complete = Signal()
        self.fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.saved_nia = Signal(32)

        # Lazy-resolve IRQ outputs (Task #1523): pulsed when CHECK_X detects
        # a NULL GT.  Core triggers ChurchIRQDispatch with reason=LAZY_RESOLVE.
        self.lazy_resolve_irq  = Signal()
        self.lazy_resolve_slot = Signal(16)   # c-list row index of the NULL GT

        # Pet-name memory interface (Task #1526): combinatorial read port.
        # Mirrors the ELOADCALL interface — CHECK_X only fires LAZY_RESOLVE_ABORT
        # when the c-list slot has a pet name; otherwise NULL_CAP hard fault.
        self.pet_name_rd_addr = Signal(16)   # output: current c-list slot index
        self.pet_name_rd_data = Signal(1)    # input:  1 = slot has a pet name

    def elaborate(self, platform):
        m = Module()

        u_mload = ChurchMLoad(enable_seal_check=self._enable_seal_check)
        m.submodules.u_mload = u_mload

        loaded_cap = Signal(CAP_REG_LAYOUT)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()
        index_latched = Signal(16)

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        loaded_view = View(CAP_REG_LAYOUT, loaded_cap)
        loaded_gt = View(GT_LAYOUT, loaded_view.word0_gt)
        has_x_perm = perm_bit(loaded_view.word0_gt, PERM_X)
        is_null = Signal()
        m.d.comb += is_null.eq(loaded_gt.gt_type == GT_TYPE_NULL)

        m.d.comb += [
            u_mload.sub_start.eq(sub_start_reg),
            u_mload.sub_cr_src.eq(self.cr_src),
            u_mload.sub_cr_dst.eq(self.cr_dst),
            u_mload.sub_index.eq(self.index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_m_elevated.eq(self.cr_src == CR_CLIST),
            u_mload.sub_direct_gt.eq(0),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(u_mload.cr_wr_addr),
            self.cr_wr_data.eq(u_mload.cr_wr_data),
            self.cr_wr_en.eq(u_mload.cr_wr_en),
            self.mem_addr.eq(u_mload.mem_addr),
            self.mem_rd_en.eq(u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        m.d.comb += self.cr_rd_addr.eq(
            Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr)
        )

        with m.FSM(name="xloadlambda") as fsm:
            with m.State("IDLE"):
                m.d.sync += [
                    fault_latched.eq(0),
                    fault_type_latched.eq(FaultType.NONE),
                    sub_done_latched.eq(0), sub_fault_latched.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += [sub_start_reg.eq(1), index_latched.eq(self.index)]
                    m.next = "LOAD_PHASE"

            with m.State("LOAD_PHASE"):
                mload_wait_body(
                    m,
                    sub_start_reg=sub_start_reg,
                    done_sig=u_mload.sub_done,
                    fault_sig=u_mload.sub_fault,
                    fault_type_sig=u_mload.sub_fault_type,
                    sub_done_latched=sub_done_latched,
                    sub_fault_latched=sub_fault_latched,
                    fault_latched=fault_latched,
                    fault_type_latched=fault_type_latched,
                    done_next="LOAD_DONE",
                )

            with m.State("LOAD_DONE"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_dst)]
                m.d.sync += loaded_cap.eq(self.cr_rd_data)
                m.next = "CHECK_X"

            with m.State("CHECK_X"):
                with m.If(is_null):
                    # NULL GT in c-list slot (Task #1523 / Task #1526).
                    # Only route to Scheduler.IRQ when the slot has a pet name.
                    # Anonymous NULL GTs (no pet name) fault hard as NULL_CAP.
                    with m.If(self.pet_name_rd_data):
                        m.next = "LAZY_RESOLVE_ABORT"
                    with m.Else():
                        m.d.sync += [
                            fault_latched.eq(1),
                            fault_type_latched.eq(FaultType.NULL_CAP),
                        ]
                        m.next = "FAULT"
                with m.Elif(~has_x_perm):
                    m.d.sync += [
                        fault_latched.eq(1),
                        fault_type_latched.eq(FaultType.PERM_X),
                    ]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "EXECUTE"

            with m.State("EXECUTE"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(loaded_view.word1_location[:32]),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

            with m.State("LAZY_RESOLVE_ABORT"):
                # NULL GT in c-list slot: abort silently; core dispatches to
                # Scheduler.IRQ via ChurchIRQDispatch (Task #1523,
                # IRQ_REASON_LAZY_RESOLVE).
                m.next = "IDLE"

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.lazy_resolve_irq.eq(fsm.ongoing("LAZY_RESOLVE_ABORT")),
            self.lazy_resolve_slot.eq(index_latched),
            self.pet_name_rd_addr.eq(index_latched),
        ]

        return m
