from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, NS_ENTRY_LAYOUT, WORD2_LAYOUT
from .perm_check import perm_bit
from .ns_gate import ChurchNSGate


class ChurchMLoad(Elaboratable):
    """mLoad — load a Golden Token from a c-list into a capability register.

    Security gate
    ─────────────
    The NS integrity check (3 reads + gt_seq + CRC) is performed by the
    shared ChurchNSGate sub-module.  mLoad adds the c-list walk before the
    gate and g-bit reset + CR write after it.

    FSM (seal-check enabled)
    ────────────────────────
        IDLE → FETCH_SRC → CHECK_L → CHECK_BOUNDS → FETCH_GT
             → CHECK_NS → START_GATE → WAIT_GATE
             → RESET_GBIT → UPDATE_THREAD → COMPLETE
             → FAULT (any error)

    FSM (seal-check disabled)
    ─────────────────────────
        IDLE → FETCH_SRC → CHECK_L → CHECK_BOUNDS → FETCH_GT
             → CHECK_NS → START_GATE → WAIT_GATE
             → UPDATE_THREAD → COMPLETE
             → FAULT
    """

    def __init__(self, enable_seal_check=None):
        self.enable_seal_check = enable_seal_check if enable_seal_check is not None else ENABLE_SEAL_CHECK

        self.sub_start = Signal()
        self.sub_cr_src = Signal(4)
        self.sub_cr_dst = Signal(4)
        self.sub_index = Signal(16)
        self.sub_direct = Signal()
        self.sub_direct_gt = Signal(32)
        self.sub_m_elevated = Signal()
        self.sub_busy = Signal()
        self.sub_done = Signal()
        self.sub_fault = Signal()
        self.sub_fault_type = Signal(5)  # 5 bits: FaultType values up to 0x18

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
        self.mem_wr_en = Signal()
        self.mem_wr_data = Signal(32)

        self.ns_entry_addr_out = Signal(32)
        self.gbit_reset_done = Signal()

        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)

        self.version_reset_en = Signal()
        self.version_reset_addr = Signal(32)

        # Outform detection outputs (combinatorial pulses / stable latched values)
        self.outform_start_out  = Signal()   # pulses when c-list GT has typ=OUTFORM
        self.outform_gt_raw     = Signal(32) # latched GT word from c-list
        self.outform_slot_id    = Signal(16) # slot_id from the Outform GT
        self.outform_clist_addr = Signal(32) # byte address of the c-list slot (Mint write-back)
        # Inputs from outform FSM
        self.outform_done_in      = Signal()
        self.outform_fault_in     = Signal()
        self.outform_fault_type_in = Signal(5)  # specific outform fault code from outform_iot

        self.ns_abstract_gt = Signal(32)  # NS W3 abstract GT, gated: 0 when ~m_elevated

    def elaborate(self, platform):
        m = Module()

        m.submodules.u_ns_gate = u_ns_gate = ChurchNSGate(
            enable_seal_check=self.enable_seal_check
        )

        cr_src_reg = Signal(4)
        cr_dst_reg = Signal(4)
        index_reg = Signal(16)
        direct_mode = Signal()
        direct_gt_reg = Signal(32)
        m_elevated_reg = Signal()
        src_cap = Signal(CAP_REG_LAYOUT)
        result_cap = Signal(CAP_REG_LAYOUT)
        fault_type_reg = Signal(5)  # 5 bits: FaultType values up to 0x18

        src_view = View(CAP_REG_LAYOUT, src_cap)
        result_view = View(CAP_REG_LAYOUT, result_cap)
        ns_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        result_gt = View(GT_LAYOUT, result_view.word0_gt)

        has_l_perm = perm_bit(src_view.word0_gt, PERM_L)
        src_is_null = Signal()
        m.d.comb += src_is_null.eq(src_gt.gt_type == GT_TYPE_NULL)

        bounds_ok = Signal()
        ns_w2 = View(WORD2_LAYOUT, src_view.word2_w2)
        m.d.comb += bounds_ok.eq(index_reg < ns_w2.limit_offset[:16])

        clist_gt_addr = Signal(32)
        m.d.comb += clist_gt_addr.eq(src_view.word1_location + (index_reg << 2))

        ns_view_for_bounds = View(CAP_REG_LAYOUT, self.cr15_namespace)
        ns_ns_w2 = View(WORD2_LAYOUT, ns_view_for_bounds.word2_w2)

        ns_index_in_bounds = Signal()
        m.d.comb += ns_index_in_bounds.eq(result_gt.slot_id < ns_ns_w2.limit_offset[:16])

        ns_w1_saved = Signal(32)

        # Latched outform context (set in FETCH_GT when typ == GT_TYPE_OUTFORM)
        outform_clist_addr_reg = Signal(32)
        outform_gt_raw_reg     = Signal(32)
        outform_slot_id_reg    = Signal(16)

        local_mem_addr  = Signal(32)
        local_mem_rd_en = Signal()
        local_mem_wr_en  = Signal()
        local_mem_wr_data = Signal(32)

        m.d.comb += u_ns_gate.cr15_namespace.eq(self.cr15_namespace)

        m.d.comb += [
            self.mem_addr.eq(
                Mux(u_ns_gate.ns_gate_busy, u_ns_gate.mem_addr, local_mem_addr)
            ),
            self.mem_rd_en.eq(
                Mux(u_ns_gate.ns_gate_busy, u_ns_gate.mem_rd_en, local_mem_rd_en)
            ),
            self.mem_wr_en.eq(local_mem_wr_en),
            self.mem_wr_data.eq(local_mem_wr_data),
            u_ns_gate.mem_rd_data.eq(self.mem_rd_data),
            u_ns_gate.mem_rd_valid.eq(u_ns_gate.ns_gate_busy & self.mem_rd_valid),
        ]

        m.d.comb += self.ns_entry_addr_out.eq(u_ns_gate.ns_entry_addr_out)

        with m.FSM(name="mload") as fsm:
            with m.State("IDLE"):
                with m.If(self.sub_start):
                    m.d.sync += [
                        cr_src_reg.eq(self.sub_cr_src),
                        cr_dst_reg.eq(self.sub_cr_dst),
                        index_reg.eq(self.sub_index),
                        direct_mode.eq(self.sub_direct),
                        direct_gt_reg.eq(self.sub_direct_gt),
                        m_elevated_reg.eq(self.sub_m_elevated),
                        result_cap.eq(0),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    m.next = "FETCH_SRC"

            with m.State("FETCH_SRC"):
                with m.If(direct_mode):
                    m.d.sync += result_view.word0_gt.eq(direct_gt_reg)
                    m.next = "CHECK_NS"
                with m.Else():
                    m.d.comb += self.cr_rd_addr.eq(cr_src_reg)
                    m.d.sync += src_cap.eq(self.cr_rd_data)
                    m.next = "CHECK_L"

            with m.State("CHECK_L"):
                with m.If(src_is_null):
                    m.d.sync += fault_type_reg.eq(FaultType.NULL_CAP)
                    m.next = "FAULT"
                with m.Elif(~has_l_perm & ~self.sub_m_elevated):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_L)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_BOUNDS"

            with m.State("CHECK_BOUNDS"):
                with m.If(~bounds_ok):
                    m.d.sync += fault_type_reg.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "FETCH_GT"

            with m.State("FETCH_GT"):
                m.d.comb += [
                    local_mem_addr.eq(clist_gt_addr),
                    local_mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += result_view.word0_gt.eq(self.mem_rd_data)
                    with m.If(self.mem_rd_data[25:27] == GT_TYPE_ABSTRACT):
                        # Stub: Abstract GT in a c-list slot has no NS entry or lump.
                        # INVALID_OP prevents ab_data[15:0] from being misinterpreted
                        # as a slot_id in the NS table.  Replace with Abstract Manager
                        # dispatch when the hardware path is implemented (Task #432).
                        m.d.sync += fault_type_reg.eq(FaultType.INVALID_OP)
                        m.next = "FAULT"
                    with m.Elif(self.mem_rd_data[25:27] == GT_TYPE_OUTFORM):
                        m.d.sync += [
                            outform_clist_addr_reg.eq(clist_gt_addr),
                            outform_gt_raw_reg.eq(self.mem_rd_data),
                            outform_slot_id_reg.eq(self.mem_rd_data[:16]),
                        ]
                        m.next = "TRIGGER_OUTFORM"
                    with m.Else():
                        m.next = "CHECK_NS"

            with m.State("CHECK_NS"):
                with m.If(~ns_index_in_bounds):
                    m.d.sync += fault_type_reg.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "START_GATE"

            with m.State("START_GATE"):
                m.d.comb += [
                    u_ns_gate.ns_gate_start.eq(1),
                    u_ns_gate.gt_word0.eq(result_view.word0_gt.as_value()),
                ]
                m.next = "WAIT_GATE"

            with m.State("WAIT_GATE"):
                with m.If(u_ns_gate.ns_gate_fault):
                    m.d.sync += fault_type_reg.eq(u_ns_gate.ns_gate_fault_type)
                    m.next = "FAULT"
                with m.Elif(u_ns_gate.ns_gate_done):
                    m.d.sync += [
                        result_view.word1_location.eq(u_ns_gate.raw_base),
                        result_view.word2_w2.eq(u_ns_gate.raw_w2),
                    ]
                    if self.enable_seal_check:
                        m.d.sync += ns_w1_saved.eq(u_ns_gate.raw_w2)
                        m.next = "RESET_GBIT"
                    else:
                        m.next = "UPDATE_THREAD"

            if self.enable_seal_check:
                with m.State("RESET_GBIT"):
                    gbit_cleared_w1 = Signal(32)
                    m.d.comb += gbit_cleared_w1.eq(ns_w1_saved & ~(1 << 30))
                    m.d.comb += [
                        local_mem_addr.eq(u_ns_gate.ns_entry_addr_out + 4),
                        local_mem_wr_en.eq(1),
                        local_mem_wr_data.eq(gbit_cleared_w1),
                        self.gbit_reset_done.eq(1),
                    ]
                    m.next = "UPDATE_THREAD"

            with m.State("UPDATE_THREAD"):
                with m.If(cr_dst_reg <= 7):
                    m.d.comb += [
                        self.thread_wr_en.eq(1),
                        self.thread_wr_idx.eq(cr_dst_reg),
                        self.thread_wr_data.eq(result_view.word0_gt),
                    ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.d.comb += [
                    self.cr_wr_addr.eq(cr_dst_reg),
                    self.cr_wr_data.eq(result_cap),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

            with m.State("TRIGGER_OUTFORM"):
                # outform_start_out pulses combinatorially this cycle; go wait.
                m.next = "WAIT_OUTFORM"

            with m.State("WAIT_OUTFORM"):
                with m.If(self.outform_fault_in):
                    # Propagate the specific outform fault code so the fault
                    # register shows CRC/alloc/mint/hdr rather than the generic
                    # ABSENT_OUTFORM sentinel.  ABSENT_OUTFORM is used only when
                    # mLoad detects the absent GT itself (before the outform unit
                    # is started).
                    m.d.sync += fault_type_reg.eq(self.outform_fault_type_in)
                    m.next = "FAULT"
                with m.Elif(self.outform_done_in):
                    # Mint has installed the lump and patched the c-list slot.
                    # Re-read the c-list slot — now it contains an Inform GT.
                    m.next = "FETCH_GT"

        m.d.comb += [
            self.sub_busy.eq(~fsm.ongoing("IDLE")),
            self.sub_done.eq(fsm.ongoing("COMPLETE")),
            self.sub_fault.eq(fsm.ongoing("FAULT")),
            self.sub_fault_type.eq(fault_type_reg),
            self.outform_start_out.eq(fsm.ongoing("TRIGGER_OUTFORM")),
            self.outform_gt_raw.eq(outform_gt_raw_reg),
            self.outform_slot_id.eq(outform_slot_id_reg),
            self.outform_clist_addr.eq(outform_clist_addr_reg),
            self.ns_abstract_gt.eq(Mux(m_elevated_reg, u_ns_gate.ns_abstract_gt, 0)),
        ]

        return m
