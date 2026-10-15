from amaranth import *

from .hw_types import FaultType

OUTFORM_FAULT_CRC32   = FaultType.OUTFORM_CRC
OUTFORM_FAULT_ALLOC   = FaultType.OUTFORM_ALLOC
OUTFORM_FAULT_MINT    = FaultType.OUTFORM_MINT
OUTFORM_FAULT_HDR     = FaultType.OUTFORM_HDR
OUTFORM_FAULT_TIMEOUT = FaultType.OUTFORM_TIMEOUT

DEFAULT_TIMEOUT_CYCLES = 1_000_000

CRC32_POLY  = 0xEDB88320
CRC32_INIT  = 0xFFFFFFFF
CRC32_FINAL = 0xFFFFFFFF

TUNNEL_REQ_LEN = 6
IOT_HDR_LEN    = 8


class ChurchOutformIoT(Elaboratable):
    """Lean tunnel-hunting Outform for IoT profile.

    FSM: IDLE -> TUNNEL_HUNT -> TUNNEL_CONNECT -> RECV_HDR_LEAN ->
         RECV_PAYLOAD -> CHECK_CRC32 -> MINT -> MINT_WAIT -> COMPLETE / FAULT

    Replaces the full ChurchOutform by removing all ZIP backward-compatibility
    overhead (signature check, flag parsing, filename/extra field skipping,
    DEFLATE/RLE stubs).  Uses a minimal 8-byte header (4B payload_len + 4B CRC-32)
    and raw STORE-only payload.  CRC-32 integrity validation is preserved.
    """

    def __init__(self, timeout_cycles=DEFAULT_TIMEOUT_CYCLES):
        self._timeout_cycles    = timeout_cycles
        self.outform_start      = Signal()
        self.outform_busy       = Signal()
        self.outform_done       = Signal()
        self.outform_fault      = Signal()
        self.outform_fault_type = Signal(5)

        self.gt_raw  = Signal(32)
        self.slot_id = Signal(16)

        self.tx_valid = Signal()
        self.tx_data  = Signal(8)
        self.tx_ack   = Signal()
        self.rx_valid = Signal()
        self.rx_data  = Signal(8)

        self.alloc_req   = Signal()
        self.alloc_n     = Signal(5)
        self.alloc_done  = Signal()
        self.alloc_fault = Signal()
        self.alloc_base  = Signal(32)

        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en   = Signal()

        self.mint_call      = Signal()
        self.mint_base      = Signal(32)
        self.mint_n         = Signal(5)
        self.mint_done      = Signal()
        self.mint_fault     = Signal()
        self.mint_result_gt = Signal(32)

        self.result_gt = Signal(32)

    @staticmethod
    def _crc32_byte(m, crc_in, byte_in, crc_out):
        stage = crc_in
        for i in range(8):
            xb  = Signal(name=f"_iot_cxb{i}")
            nxt = Signal(32, name=f"_iot_cs{i}")
            m.d.comb += xb.eq(stage[0] ^ byte_in[i])
            m.d.comb += nxt.eq((stage >> 1) ^ Mux(xb, CRC32_POLY, 0))
            stage = nxt
        m.d.comb += crc_out.eq(stage)

    def elaborate(self, platform):
        m = Module()

        tx_byte_cnt  = Signal(3)
        hdr_byte_cnt = Signal(4)

        timeout_cnt    = Signal(32)
        timeout_limit  = self._timeout_cycles

        payload_len_reg = Signal(32)
        crc32_stored    = Signal(32)

        word_count_reg = Signal(32)
        n_reg          = Signal(5)
        total_words    = Signal(32)

        base_reg       = Signal(32)
        wr_word_cnt    = Signal(32)
        byte_buf       = Signal(24)
        byte_buf_cnt   = Signal(2)

        crc_acc        = Signal(32, init=CRC32_INIT)
        crc_next       = Signal(32)
        result_gt_reg  = Signal(32)

        self._crc32_byte(m, crc_acc, self.rx_data, crc_next)

        tx_byte = Signal(8)
        with m.Switch(tx_byte_cnt):
            with m.Case(0): m.d.comb += tx_byte.eq(self.gt_raw[ 0: 8])
            with m.Case(1): m.d.comb += tx_byte.eq(self.gt_raw[ 8:16])
            with m.Case(2): m.d.comb += tx_byte.eq(self.gt_raw[16:24])
            with m.Case(3): m.d.comb += tx_byte.eq(self.gt_raw[24:32])
            with m.Case(4): m.d.comb += tx_byte.eq(self.slot_id[0:8])
            with m.Case(5): m.d.comb += tx_byte.eq(self.slot_id[8:16])
            with m.Default(): m.d.comb += tx_byte.eq(0)

        inflate_word = Signal(32)
        m.d.comb += inflate_word.eq(Cat(byte_buf, self.rx_data))

        m.d.comb += [
            self.tx_data.eq(tx_byte),
            self.mint_base.eq(base_reg),
            self.mint_n.eq(n_reg),
            self.result_gt.eq(result_gt_reg),
        ]

        with m.FSM(name="outform_iot"):

            with m.State("IDLE"):
                m.d.comb += self.outform_busy.eq(0)
                with m.If(self.outform_start):
                    m.d.sync += [
                        tx_byte_cnt    .eq(0),
                        hdr_byte_cnt   .eq(0),
                        payload_len_reg.eq(0),
                        crc32_stored   .eq(0),
                        word_count_reg .eq(0),
                        n_reg          .eq(0),
                        total_words    .eq(0),
                        crc_acc        .eq(CRC32_INIT),
                        wr_word_cnt    .eq(0),
                        byte_buf       .eq(0),
                        byte_buf_cnt   .eq(0),
                        result_gt_reg  .eq(0),
                        timeout_cnt    .eq(0),
                    ]
                    m.next = "TUNNEL_HUNT"

            with m.State("TUNNEL_HUNT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.tx_valid.eq(1),
                ]
                with m.If(self.tx_ack):
                    with m.If(tx_byte_cnt == TUNNEL_REQ_LEN - 1):
                        m.d.sync += [
                            tx_byte_cnt.eq(0),
                            timeout_cnt.eq(0),
                        ]
                        m.next = "TUNNEL_CONNECT"
                    with m.Else():
                        m.d.sync += tx_byte_cnt.eq(tx_byte_cnt + 1)

            with m.State("TUNNEL_CONNECT"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.rx_valid):
                    m.d.sync += timeout_cnt.eq(0)
                    m.next = "RECV_HDR_LEAN"
                with m.Elif(timeout_cnt + 1 >= timeout_limit):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_TIMEOUT)
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += timeout_cnt.eq(timeout_cnt + 1)

            with m.State("RECV_HDR_LEAN"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.rx_valid):
                    m.d.sync += timeout_cnt.eq(0)
                    with m.Switch(hdr_byte_cnt):
                        with m.Case(0): m.d.sync += payload_len_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(1): m.d.sync += payload_len_reg[ 8:16].eq(self.rx_data)
                        with m.Case(2): m.d.sync += payload_len_reg[16:24].eq(self.rx_data)
                        with m.Case(3): m.d.sync += payload_len_reg[24:32].eq(self.rx_data)
                        with m.Case(4): m.d.sync += crc32_stored[ 0: 8].eq(self.rx_data)
                        with m.Case(5): m.d.sync += crc32_stored[ 8:16].eq(self.rx_data)
                        with m.Case(6): m.d.sync += crc32_stored[16:24].eq(self.rx_data)
                        with m.Case(7): m.d.sync += crc32_stored[24:32].eq(self.rx_data)
                    m.d.sync += hdr_byte_cnt.eq(hdr_byte_cnt + 1)
                    with m.If(hdr_byte_cnt == IOT_HDR_LEN - 1):
                        m.next = "DERIVE_N"
                with m.Elif(timeout_cnt + 1 >= timeout_limit):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_TIMEOUT)
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += timeout_cnt.eq(timeout_cnt + 1)

            with m.State("DERIVE_N"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(payload_len_reg[0:2] != 0):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_HDR)
                    m.next = "FAULT"
                with m.Else():
                    wc = Signal(32, name="iot_wc")
                    m.d.comb += wc.eq(payload_len_reg >> 2)

                    is_pow2 = Signal()
                    m.d.comb += is_pow2.eq(
                        (wc != 0) & ((wc & (wc - 1)) == 0)
                    )

                    n_computed = Signal(5)
                    with m.Switch(wc):
                        for bit in range(6, 15):
                            with m.Case(1 << bit):
                                m.d.comb += n_computed.eq(bit)
                        with m.Default():
                            m.d.comb += n_computed.eq(0)

                    with m.If(~is_pow2 | (n_computed < 6) | (n_computed > 14)):
                        m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_HDR)
                        m.next = "FAULT"
                    with m.Else():
                        m.d.sync += [
                            n_reg.eq(n_computed),
                            total_words.eq(wc),
                            word_count_reg.eq(wc),
                        ]
                        m.next = "ALLOC"

            with m.State("ALLOC"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.alloc_req.eq(1),
                    self.alloc_n.eq(n_reg),
                ]
                with m.If(self.alloc_fault):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_ALLOC)
                    m.next = "FAULT"
                with m.Elif(self.alloc_done):
                    m.d.sync += [
                        base_reg    .eq(self.alloc_base),
                        wr_word_cnt .eq(0),
                        byte_buf_cnt.eq(0),
                        byte_buf    .eq(0),
                        crc_acc     .eq(CRC32_INIT),
                    ]
                    m.next = "RECV_PAYLOAD"

            with m.State("RECV_PAYLOAD"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.rx_valid):
                    m.d.sync += [
                        crc_acc    .eq(crc_next),
                        timeout_cnt.eq(0),
                    ]
                    with m.If(byte_buf_cnt == 3):
                        m.d.comb += [
                            self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                            self.mem_wr_data.eq(inflate_word),
                            self.mem_wr_en  .eq(1),
                        ]
                        m.d.sync += [
                            wr_word_cnt .eq(wr_word_cnt + 1),
                            byte_buf_cnt.eq(0),
                            byte_buf    .eq(0),
                        ]
                        with m.If(wr_word_cnt + 1 == total_words):
                            m.next = "CHECK_CRC32"
                    with m.Else():
                        with m.Switch(byte_buf_cnt):
                            with m.Case(0): m.d.sync += byte_buf[ 0: 8].eq(self.rx_data)
                            with m.Case(1): m.d.sync += byte_buf[ 8:16].eq(self.rx_data)
                            with m.Case(2): m.d.sync += byte_buf[16:24].eq(self.rx_data)
                        m.d.sync += byte_buf_cnt.eq(byte_buf_cnt + 1)
                with m.Elif(timeout_cnt + 1 >= timeout_limit):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_TIMEOUT)
                    m.next = "SCRUB"
                with m.Else():
                    m.d.sync += timeout_cnt.eq(timeout_cnt + 1)

            with m.State("SCRUB"):
                # Zero-fill the remaining (unwritten) words in the allocated
                # region before faulting so no stale data is ever visible.
                m.d.comb += self.outform_busy.eq(1)
                with m.If(wr_word_cnt < total_words):
                    m.d.comb += [
                        self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                        self.mem_wr_data.eq(0),
                        self.mem_wr_en  .eq(1),
                    ]
                    m.d.sync += wr_word_cnt.eq(wr_word_cnt + 1)
                with m.Else():
                    m.next = "FAULT"

            with m.State("CHECK_CRC32"):
                m.d.comb += self.outform_busy.eq(1)
                crc_final = Signal(32)
                m.d.comb += crc_final.eq(crc_acc ^ CRC32_FINAL)
                with m.If(crc_final != crc32_stored):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_CRC32)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "MINT"

            with m.State("MINT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.mint_call.eq(1),
                ]
                m.next = "MINT_WAIT"

            with m.State("MINT_WAIT"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.mint_fault):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_MINT)
                    m.next = "FAULT"
                with m.Elif(self.mint_done):
                    m.d.sync += result_gt_reg.eq(self.mint_result_gt)
                    m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.d.comb += [
                    self.outform_busy.eq(0),
                    self.outform_done.eq(1),
                ]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += [
                    self.outform_busy.eq(0),
                    self.outform_fault.eq(1),
                ]
                m.next = "IDLE"

        return m
