from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, WORD3_LAYOUT


class ChurchMSave(Elaboratable):
    def __init__(self, enable_seal_check=None):
        self.enable_seal_check = enable_seal_check if enable_seal_check is not None else ENABLE_SEAL_CHECK

        self.sub_start = Signal()
        self.sub_dst_cap = Signal(CAP_REG_LAYOUT)
        self.sub_src_gt = Signal(32)
        self.sub_index = Signal(16)
        self.sub_busy = Signal()
        self.sub_done = Signal()
        self.sub_fault = Signal()
        self.sub_fault_type = Signal(4)

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()
        self.mem_wr_done = Signal()

        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        dst_cap_reg = Signal(CAP_REG_LAYOUT)
        src_gt_reg = Signal(32)
        index_reg = Signal(16)
        fault_type_reg = Signal(4)

        dst_view = View(CAP_REG_LAYOUT, dst_cap_reg)
        dst_gt = View(GT_LAYOUT, dst_view.word0_gt)
        dst_w2 = View(WORD2_LAYOUT, dst_view.word2_w2)
        src_gt_view = View(GT_LAYOUT, src_gt_reg)

        ns_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

        dst_has_s_perm = dst_gt.perms[PERM_S]
        dst_has_bind = dst_gt.b_flag
        index_in_bounds = Signal()
        m.d.comb += index_in_bounds.eq(index_reg < dst_w2.limit_offset[:16])

        write_addr = Signal(32)
        m.d.comb += write_addr.eq(dst_view.word1_location + (index_reg << 2))

        ns_ns_w2 = View(WORD2_LAYOUT, ns_view.word2_w2)
        ns_entry_addr = Signal(32)
        m.d.comb += ns_entry_addr.eq(ns_view.word1_location + (src_gt_view.slot_id * 12))

        ns_location_reg = Signal(32)
        ns_w2_reg = Signal(32)
        ns_w2_view = View(WORD2_LAYOUT, ns_w2_reg)

        if self.enable_seal_check:
            ns_w3_reg = Signal(32)
            ns_w3_view = View(WORD3_LAYOUT, ns_w3_reg)

            gt_seq_match = Signal()
            m.d.comb += gt_seq_match.eq(src_gt_view.gt_seq == ns_w2_view.gt_seq)

            crc_stages = [Signal(16, name=f"crc16_{i}") for i in range(90)]
            m.d.comb += crc_stages[0].eq(0xFFFF)
            for i in range(89):
                if i < 25:
                    data_bit = src_gt_reg[24 - i]
                elif i < 57:
                    data_bit = ns_location_reg[56 - i]
                else:
                    data_bit = ns_w2_reg[88 - i]
                top_bit = Signal(name=f"crc16_top_{i}")
                shifted = Signal(16, name=f"crc16_sh_{i}")
                m.d.comb += top_bit.eq(crc_stages[i][15] ^ data_bit)
                m.d.comb += shifted.eq(Cat(Const(0, 1), crc_stages[i][:15]))
                m.d.comb += crc_stages[i + 1].eq(shifted ^ Mux(top_bit, 0x1021, 0))
            crc16_result = Signal(16, name="crc16_result")
            m.d.comb += crc16_result.eq(crc_stages[89])
            seal_ok = Signal()
            m.d.comb += seal_ok.eq(crc16_result == ns_w3_view.crc)

        with m.FSM(name="msave") as fsm:
            with m.State("IDLE"):
                with m.If(self.sub_start):
                    m.d.sync += [
                        dst_cap_reg.eq(self.sub_dst_cap),
                        src_gt_reg.eq(self.sub_src_gt),
                        index_reg.eq(self.sub_index),
                        fault_type_reg.eq(FaultType.NONE),
                    ]
                    m.next = "CHECK_BIND"

            with m.State("CHECK_BIND"):
                with m.If(~dst_has_bind):
                    m.d.sync += fault_type_reg.eq(FaultType.BIND)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_S"

            with m.State("CHECK_S"):
                with m.If(~dst_has_s_perm):
                    m.d.sync += fault_type_reg.eq(FaultType.PERM_S)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_BOUNDS"

            with m.State("CHECK_BOUNDS"):
                with m.If(~index_in_bounds):
                    m.d.sync += fault_type_reg.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "FETCH_NS_LOC"

            with m.State("FETCH_NS_LOC"):
                m.d.comb += [
                    self.mem_rd_addr.eq(ns_entry_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_location_reg.eq(self.mem_rd_data)
                    m.next = "FETCH_NS_W2"

            with m.State("FETCH_NS_W2"):
                # word1_w2 is at NS entry offset +4 (limit_offset | gt_seq)
                m.d.comb += [
                    self.mem_rd_addr.eq(ns_entry_addr + 4),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_w2_reg.eq(self.mem_rd_data)
                    if self.enable_seal_check:
                        m.next = "FETCH_NS_W3"
                    else:
                        m.next = "WRITE_GT"

            if self.enable_seal_check:
                with m.State("FETCH_NS_W3"):
                    # word2_w3 is at NS entry offset +8 (crc | g_bit)
                    m.d.comb += [
                        self.mem_rd_addr.eq(ns_entry_addr + 8),
                        self.mem_rd_en.eq(1),
                    ]
                    with m.If(self.mem_rd_valid):
                        m.d.sync += ns_w3_reg.eq(self.mem_rd_data)
                        m.next = "CHECK_VERSION"

                with m.State("CHECK_VERSION"):
                    with m.If(~gt_seq_match):
                        m.d.sync += fault_type_reg.eq(FaultType.VERSION)
                        m.next = "FAULT"
                    with m.Elif(~seal_ok):
                        m.d.sync += fault_type_reg.eq(FaultType.SEAL)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "WRITE_GT"

            with m.State("WRITE_GT"):
                m.d.comb += [
                    self.mem_wr_en.eq(1),
                    self.mem_wr_addr.eq(write_addr),
                    self.mem_wr_data.eq(src_gt_reg),
                ]
                with m.If(self.mem_wr_done):
                    m.next = "COMPLETE"

            with m.State("COMPLETE"):
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
