from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, NS_ENTRY_LAYOUT, WORD2_LAYOUT, WORD3_LAYOUT, LUMP_HEADER_LAYOUT


class ChurchMLoad(Elaboratable):
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
        self.sub_fault_type = Signal(4)

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

    def elaborate(self, platform):
        m = Module()

        cr_src_reg = Signal(4)
        cr_dst_reg = Signal(4)
        index_reg = Signal(16)
        direct_mode = Signal()
        direct_gt_reg = Signal(32)
        src_cap = Signal(CAP_REG_LAYOUT)
        result_cap = Signal(CAP_REG_LAYOUT)
        fault_type_reg = Signal(4)

        src_view = View(CAP_REG_LAYOUT, src_cap)
        result_view = View(CAP_REG_LAYOUT, result_cap)
        ns_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

        src_gt = View(GT_LAYOUT, src_view.word0_gt)
        result_gt = View(GT_LAYOUT, result_view.word0_gt)

        has_l_perm = src_gt.perms[PERM_L]
        src_is_null = Signal()
        m.d.comb += src_is_null.eq(src_gt.gt_type == GT_TYPE_NULL)

        bounds_ok = Signal()
        ns_w2 = View(WORD2_LAYOUT, src_view.word2_w2)
        m.d.comb += bounds_ok.eq(index_reg < ns_w2.limit_offset[:16])

        clist_gt_addr = Signal(32)
        m.d.comb += clist_gt_addr.eq(src_view.word1_location + (index_reg << 2))

        ns_entry_addr = Signal(32)
        ns_ns_w2 = View(WORD2_LAYOUT, ns_view.word2_w2)
        m.d.comb += ns_entry_addr.eq(ns_view.word1_location + (result_gt.slot_id * 12))

        ns_index_in_bounds = Signal()
        m.d.comb += ns_index_in_bounds.eq(result_gt.slot_id < ns_ns_w2.limit_offset[:16])

        ns_w3_saved = Signal(32)

        if self.enable_seal_check:
            result_w2 = View(WORD2_LAYOUT, result_view.word2_w2)
            result_w3 = View(WORD3_LAYOUT, result_view.word3_w3)

            gt_seq_match = Signal()
            m.d.comb += gt_seq_match.eq(result_gt.gt_seq == result_w2.gt_seq)

            crc_stages = [Signal(16, name=f"crc16_{i}") for i in range(90)]
            m.d.comb += crc_stages[0].eq(0xFFFF)
            for i in range(89):
                if i < 25:
                    data_bit = result_view.word0_gt.as_value()[24 - i]
                elif i < 57:
                    data_bit = result_view.word1_location[56 - i]
                else:
                    data_bit = result_view.word2_w2[88 - i]
                top_bit = Signal(name=f"crc16_top_{i}")
                shifted = Signal(16, name=f"crc16_sh_{i}")
                m.d.comb += top_bit.eq(crc_stages[i][15] ^ data_bit)
                m.d.comb += shifted.eq(Cat(Const(0, 1), crc_stages[i][:15]))
                m.d.comb += crc_stages[i + 1].eq(shifted ^ Mux(top_bit, 0x1021, 0))
            crc16_result = Signal(16, name="crc16_result")
            m.d.comb += crc16_result.eq(crc_stages[89])
            seal_ok = Signal()
            m.d.comb += seal_ok.eq(crc16_result == result_w3.crc)

        with m.FSM(name="mload") as fsm:
            with m.State("IDLE"):
                with m.If(self.sub_start):
                    m.d.sync += [
                        cr_src_reg.eq(self.sub_cr_src),
                        cr_dst_reg.eq(self.sub_cr_dst),
                        index_reg.eq(self.sub_index),
                        direct_mode.eq(self.sub_direct),
                        direct_gt_reg.eq(self.sub_direct_gt),
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
                    self.mem_addr.eq(clist_gt_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += result_view.word0_gt.eq(self.mem_rd_data)
                    m.next = "CHECK_NS"

            with m.State("CHECK_NS"):
                with m.If(~ns_index_in_bounds):
                    m.d.sync += fault_type_reg.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "FETCH_LOC"

            with m.State("FETCH_LOC"):
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += result_view.word1_location.eq(self.mem_rd_data)
                    m.next = "FETCH_W2"

            with m.State("FETCH_W2"):
                # word1_w2 is at NS entry offset +4 (limit_offset | gt_seq)
                m.d.comb += [
                    self.mem_addr.eq(ns_entry_addr + 4),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += result_view.word2_w2.eq(self.mem_rd_data)
                    if self.enable_seal_check:
                        m.next = "FETCH_W3"
                    else:
                        m.next = "UPDATE_THREAD"

            if self.enable_seal_check:
                with m.State("FETCH_W3"):
                    # word2_w3 is at NS entry offset +8 (crc | g_bit)
                    m.d.comb += [
                        self.mem_addr.eq(ns_entry_addr + 8),
                        self.mem_rd_en.eq(1),
                    ]
                    with m.If(self.mem_rd_valid):
                        m.d.sync += [
                            result_view.word3_w3.eq(self.mem_rd_data),
                            ns_w3_saved.eq(self.mem_rd_data),
                        ]
                        m.next = "CHECK_VERSION"

                with m.State("CHECK_VERSION"):
                    with m.If(~gt_seq_match):
                        m.d.sync += fault_type_reg.eq(FaultType.VERSION)
                        m.next = "FAULT"
                    with m.Elif(~seal_ok):
                        m.d.sync += fault_type_reg.eq(FaultType.SEAL)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "RESET_GBIT"

                with m.State("RESET_GBIT"):
                    gbit_cleared_w3 = Signal(32)
                    gbit_cleared_view = View(WORD3_LAYOUT, gbit_cleared_w3)
                    ns_w3_view = View(WORD3_LAYOUT, ns_w3_saved)
                    m.d.comb += [
                        gbit_cleared_view.crc.eq(ns_w3_view.crc),
                        gbit_cleared_view.g_bit.eq(0),
                        gbit_cleared_view.spare.eq(ns_w3_view.spare),
                    ]
                    m.d.comb += [
                        self.mem_addr.eq(ns_entry_addr + 8),
                        self.mem_wr_en.eq(1),
                        self.mem_wr_data.eq(gbit_cleared_w3),
                        self.ns_entry_addr_out.eq(ns_entry_addr),
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

        m.d.comb += [
            self.sub_busy.eq(~fsm.ongoing("IDLE")),
            self.sub_done.eq(fsm.ongoing("COMPLETE")),
            self.sub_fault.eq(fsm.ongoing("FAULT")),
            self.sub_fault_type.eq(fault_type_reg),
        ]

        return m
