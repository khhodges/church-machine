from amaranth import *

# Outform-specific fault codes (extend the 5-bit FaultType space 0x11..0x17)
OUTFORM_FAULT_SIG    = 0x11
OUTFORM_FAULT_FLAGS  = 0x12
OUTFORM_FAULT_METHOD = 0x13
OUTFORM_FAULT_N      = 0x14
OUTFORM_FAULT_CRC32  = 0x15
OUTFORM_FAULT_ALLOC  = 0x16
OUTFORM_FAULT_MINT   = 0x17

# ZIP Local File Header constants
ZIP_SIGNATURE  = 0x04034B50
METHOD_STORE   = 0
METHOD_DEFLATE = 8
ZIP_HDR_LEN    = 30       # fixed region bytes

# CRC-32 (IEEE 802.3, reflected poly 0xEDB88320)
CRC32_POLY  = 0xEDB88320
CRC32_INIT  = 0xFFFFFFFF
CRC32_FINAL = 0xFFFFFFFF

TUNNEL_REQ_LEN = 6        # gt_raw[31:0] LE + slot_id[15:0] LE


class ChurchOutform(Elaboratable):
    """Lazy-load handler for Absent Outform NS entries (typ=11).

    FSM: IDLE -> TUNNEL_CONNECT -> RECV_HDR -> CHECK_SIG -> CHECK_FLAGS ->
         READ_UCSIZE -> DERIVE_N -> ALLOC -> SKIP_FNAME -> SKIP_EXTRA ->
         INFLATE -> CHECK_CRC32 -> MINT -> MINT_WAIT -> COMPLETE / FAULT
    """

    def __init__(self):
        # trigger / status
        self.outform_start      = Signal()
        self.outform_busy       = Signal()
        self.outform_done       = Signal()
        self.outform_fault      = Signal()
        self.outform_fault_type = Signal(5)

        # absent outform identity
        self.gt_raw  = Signal(32)
        self.slot_id = Signal(16)

        # tunnel byte stream
        self.tx_valid = Signal()
        self.tx_data  = Signal(8)
        self.rx_valid = Signal()
        self.rx_data  = Signal(8)

        # memory allocator
        self.alloc_req   = Signal()
        self.alloc_n     = Signal(5)
        self.alloc_done  = Signal()
        self.alloc_fault = Signal()
        self.alloc_base  = Signal(32)

        # memory write (inflate destination)
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en   = Signal()

        # Mint.Lump interface
        self.mint_call      = Signal()
        self.mint_base      = Signal(32)
        self.mint_n         = Signal(5)
        self.mint_done      = Signal()
        self.mint_fault     = Signal()
        self.mint_result_gt = Signal(32)

        # result (valid when outform_done)
        self.result_gt = Signal(32)

    @staticmethod
    def _crc32_byte(m, crc_in, byte_in, crc_out):
        """8-stage combinatorial CRC-32 update (IEEE 802.3, LSB-first)."""
        stage = crc_in
        for i in range(8):
            xb  = Signal(name=f"_cxb{i}")
            nxt = Signal(32, name=f"_cs{i}")
            m.d.comb += xb.eq(stage[0] ^ byte_in[i])
            m.d.comb += nxt.eq((stage >> 1) ^ Mux(xb, CRC32_POLY, 0))
            stage = nxt
        m.d.comb += crc_out.eq(stage)

    def elaborate(self, platform):
        m = Module()

        hdr_byte_cnt = Signal(5)
        tx_byte_cnt  = Signal(3)
        fname_cnt    = Signal(16)
        extra_cnt    = Signal(16)

        sig_reg        = Signal(32)
        flags_reg      = Signal(16)
        method_reg     = Signal(16)
        crc32_stored   = Signal(32)
        comp_size_reg  = Signal(32)
        ucomp_size_reg = Signal(32)
        fname_len_reg  = Signal(16)
        extra_len_reg  = Signal(16)

        word_count_reg = Signal(32)
        n_reg          = Signal(5)
        total_words    = Signal(32)

        base_reg       = Signal(32)
        wr_word_cnt    = Signal(32)
        byte_buf       = Signal(24)   # holds bytes 0..2 of the current inflate word
        byte_buf_cnt   = Signal(2)

        crc_acc        = Signal(32, init=CRC32_INIT)
        crc_next       = Signal(32)
        result_gt_reg  = Signal(32)

        self._crc32_byte(m, crc_acc, self.rx_data, crc_next)

        # tunnel TX byte mux
        tx_byte = Signal(8)
        with m.Switch(tx_byte_cnt):
            with m.Case(0): m.d.comb += tx_byte.eq(self.gt_raw[ 0: 8])
            with m.Case(1): m.d.comb += tx_byte.eq(self.gt_raw[ 8:16])
            with m.Case(2): m.d.comb += tx_byte.eq(self.gt_raw[16:24])
            with m.Case(3): m.d.comb += tx_byte.eq(self.gt_raw[24:32])
            with m.Case(4): m.d.comb += tx_byte.eq(self.slot_id[0:8])
            with m.Case(5): m.d.comb += tx_byte.eq(self.slot_id[8:16])
            with m.Default(): m.d.comb += tx_byte.eq(0)

        # complete 32-bit word for STORE write: bytes 0-2 from byte_buf, byte 3 from rx_data
        inflate_word = Signal(32)
        m.d.comb += inflate_word.eq(Cat(byte_buf, self.rx_data))

        m.d.comb += [
            self.tx_data.eq(tx_byte),
            self.mint_base.eq(base_reg),
            self.mint_n.eq(n_reg),
            self.result_gt.eq(result_gt_reg),
        ]

        with m.FSM(name="outform"):

            with m.State("IDLE"):
                m.d.comb += self.outform_busy.eq(0)
                with m.If(self.outform_start):
                    m.d.sync += [
                        hdr_byte_cnt  .eq(0),
                        tx_byte_cnt   .eq(0),
                        fname_cnt     .eq(0),
                        extra_cnt     .eq(0),
                        sig_reg       .eq(0),
                        flags_reg     .eq(0),
                        method_reg    .eq(0),
                        crc32_stored  .eq(0),
                        comp_size_reg .eq(0),
                        ucomp_size_reg.eq(0),
                        fname_len_reg .eq(0),
                        extra_len_reg .eq(0),
                        word_count_reg.eq(0),
                        n_reg         .eq(0),
                        total_words   .eq(0),
                        crc_acc       .eq(CRC32_INIT),
                        wr_word_cnt   .eq(0),
                        byte_buf      .eq(0),
                        byte_buf_cnt  .eq(0),
                        result_gt_reg .eq(0),
                    ]
                    m.next = "TUNNEL_CONNECT"

            with m.State("TUNNEL_CONNECT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.tx_valid.eq(1),
                ]
                with m.If(tx_byte_cnt == TUNNEL_REQ_LEN - 1):
                    m.d.sync += tx_byte_cnt.eq(0)
                    m.next = "RECV_HDR"
                with m.Else():
                    m.d.sync += tx_byte_cnt.eq(tx_byte_cnt + 1)

            with m.State("RECV_HDR"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.rx_valid):
                    with m.Switch(hdr_byte_cnt):
                        with m.Case( 0): m.d.sync += sig_reg[ 0: 8].eq(self.rx_data)
                        with m.Case( 1): m.d.sync += sig_reg[ 8:16].eq(self.rx_data)
                        with m.Case( 2): m.d.sync += sig_reg[16:24].eq(self.rx_data)
                        with m.Case( 3): m.d.sync += sig_reg[24:32].eq(self.rx_data)
                        with m.Case( 6): m.d.sync += flags_reg[ 0: 8].eq(self.rx_data)
                        with m.Case( 7): m.d.sync += flags_reg[ 8:16].eq(self.rx_data)
                        with m.Case( 8): m.d.sync += method_reg[ 0: 8].eq(self.rx_data)
                        with m.Case( 9): m.d.sync += method_reg[ 8:16].eq(self.rx_data)
                        with m.Case(14): m.d.sync += crc32_stored[ 0: 8].eq(self.rx_data)
                        with m.Case(15): m.d.sync += crc32_stored[ 8:16].eq(self.rx_data)
                        with m.Case(16): m.d.sync += crc32_stored[16:24].eq(self.rx_data)
                        with m.Case(17): m.d.sync += crc32_stored[24:32].eq(self.rx_data)
                        with m.Case(18): m.d.sync += comp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(19): m.d.sync += comp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(20): m.d.sync += comp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(21): m.d.sync += comp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(22): m.d.sync += ucomp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(23): m.d.sync += ucomp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(24): m.d.sync += ucomp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(25): m.d.sync += ucomp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(26): m.d.sync += fname_len_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(27): m.d.sync += fname_len_reg[ 8:16].eq(self.rx_data)
                        with m.Case(28): m.d.sync += extra_len_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(29): m.d.sync += extra_len_reg[ 8:16].eq(self.rx_data)
                    m.d.sync += hdr_byte_cnt.eq(hdr_byte_cnt + 1)
                    with m.If(hdr_byte_cnt == ZIP_HDR_LEN - 1):
                        m.next = "CHECK_SIG"

            with m.State("CHECK_SIG"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(sig_reg != ZIP_SIGNATURE):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_SIG)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_FLAGS"

            with m.State("CHECK_FLAGS"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(flags_reg[3]):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_FLAGS)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_UCSIZE"

            with m.State("READ_UCSIZE"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(ucomp_size_reg[0:2] != 0):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_N)
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += word_count_reg.eq(ucomp_size_reg >> 2)
                    m.next = "DERIVE_N"

            with m.State("DERIVE_N"):
                m.d.comb += self.outform_busy.eq(1)
                is_pow2 = Signal()
                m.d.comb += is_pow2.eq(
                    (word_count_reg != 0) &
                    ((word_count_reg & (word_count_reg - 1)) == 0)
                )
                n_computed = Signal(5)
                with m.Switch(word_count_reg):
                    for bit in range(6, 15):        # 2^6=64 .. 2^14=16384
                        with m.Case(1 << bit):
                            m.d.comb += n_computed.eq(bit)
                    with m.Default():
                        m.d.comb += n_computed.eq(0)
                with m.If(~is_pow2 | (n_computed < 6) | (n_computed > 14)):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_N)
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += [
                        n_reg.eq(n_computed),
                        total_words.eq(word_count_reg),
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
                        fname_cnt   .eq(fname_len_reg),
                    ]
                    m.next = "SKIP_FNAME"

            # L-counter: independent Signal(16), never referenced in E arithmetic
            with m.State("SKIP_FNAME"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(fname_cnt == 0):
                    m.d.sync += extra_cnt.eq(extra_len_reg)
                    m.next = "SKIP_EXTRA"
                with m.Elif(self.rx_valid):
                    m.d.sync += fname_cnt.eq(fname_cnt - 1)

            # E-counter: independent Signal(16), never referenced in L arithmetic
            with m.State("SKIP_EXTRA"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(extra_cnt == 0):
                    m.next = "INFLATE"
                with m.Elif(self.rx_valid):
                    m.d.sync += extra_cnt.eq(extra_cnt - 1)

            with m.State("INFLATE"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(method_reg == METHOD_STORE):
                    with m.If(self.rx_valid):
                        m.d.sync += crc_acc.eq(crc_next)
                        with m.If(byte_buf_cnt == 3):
                            # build full word from registered bytes 0-2 and incoming byte 3
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
                with m.Elif(method_reg == METHOD_DEFLATE):
                    m.next = "INFLATE_DEFLATE"
                with m.Else():
                    # unrecognised method code
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_METHOD)
                    m.next = "FAULT"

            # TODO: Huffman+LZ77 sub-FSM (separate hardware task)
            with m.State("INFLATE_DEFLATE"):
                m.d.comb += self.outform_busy.eq(1)

            with m.State("CHECK_CRC32"):
                m.d.comb += self.outform_busy.eq(1)
                crc_final = Signal(32)
                m.d.comb += crc_final.eq(crc_acc ^ CRC32_FINAL)
                with m.If(crc_final != crc32_stored):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_CRC32)
                    m.next = "FAULT"
                with m.Else():
                    m.next = "MINT"

            # single-cycle mint_call pulse
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
