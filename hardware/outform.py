from amaranth import *

OUTFORM_FAULT_SIG    = 0x11
OUTFORM_FAULT_FLAGS  = 0x12
OUTFORM_FAULT_METHOD = 0x13
OUTFORM_FAULT_N      = 0x14
OUTFORM_FAULT_CRC32  = 0x15
OUTFORM_FAULT_ALLOC  = 0x16
OUTFORM_FAULT_MINT   = 0x17
OUTFORM_FAULT_DEFL   = 0x18
OUTFORM_FAULT_WIN    = 0x19
OUTFORM_FAULT_RLE    = 0x1A

ZIP_SIGNATURE  = 0x04034B50
METHOD_STORE   = 0
METHOD_DEFLATE = 8
METHOD_RLE     = 16
HDR_LEN        = 32

CRC32_POLY  = 0xEDB88320
CRC32_INIT  = 0xFFFFFFFF
CRC32_FINAL = 0xFFFFFFFF

TUNNEL_REQ_LEN = 6

DEFL_WIN_SIZE = 2048
DEFL_WIN_MASK = DEFL_WIN_SIZE - 1

_LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10,
    11, 13, 15, 17,
    19, 23, 27, 31,
    35, 43, 51, 59,
    67, 83, 99, 115,
    131, 163, 195, 227,
    258,
]

_LEN_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1,
    2, 2, 2, 2,
    3, 3, 3, 3,
    4, 4, 4, 4,
    5, 5, 5, 5,
    0,
]

_DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25,
    33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]

_DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3,
    4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9,
    10, 10, 11, 11, 12, 12, 13, 13,
]


