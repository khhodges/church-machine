from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .mload import CTMMCapMLoad


class CTMMCapCall(Elaboratable):
    def __init__(self):
        self.call_start = Signal()
        self.cr_src = Signal(4)
        self.index = Signal(17)
        self.mask = Signal(11)
        self.call_busy = Signal()
        self.call_complete = Signal()        # COMPLETE | M_FETCH_DONE (for exec advance only)
        self.call_normal_complete = Signal() # COMPLETE only (for stack push)
        self.call_fault = Signal()
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
        self.dr_clear_mask = Signal(16)
        self.cr_clear_mask = Signal(16)

        # M-GT dispatch outputs — pulsed for one cycle when M_FETCH_DONE fires.
        # Loads M-window shadow (XR11-XR15) from the 4-word fetched NS entry.
        self.mgt_set_trigger  = Signal()
        self.mgt_gt_word      = Signal(32)   # raw 32-bit Abstract GT (src cap's word0_gt)
        self.mgt_ns_location  = Signal(32)   # NS entry word0_location
        self.mgt_ns_authority = Signal(32)   # NS entry word1_limit (authority)
        self.mgt_ns_integrity = Signal(32)   # NS entry word2_integrity
        self.mgt_ns_seals     = Signal(32)   # NS entry word3_abstract_gt (advisory seals)

    def elaborate(self, platform):
        m = Module()

        MAX_SRC_REG = 5
        B_BIT_POS = 31
        LIMIT_WIDTH = 32

        u_mload = CTMMCapMLoad()
        m.submodules.u_mload = u_mload

        phase = Signal()
        src_reg_latched = Signal(CAP_REG_LAYOUT)
        mask_latched = Signal(11)
        fault_latched = Signal()
        fault_type_latched = Signal(4)
        sub_start = Signal()
        sub_start_reg = Signal()
        sub_done_latched = Signal()
        sub_fault_latched = Signal()

        local_cr_rd_en = Signal()
        local_cr_rd_addr = Signal(4)

        b_idx = Signal(3)
        b_cr_data = Signal(CAP_REG_LAYOUT)
        b_clear_wr_en = Signal()
        b_clear_wr_addr = Signal(4)
        b_clear_wr_data = Signal(CAP_REG_LAYOUT)

        # M-GT dispatch latches + direct memory read override
        mgt_gt_lat   = Signal(32)
        mgt_gt_view  = View(GT_LAYOUT, mgt_gt_lat)
        ns_loc_lat   = Signal(32)
        ns_auth_lat  = Signal(32)
        ns_int_lat   = Signal(32)
        ns_seal_lat  = Signal(32)

        local_mem_rd_addr = Signal(32)
        local_mem_rd_en   = Signal()

        ns_view = View(CAP_REG_LAYOUT, self.cr15_namespace)
        mgt_ns_entry_base = Signal(32)
        m.d.comb += mgt_ns_entry_base.eq(
            ns_view.word1_location + (mgt_gt_view.index << 4)
        )

        src_in_range = Signal()
        m.d.comb += src_in_range.eq(self.cr_src <= MAX_SRC_REG)

        src_view = View(CAP_REG_LAYOUT, src_reg_latched)
        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        src_has_l_perm = src_gt.perms[PERM_L]

        mload_src = Signal(4)
        mload_dst = Signal(4)
        mload_index = Signal(17)
        m.d.comb += [
            mload_src.eq(Mux(phase, CR_CLIST, self.cr_src)),
            mload_dst.eq(Mux(phase, CR_NUCLEUS, CR_CLIST)),
            mload_index.eq(Mux(phase, 0, self.index)),
        ]

        m.d.comb += [
            u_mload.sub_start.eq(sub_start),
            u_mload.sub_cr_src.eq(mload_src),
            u_mload.sub_cr_dst.eq(mload_dst),
            u_mload.sub_index.eq(mload_index),
            u_mload.sub_direct.eq(0),
            u_mload.sub_m_elevated.eq(1),
            u_mload.sub_direct_gt.eq(0),
            u_mload.cr_rd_data.eq(self.cr_rd_data),
            u_mload.cr15_namespace.eq(self.cr15_namespace),
            u_mload.mem_rd_data.eq(self.mem_rd_data),
            u_mload.mem_rd_valid.eq(self.mem_rd_valid),
        ]

        m.d.comb += [
            self.cr_wr_addr.eq(Mux(b_clear_wr_en, b_clear_wr_addr, u_mload.cr_wr_addr)),
            self.cr_wr_data.eq(Mux(b_clear_wr_en, b_clear_wr_data, u_mload.cr_wr_data)),
            self.cr_wr_en.eq(u_mload.cr_wr_en | b_clear_wr_en),
            # M-GT fetch states own the memory bus; fall back to u_mload otherwise
            self.mem_addr.eq(Mux(local_mem_rd_en, local_mem_rd_addr, u_mload.mem_addr)),
            self.mem_rd_en.eq(local_mem_rd_en | u_mload.mem_rd_en),
            self.thread_wr_en.eq(u_mload.thread_wr_en),
            self.thread_wr_idx.eq(u_mload.thread_wr_idx),
            self.thread_wr_data.eq(u_mload.thread_wr_data),
        ]

        m.d.comb += self.cr_rd_addr.eq(Mux(local_cr_rd_en, local_cr_rd_addr, u_mload.cr_rd_addr))
        m.d.comb += sub_start.eq(sub_start_reg)

        cr_preserve = mask_latched[5:11]
        dr1_5_preserve = mask_latched[0:5]

        dr_clear_computed = Signal(16)
        cr_clear_computed = Signal(16)
        m.d.comb += [
            dr_clear_computed.eq(Cat(Const(0, 1), ~dr1_5_preserve, Const(0x3FF, 10))),
            cr_clear_computed.eq(Cat(~cr_preserve, Const(0, 10))),
        ]

        with m.FSM(name="call") as fsm:
            with m.State("IDLE"):
                m.d.sync += [phase.eq(0), fault_latched.eq(0), fault_type_latched.eq(FaultType.NONE)]
                m.d.sync += [sub_done_latched.eq(0), sub_fault_latched.eq(0)]
                with m.If(self.call_start):
                    m.d.sync += mask_latched.eq(self.mask)
                    m.next = "CHECK_SRC"

            with m.State("CHECK_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_src)]
                with m.If(~src_in_range):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_SRC"

            with m.State("READ_SRC"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(self.cr_src)]
                m.d.sync += src_reg_latched.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(src_gt.gt_type == GT_TYPE_ABSTRACT):
                    # M-GT dispatch: latch the Abstract GT word and fetch all 4 NS
                    # entry words (location/limit/integrity/seals) via 16-byte stride.
                    # No lump or stack frame — M-window set fires at M_FETCH_DONE.
                    m.d.sync += mgt_gt_lat.eq(src_view.word0_gt.as_value())
                    m.next = "M_FETCH_NS0"
                with m.Elif(~src_has_l_perm):
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(FaultType.PERM_L)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += sub_start_reg.eq(1)
                    m.next = "PHASE1"

            with m.State("PHASE1"):
                m.d.sync += sub_start_reg.eq(0)
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
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
                with m.If(u_mload.sub_done):
                    m.d.sync += sub_done_latched.eq(1)
                with m.If(u_mload.sub_fault):
                    m.d.sync += sub_fault_latched.eq(1)
                    m.d.sync += [fault_latched.eq(1), fault_type_latched.eq(u_mload.sub_fault_type)]
                with m.If(sub_fault_latched):
                    m.next = "FAULT"
                with m.Elif(sub_done_latched):
                    m.next = "CLEAR_B_INIT"

            with m.State("CLEAR_B_INIT"):
                m.d.sync += b_idx.eq(0)
                m.next = "CLEAR_B_CHECK"

            with m.State("CLEAR_B_CHECK"):
                with m.If(b_idx > 5):
                    m.next = "COMPLETE"
                with m.Elif(cr_preserve.bit_select(b_idx, 1)):
                    m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(b_idx)]
                    m.next = "CLEAR_B_READ"
                with m.Else():
                    m.d.sync += b_idx.eq(b_idx + 1)

            with m.State("CLEAR_B_READ"):
                m.d.comb += [local_cr_rd_en.eq(1), local_cr_rd_addr.eq(b_idx)]
                m.d.sync += b_cr_data.eq(self.cr_rd_data)
                m.next = "CLEAR_B_WRITE"

            with m.State("CLEAR_B_WRITE"):
                b_src = View(CAP_REG_LAYOUT, b_cr_data)
                cleared_limit = Signal(LIMIT_WIDTH, name="cleared_limit")
                m.d.comb += cleared_limit.eq(b_src.word2_limit & ~(1 << B_BIT_POS))
                b_dst = View(CAP_REG_LAYOUT, b_clear_wr_data)
                m.d.comb += [
                    b_dst.word0_gt.eq(b_src.word0_gt),
                    b_dst.word1_location.eq(b_src.word1_location),
                    b_dst.word2_limit.eq(cleared_limit),
                    b_dst.word3_seals.eq(b_src.word3_seals),
                    b_clear_wr_en.eq(1),
                    b_clear_wr_addr.eq(b_idx),
                ]
                m.d.sync += b_idx.eq(b_idx + 1)
                m.next = "CLEAR_B_CHECK"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

            # ── M-GT dispatch states ──────────────────────────────────────────
            # Entered from CHECK_PERM when src GT has gt_type == GT_TYPE_ABSTRACT.
            # Reads all 4 NS entry words (location/limit/integrity/seals) using 16-byte stride.
            # mgt_set_trigger fires for one cycle at M_FETCH_DONE; no lump is loaded.

            with m.State("M_FETCH_NS0"):
                m.d.comb += [
                    local_mem_rd_addr.eq(mgt_ns_entry_base),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_loc_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS1"

            with m.State("M_FETCH_NS1"):
                m.d.comb += [
                    local_mem_rd_addr.eq(mgt_ns_entry_base + 4),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_auth_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS2"

            with m.State("M_FETCH_NS2"):
                m.d.comb += [
                    local_mem_rd_addr.eq(mgt_ns_entry_base + 8),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_int_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_NS3"

            with m.State("M_FETCH_NS3"):
                # Fetch NS entry word3_abstract_gt (advisory seals annotation)
                m.d.comb += [
                    local_mem_rd_addr.eq(mgt_ns_entry_base + 12),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_seal_lat.eq(self.mem_rd_data)
                    m.next = "M_FETCH_DONE"

            with m.State("M_FETCH_DONE"):
                # mgt_set_trigger pulses for this one cycle (driven combinatorially).
                # call_complete is asserted so core advances past the CALL instruction.
                m.next = "IDLE"

        m.d.comb += [
            self.call_busy.eq(~fsm.ongoing("IDLE")),
            self.call_complete.eq(fsm.ongoing("COMPLETE") | fsm.ongoing("M_FETCH_DONE")),
            self.call_normal_complete.eq(fsm.ongoing("COMPLETE")),
            self.call_fault.eq(fault_latched),
            self.fault_type.eq(fault_type_latched),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.nia_value.eq(0),
            self.dr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), dr_clear_computed, 0)),
            self.cr_clear_mask.eq(Mux(fsm.ongoing("COMPLETE"), cr_clear_computed, 0)),
            self.mgt_set_trigger.eq(fsm.ongoing("M_FETCH_DONE")),
            self.mgt_gt_word.eq(mgt_gt_lat),
            self.mgt_ns_location.eq(ns_loc_lat),
            self.mgt_ns_authority.eq(ns_auth_lat),
            self.mgt_ns_integrity.eq(ns_int_lat),
            self.mgt_ns_seals.eq(ns_seal_lat),
        ]

        return m