class ChurchOutform(Elaboratable):
    """Lazy-load handler for Absent Outform NS entries (typ=10).

    FSM: IDLE -> TUNNEL_CONNECT -> RECV_HDR -> CHECK_SIG -> CHECK_FLAGS ->
         READ_UCSIZE -> DERIVE_N -> ALLOC -> SKIP_FNAME -> SKIP_EXTRA ->
         INFLATE -> CHECK_CRC32 -> MINT -> MINT_WAIT -> COMPLETE / FAULT

    INFLATE methods:
         METHOD_STORE   (0)  — raw byte copy (inline in INFLATE state)
         METHOD_DEFLATE (8)  — fixed Huffman + LZ77 via DEFL_* sub-FSM
         METHOD_RLE     (16) — byte-pair RLE via RLE_* sub-FSM
    """

    def __init__(self):
        self.outform_start      = Signal()
        self.outform_busy       = Signal()
        self.outform_done       = Signal()
        self.outform_fault      = Signal()
        self.outform_fault_type = Signal(5)

        self.gt_raw  = Signal(32)
        self.slot_id = Signal(16)

        self.tx_valid = Signal()
        self.tx_data  = Signal(8)
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
        """8-stage combinatorial CRC-32 byte update (IEEE 802.3, LSB-first)."""
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

        hdr_byte_cnt = Signal(6)
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
        byte_buf       = Signal(24)
        byte_buf_cnt   = Signal(2)

        result_gt_reg  = Signal(32)

        crc_byte_in = Signal(8, name="crc_byte_in")
        m.d.comb += crc_byte_in.eq(self.rx_data)

        crc_acc  = Signal(32, init=CRC32_INIT)
        crc_next = Signal(32)
        self._crc32_byte(m, crc_acc, crc_byte_in, crc_next)

        win_mem = Memory(width=8, depth=DEFL_WIN_SIZE, init=[])
        m.submodules.win_mem = win_mem
        win_rd = win_mem.read_port(transparent=True)
        win_wr = win_mem.write_port()

        m.d.comb += [
            win_wr.addr.eq(0),
            win_wr.data.eq(0),
            win_wr.en.eq(0),
            win_rd.addr.eq(0),
        ]

        defl_bits      = Signal(32, name="defl_bits")
        defl_bit_cnt   = Signal(6,  name="defl_bit_cnt")
        defl_bfinal    = Signal(    name="defl_bfinal")
        defl_symbol    = Signal(9,  name="defl_symbol")
        defl_copy_len  = Signal(9,  name="defl_copy_len")
        defl_copy_dist = Signal(12, name="defl_copy_dist")
        defl_copy_idx  = Signal(9,  name="defl_copy_idx")
        defl_win_pos   = Signal(11, name="defl_win_pos")
        defl_len_idx   = Signal(5,  name="defl_len_idx")
        defl_dist_code = Signal(5,  name="defl_dist_code")
        defl_rx_count  = Signal(32, name="defl_rx_count")
        defl_bytes_out = Signal(32, name="defl_bytes_out")
        rle_rx_count   = Signal(32, name="rle_rx_count")

        rle_count     = Signal(8, name="rle_count")
        rle_literal   = Signal(8, name="rle_literal")
        rle_remaining = Signal(8, name="rle_remaining")

        len_base_tbl  = Array(_LEN_BASE)
        len_extra_tbl = Array(_LEN_EXTRA)
        dist_base_tbl = Array(_DIST_BASE)
        dist_extra_tbl = Array(_DIST_EXTRA)

        code7_rev = Signal(7,  name="code7_rev")
        code8_rev = Signal(8,  name="code8_rev")
        code9_rev = Signal(9,  name="code9_rev")
        dist5_rev = Signal(5,  name="dist5_rev")
        m.d.comb += [
            code7_rev.eq(Cat(
                defl_bits[6], defl_bits[5], defl_bits[4], defl_bits[3],
                defl_bits[2], defl_bits[1], defl_bits[0])),
            code8_rev.eq(Cat(
                defl_bits[7], defl_bits[6], defl_bits[5], defl_bits[4],
                defl_bits[3], defl_bits[2], defl_bits[1], defl_bits[0])),
            code9_rev.eq(Cat(
                defl_bits[8], defl_bits[7], defl_bits[6], defl_bits[5],
                defl_bits[4], defl_bits[3], defl_bits[2], defl_bits[1], defl_bits[0])),
            dist5_rev.eq(Cat(
                defl_bits[4], defl_bits[3], defl_bits[2], defl_bits[1], defl_bits[0])),
        ]

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
                        defl_bits     .eq(0),
                        defl_bit_cnt  .eq(0),
                        defl_bfinal   .eq(0),
                        defl_symbol   .eq(0),
                        defl_copy_len .eq(0),
                        defl_copy_dist.eq(0),
                        defl_copy_idx .eq(0),
                        defl_win_pos  .eq(0),
                        defl_len_idx  .eq(0),
                        defl_dist_code.eq(0),
                        rle_count     .eq(0),
                        rle_literal   .eq(0),
                        rle_remaining .eq(0),
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
                        with m.Case(16): m.d.sync += crc32_stored[ 0: 8].eq(self.rx_data)
                        with m.Case(17): m.d.sync += crc32_stored[ 8:16].eq(self.rx_data)
                        with m.Case(18): m.d.sync += crc32_stored[16:24].eq(self.rx_data)
                        with m.Case(19): m.d.sync += crc32_stored[24:32].eq(self.rx_data)
                        with m.Case(20): m.d.sync += comp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(21): m.d.sync += comp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(22): m.d.sync += comp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(23): m.d.sync += comp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(24): m.d.sync += ucomp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(25): m.d.sync += ucomp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(26): m.d.sync += ucomp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(27): m.d.sync += ucomp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(28): m.d.sync += fname_len_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(29): m.d.sync += fname_len_reg[ 8:16].eq(self.rx_data)
                        with m.Case(30): m.d.sync += extra_len_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(31): m.d.sync += extra_len_reg[ 8:16].eq(self.rx_data)
                    m.d.sync += hdr_byte_cnt.eq(hdr_byte_cnt + 1)
                    with m.If(hdr_byte_cnt == HDR_LEN - 1):
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
                    for bit in range(6, 15):
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

            with m.State("SKIP_FNAME"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(fname_cnt == 0):
                    m.d.sync += extra_cnt.eq(extra_len_reg)
                    m.next = "SKIP_EXTRA"
                with m.Elif(self.rx_valid):
                    m.d.sync += fname_cnt.eq(fname_cnt - 1)

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
                    m.d.sync += [
                        defl_bits   .eq(0),
                        defl_bit_cnt.eq(0),
                        defl_win_pos.eq(0),
                        defl_bytes_out.eq(0),
                        defl_rx_count.eq(0),
                    ]
                    m.next = "DEFL_BLOCK_HDR"
                with m.Elif(method_reg == METHOD_RLE):
                    m.d.sync += rle_rx_count.eq(0)
                    m.next = "RLE_READ_COUNT"
                with m.Else():
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_METHOD)
                    m.next = "FAULT"

            # ── DEFLATE sub-FSM (fixed Huffman, RFC 1951) ───────────────────

            with m.State("DEFL_BLOCK_HDR"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(defl_bit_cnt >= 3):
                    btype = Signal(2, name="btype")
                    m.d.comb += btype.eq(defl_bits[1:3])
                    m.d.sync += [
                        defl_bfinal.eq(defl_bits[0]),
                        defl_bits  .eq(defl_bits >> 3),
                        defl_bit_cnt.eq(defl_bit_cnt - 3),
                    ]
                    with m.If(btype == 0b01):
                        m.next = "DEFL_DECODE"
                    with m.Else():
                        m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                        m.next = "FAULT"
                with m.Elif(defl_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid & (defl_bit_cnt <= 24)):
                    m.d.sync += [
                        defl_bits   .eq(defl_bits | (self.rx_data << defl_bit_cnt[:5])),
                        defl_bit_cnt.eq(defl_bit_cnt + 8),
                        defl_rx_count.eq(defl_rx_count + 1),
                    ]

            with m.State("DEFL_DECODE"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If((defl_bit_cnt >= 7) & (code7_rev <= 23)):
                    m.d.sync += [
                        defl_symbol .eq(256 + code7_rev),
                        defl_bits   .eq(defl_bits >> 7),
                        defl_bit_cnt.eq(defl_bit_cnt - 7),
                    ]
                    with m.If(code7_rev == 0):
                        with m.If(defl_bfinal):
                            with m.If((wr_word_cnt == total_words) & (byte_buf_cnt == 0)):
                                m.next = "DEFL_DRAIN"
                            with m.Else():
                                m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                                m.next = "FAULT"
                        with m.Else():
                            m.next = "DEFL_BLOCK_HDR"
                    with m.Else():
                        m.d.sync += defl_len_idx.eq(code7_rev - 1)
                        m.next = "DEFL_LEN_EXTRA"
                with m.Elif((defl_bit_cnt >= 8) & (code8_rev >= 48) & (code8_rev <= 191)):
                    m.d.sync += [
                        defl_symbol .eq(code8_rev - 48),
                        defl_bits   .eq(defl_bits >> 8),
                        defl_bit_cnt.eq(defl_bit_cnt - 8),
                    ]
                    m.next = "DEFL_LIT_EMIT"
                with m.Elif((defl_bit_cnt >= 8) & (code8_rev >= 192) & (code8_rev <= 197)):
                    m.d.sync += [
                        defl_symbol .eq(code8_rev - 192 + 280),
                        defl_len_idx.eq(code8_rev - 192 + 23),
                        defl_bits   .eq(defl_bits >> 8),
                        defl_bit_cnt.eq(defl_bit_cnt - 8),
                    ]
                    m.next = "DEFL_LEN_EXTRA"
                with m.Elif((defl_bit_cnt >= 8) & (code8_rev >= 198) & (code8_rev <= 199)):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif((defl_bit_cnt >= 9) & (code9_rev >= 400) & (code9_rev <= 511)):
                    m.d.sync += [
                        defl_symbol .eq(code9_rev - 400 + 144),
                        defl_bits   .eq(defl_bits >> 9),
                        defl_bit_cnt.eq(defl_bit_cnt - 9),
                    ]
                    m.next = "DEFL_LIT_EMIT"
                with m.Elif(defl_bit_cnt >= 9):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(defl_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid & (defl_bit_cnt <= 24)):
                    m.d.sync += [
                        defl_bits   .eq(defl_bits | (self.rx_data << defl_bit_cnt[:5])),
                        defl_bit_cnt.eq(defl_bit_cnt + 8),
                        defl_rx_count.eq(defl_rx_count + 1),
                    ]

            with m.State("DEFL_LIT_EMIT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    crc_byte_in.eq(defl_symbol[:8]),
                    win_wr.addr.eq(defl_win_pos),
                    win_wr.data.eq(defl_symbol[:8]),
                    win_wr.en.eq(1),
                ]
                m.d.sync += [
                    crc_acc       .eq(crc_next),
                    defl_win_pos  .eq(defl_win_pos + 1),
                    defl_bytes_out.eq(defl_bytes_out + 1),
                ]
                with m.If(byte_buf_cnt == 3):
                    m.d.comb += [
                        self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                        self.mem_wr_data.eq(Cat(byte_buf, defl_symbol[:8])),
                        self.mem_wr_en  .eq(1),
                    ]
                    m.d.sync += [
                        wr_word_cnt .eq(wr_word_cnt + 1),
                        byte_buf_cnt.eq(0),
                        byte_buf    .eq(0),
                    ]
                    with m.If(wr_word_cnt + 1 == total_words):
                        m.next = "DEFL_DRAIN"
                    with m.Else():
                        m.next = "DEFL_DECODE"
                with m.Else():
                    with m.Switch(byte_buf_cnt):
                        with m.Case(0): m.d.sync += byte_buf[ 0: 8].eq(defl_symbol[:8])
                        with m.Case(1): m.d.sync += byte_buf[ 8:16].eq(defl_symbol[:8])
                        with m.Case(2): m.d.sync += byte_buf[16:24].eq(defl_symbol[:8])
                    m.d.sync += byte_buf_cnt.eq(byte_buf_cnt + 1)
                    m.next = "DEFL_DECODE"

            with m.State("DEFL_LEN_EXTRA"):
                m.d.comb += self.outform_busy.eq(1)
                extra_needed = Signal(4, name="len_extra_needed")
                m.d.comb += extra_needed.eq(len_extra_tbl[defl_len_idx])
                with m.If(defl_bit_cnt >= extra_needed):
                    with m.Switch(extra_needed):
                        with m.Case(0):
                            m.d.sync += defl_copy_len.eq(len_base_tbl[defl_len_idx])
                        with m.Case(1):
                            m.d.sync += [
                                defl_copy_len.eq(len_base_tbl[defl_len_idx] + defl_bits[:1]),
                                defl_bits    .eq(defl_bits >> 1),
                                defl_bit_cnt .eq(defl_bit_cnt - 1),
                            ]
                        with m.Case(2):
                            m.d.sync += [
                                defl_copy_len.eq(len_base_tbl[defl_len_idx] + defl_bits[:2]),
                                defl_bits    .eq(defl_bits >> 2),
                                defl_bit_cnt .eq(defl_bit_cnt - 2),
                            ]
                        with m.Case(3):
                            m.d.sync += [
                                defl_copy_len.eq(len_base_tbl[defl_len_idx] + defl_bits[:3]),
                                defl_bits    .eq(defl_bits >> 3),
                                defl_bit_cnt .eq(defl_bit_cnt - 3),
                            ]
                        with m.Case(4):
                            m.d.sync += [
                                defl_copy_len.eq(len_base_tbl[defl_len_idx] + defl_bits[:4]),
                                defl_bits    .eq(defl_bits >> 4),
                                defl_bit_cnt .eq(defl_bit_cnt - 4),
                            ]
                        with m.Case(5):
                            m.d.sync += [
                                defl_copy_len.eq(len_base_tbl[defl_len_idx] + defl_bits[:5]),
                                defl_bits    .eq(defl_bits >> 5),
                                defl_bit_cnt .eq(defl_bit_cnt - 5),
                            ]
                    m.next = "DEFL_DIST"
                with m.Elif(defl_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid & (defl_bit_cnt <= 24)):
                    m.d.sync += [
                        defl_bits   .eq(defl_bits | (self.rx_data << defl_bit_cnt[:5])),
                        defl_bit_cnt.eq(defl_bit_cnt + 8),
                        defl_rx_count.eq(defl_rx_count + 1),
                    ]

            with m.State("DEFL_DIST"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(defl_bit_cnt >= 5):
                    m.d.sync += [
                        defl_dist_code.eq(dist5_rev),
                        defl_bits     .eq(defl_bits >> 5),
                        defl_bit_cnt  .eq(defl_bit_cnt - 5),
                    ]
                    with m.If(dist5_rev > 21):
                        m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_WIN)
                        m.next = "FAULT"
                    with m.Else():
                        m.next = "DEFL_DIST_EXTRA"
                with m.Elif(defl_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid & (defl_bit_cnt <= 24)):
                    m.d.sync += [
                        defl_bits   .eq(defl_bits | (self.rx_data << defl_bit_cnt[:5])),
                        defl_bit_cnt.eq(defl_bit_cnt + 8),
                        defl_rx_count.eq(defl_rx_count + 1),
                    ]

            with m.State("DEFL_DIST_EXTRA"):
                m.d.comb += self.outform_busy.eq(1)
                dextra_needed = Signal(4, name="dist_extra_needed")
                m.d.comb += dextra_needed.eq(dist_extra_tbl[defl_dist_code])
                with m.If(defl_bit_cnt >= dextra_needed):
                    with m.Switch(dextra_needed):
                        with m.Case(0):
                            m.d.sync += defl_copy_dist.eq(dist_base_tbl[defl_dist_code])
                        for n in range(1, 10):
                            with m.Case(n):
                                m.d.sync += [
                                    defl_copy_dist.eq(dist_base_tbl[defl_dist_code] + defl_bits[:n]),
                                    defl_bits     .eq(defl_bits >> n),
                                    defl_bit_cnt  .eq(defl_bit_cnt - n),
                                ]
                    m.d.sync += defl_copy_idx.eq(0)
                    m.next = "DEFL_COPY_RD"
                with m.Elif(defl_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_DEFL)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid & (defl_bit_cnt <= 24)):
                    m.d.sync += [
                        defl_bits   .eq(defl_bits | (self.rx_data << defl_bit_cnt[:5])),
                        defl_bit_cnt.eq(defl_bit_cnt + 8),
                        defl_rx_count.eq(defl_rx_count + 1),
                    ]

            with m.State("DEFL_COPY_RD"):
                m.d.comb += self.outform_busy.eq(1)
                defl_hist_depth = Signal(32, name="defl_hist_depth")
                m.d.comb += defl_hist_depth.eq(Mux(defl_bytes_out >= DEFL_WIN_SIZE, DEFL_WIN_SIZE, defl_bytes_out))
                with m.If((defl_copy_idx == 0) & ((defl_copy_dist == 0) | (defl_copy_dist > defl_hist_depth))):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_WIN)
                    m.next = "FAULT"
                with m.Else():
                    m.d.comb += win_rd.addr.eq((defl_win_pos - defl_copy_dist) & DEFL_WIN_MASK)
                    m.next = "DEFL_COPY_EMIT"

            with m.State("DEFL_COPY_EMIT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    crc_byte_in.eq(win_rd.data),
                    win_wr.addr.eq(defl_win_pos),
                    win_wr.data.eq(win_rd.data),
                    win_wr.en.eq(1),
                ]
                m.d.sync += [
                    crc_acc       .eq(crc_next),
                    defl_win_pos  .eq(defl_win_pos + 1),
                    defl_bytes_out.eq(defl_bytes_out + 1),
                    defl_copy_idx .eq(defl_copy_idx + 1),
                ]
                with m.If(byte_buf_cnt == 3):
                    m.d.comb += [
                        self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                        self.mem_wr_data.eq(Cat(byte_buf, win_rd.data)),
                        self.mem_wr_en  .eq(1),
                    ]
                    m.d.sync += [
                        wr_word_cnt .eq(wr_word_cnt + 1),
                        byte_buf_cnt.eq(0),
                        byte_buf    .eq(0),
                    ]
                    with m.If(wr_word_cnt + 1 == total_words):
                        m.next = "DEFL_DRAIN"
                    with m.Elif(defl_copy_idx + 1 >= defl_copy_len):
                        m.next = "DEFL_DECODE"
                    with m.Else():
                        m.next = "DEFL_COPY_RD"
                with m.Else():
                    with m.Switch(byte_buf_cnt):
                        with m.Case(0): m.d.sync += byte_buf[ 0: 8].eq(win_rd.data)
                        with m.Case(1): m.d.sync += byte_buf[ 8:16].eq(win_rd.data)
                        with m.Case(2): m.d.sync += byte_buf[16:24].eq(win_rd.data)
                    m.d.sync += byte_buf_cnt.eq(byte_buf_cnt + 1)
                    with m.If(defl_copy_idx + 1 >= defl_copy_len):
                        m.next = "DEFL_DECODE"
                    with m.Else():
                        m.next = "DEFL_COPY_RD"

            with m.State("DEFL_DRAIN"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(defl_rx_count >= comp_size_reg):
                    m.next = "CHECK_CRC32"
                with m.Elif(self.rx_valid):
                    m.d.sync += defl_rx_count.eq(defl_rx_count + 1)

            # ── RLE sub-FSM (byte-pair: count + literal) ────────────────────

            with m.State("RLE_READ_COUNT"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(rle_rx_count >= comp_size_reg):
                    with m.If((wr_word_cnt == total_words) & (byte_buf_cnt == 0)):
                        m.next = "CHECK_CRC32"
                    with m.Else():
                        m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_RLE)
                        m.next = "FAULT"
                with m.Elif(self.rx_valid):
                    m.d.sync += [
                        rle_count.eq(self.rx_data),
                        rle_rx_count.eq(rle_rx_count + 1),
                    ]
                    m.next = "RLE_READ_LIT"

            with m.State("RLE_READ_LIT"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(rle_rx_count >= comp_size_reg):
                    m.d.sync += self.outform_fault_type.eq(OUTFORM_FAULT_RLE)
                    m.next = "FAULT"
                with m.Elif(self.rx_valid):
                    m.d.sync += [
                        rle_literal  .eq(self.rx_data),
                        rle_remaining.eq(rle_count),
                        rle_rx_count.eq(rle_rx_count + 1),
                    ]
                    with m.If(rle_count == 0):
                        m.next = "RLE_READ_COUNT"
                    with m.Else():
                        m.next = "RLE_EMIT"

            with m.State("RLE_EMIT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    crc_byte_in.eq(rle_literal),
                ]
                m.d.sync += [
                    crc_acc      .eq(crc_next),
                    rle_remaining.eq(rle_remaining - 1),
                ]
                with m.If(byte_buf_cnt == 3):
                    m.d.comb += [
                        self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                        self.mem_wr_data.eq(Cat(byte_buf, rle_literal)),
                        self.mem_wr_en  .eq(1),
                    ]
                    m.d.sync += [
                        wr_word_cnt .eq(wr_word_cnt + 1),
                        byte_buf_cnt.eq(0),
                        byte_buf    .eq(0),
                    ]
                    with m.If(wr_word_cnt + 1 == total_words):
                        m.next = "RLE_DRAIN"
                    with m.Elif(rle_remaining <= 1):
                        m.next = "RLE_READ_COUNT"
                    with m.Else():
                        pass
                with m.Else():
                    with m.Switch(byte_buf_cnt):
                        with m.Case(0): m.d.sync += byte_buf[ 0: 8].eq(rle_literal)
                        with m.Case(1): m.d.sync += byte_buf[ 8:16].eq(rle_literal)
                        with m.Case(2): m.d.sync += byte_buf[16:24].eq(rle_literal)
                    m.d.sync += byte_buf_cnt.eq(byte_buf_cnt + 1)
                    with m.If(rle_remaining <= 1):
                        m.next = "RLE_READ_COUNT"

            with m.State("RLE_DRAIN"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(rle_rx_count >= comp_size_reg):
                    m.next = "CHECK_CRC32"
                with m.Elif(self.rx_valid):
                    m.d.sync += rle_rx_count.eq(rle_rx_count + 1)

            # ── Common tail states ──────────────────────────────────────────

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
