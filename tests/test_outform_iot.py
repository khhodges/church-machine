"""
Simulation tests for ChurchOutformIoT lazy-load flow.

test_iot_lazy_load_golden
  Fast protocol smoke-test: verifies the outform FSM signals
  (tunnel/alloc/mint sequencing) with mock alloc/mint drivers.

test_iot_lazy_load_integrated
  Integration test: uses a real watermark allocator and Mint FSM
  (mirroring the logic in hardware/core.py) with an in-memory DMEM,
  then reads back the NS and clist memories and checks:
    ns[slot*3+0] == alloc_base
    ns[slot*3+1] == expected W2
    clist[caller_slot] == valid E-GT

test_iot_lazy_load_toplevel  [PRIMARY DELIVERABLE for Task #264]
  Top-level integration test: instantiates ChurchTangNano20K(iot_profile=True,
  sim_mode=True, test_mode=True) and drives the real UART RX bit-stream path
  end-to-end (16 cycles/bit, 8N1).  Injects outform_start via the test_mode
  bypass; feeds connect byte + lean header + 256-byte payload; then verifies
  the debug signals show:
    ns[slot*3+0] == alloc_base (0x400)
    ns[slot*3+1] == W2         (gt_seq=1, limit_offset=63)
    ns[slot*3+2] == CRC16 seal
    clist[caller] == valid E-GT (E-perm, Inform, seq=1, slot=0)
"""

import sys
import os
import struct
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from amaranth import *
from amaranth.lib.data import View
from amaranth.lib.memory import Memory as LibMemory
from amaranth.sim import Simulator

from hardware.outform_iot import (
    ChurchOutformIoT, TUNNEL_REQ_LEN, IOT_HDR_LEN,
    OUTFORM_FAULT_HDR, OUTFORM_FAULT_CRC32, OUTFORM_FAULT_ALLOC, OUTFORM_FAULT_MINT,
)
from hardware.hw_types import GT_TYPE_INFORM, CRC16_POLY, CRC16_INIT
from hardware.layouts import LUMP_HEADER_LAYOUT

MAX_TICKS = 8000

# ── Lump / header construction ────────────────────────────────────────────────

def build_lump_payload():
    """Return 256-byte (64-word) lump: 2 code words, 0 caps, n_minus_6=0.

    Layout (little-endian words):
      word[0]    : header — magic=0x1F, n_minus_6=0, cw=2, typ=0, cc=0
      word[1..2] : non-zero code words (distinct to exercise memory path)
      word[3..63]: zero free-space (MINT_SCAN_FS must see 0)
    """
    header_word = (0x1F << 27) | (0 << 23) | (2 << 10) | (0 << 8) | 0
    payload  = struct.pack("<I", header_word)
    payload += struct.pack("<I", 0x00000001)
    payload += struct.pack("<I", 0x00000002)
    payload += bytes(64 * 4 - 3 * 4)          # zero free-space
    assert len(payload) == 256
    return payload


def build_lean_header(payload: bytes) -> bytes:
    """8-byte IoT tunnel header: payload_len (4 B LE) + CRC-32 (4 B LE)."""
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    return struct.pack("<II", len(payload), crc)


# ── Python reference computations (mirror core.py Mint FSM formulas) ─────────

def ref_e_gt(slot_id: int) -> int:
    """E-GT: perms=E(bit30) | typ=Inform(01<<23) | gt_seq=1(<<16) | slot_id."""
    return (1 << 30) | (GT_TYPE_INFORM << 23) | (1 << 16) | (slot_id & 0xFFFF)


def ref_w2(lump_size_words: int) -> int:
    """W2: gt_seq=1(<<21) | limit_offset=(lump_size-1)[20:0]."""
    return (1 << 21) | ((lump_size_words - 1) & 0x1FFFFF)


def ref_crc16(e_gt: int, base: int, w2: int) -> int:
    """CRC16/CCITT-FALSE over e_gt[24:0] || base[31:0] || w2[31:0], MSB-first."""
    crc = CRC16_INIT & 0xFFFF
    bits = []
    for i in range(24, -1, -1):
        bits.append((e_gt >> i) & 1)
    for i in range(31, -1, -1):
        bits.append((base >> i) & 1)
    for i in range(31, -1, -1):
        bits.append((w2 >> i) & 1)
    for bit in bits:
        top = (crc >> 15) & 1
        crc = ((crc << 1) & 0xFFFF) ^ (CRC16_POLY if (top ^ bit) else 0)
    return crc & 0xFFFF


# ── Simulation helpers (shared by both tests) ─────────────────────────────────

async def send_bytes(ctx, dut, data: bytes):
    for b in data:
        ctx.set(dut.rx_valid, 1)
        ctx.set(dut.rx_data, int(b))
        await ctx.tick()
        ctx.set(dut.rx_valid, 0)
        await ctx.tick()


async def ack_tx_bytes(ctx, dut, count: int):
    for _ in range(count):
        ctx.set(dut.tx_ack, 1)
        await ctx.tick()
        ctx.set(dut.tx_ack, 0)
        await ctx.tick()


async def wait_alloc_req(ctx, dut):
    for _ in range(MAX_TICKS):
        await ctx.tick()
        if ctx.get(dut.alloc_req):
            return
    raise AssertionError("wait_alloc_req: timed out")


async def respond_alloc(ctx, dut, alloc_base: int):
    ctx.set(dut.alloc_base, alloc_base)
    ctx.set(dut.alloc_done, 1)
    await ctx.tick()
    ctx.set(dut.alloc_done, 0)
    ctx.set(dut.alloc_base, 0)
    for _ in range(4):
        await ctx.tick()


async def wait_mint_call(ctx, dut):
    for _ in range(MAX_TICKS + 1):
        if ctx.get(dut.mint_call):
            return ctx.get(dut.mint_base), ctx.get(dut.mint_n)
        await ctx.tick()
    raise AssertionError("wait_mint_call: timed out")


async def respond_mint(ctx, dut, result_gt: int):
    ctx.set(dut.mint_result_gt, result_gt)
    ctx.set(dut.mint_done, 1)
    await ctx.tick()  # FSM: MINT → MINT_WAIT (mint_done=1 held)
    await ctx.tick()  # FSM: MINT_WAIT → COMPLETE (mint_done=1 visible)
    ctx.set(dut.mint_done, 0)
    ctx.set(dut.mint_result_gt, 0)


async def wait_done(ctx, dut):
    for _ in range(MAX_TICKS + 1):
        done  = ctx.get(dut.outform_done)
        fault = ctx.get(dut.outform_fault)
        if done or fault:
            ftype = ctx.get(dut.outform_fault_type)
            rgt   = ctx.get(dut.result_gt)
            return done, fault, ftype, rgt
        await ctx.tick()
    raise AssertionError("wait_done: timed out")


async def wait_alloc_done(ctx, dut):
    """Poll alloc_done_out until it pulses, then yield one extra tick so the
    FSM enters RECV_PAYLOAD before the caller starts sending payload bytes.

    Checks BEFORE the first tick because when the harness wires alloc_done
    combinatorially, it may fire in the same clock that the FSM enters ALLOC
    (i.e., while send_bytes is still running), making the pulse invisible to
    a tick-first poll.
    """
    for _ in range(MAX_TICKS + 1):
        if ctx.get(dut.alloc_done_out):
            await ctx.tick()   # one more tick: ALLOC → RECV_PAYLOAD transition
            return
        await ctx.tick()
    raise AssertionError("wait_alloc_done: timed out")


# ── Integration harness ───────────────────────────────────────────────────────

class OutformIoTHarness(Elaboratable):
    """Integrates ChurchOutformIoT with real watermark allocator + Mint FSM.

    Mirrors the IoT-profile block inside hardware/core.py.  Provides
    observable NS and clist memories so the test can read back entries
    after the outform_done pulse.

    Memory layout
    -------------
    DMEM     : 512 words (depth), byte-addressed.
               Words 256-319 will hold the 64-word lump after RECV_PAYLOAD.
    NS MEM   : 64 words; addr = (NS_BASE + slot*12 + word_idx*4) >> 2
               NS_BASE = 0, so slot s uses words 3s, 3s+1, 3s+2.
    CLIST MEM: 64 words; caller's E-GT written at byte addr clist_slot_baddr.
    """

    DMEM_DEPTH     = 512
    NS_DEPTH       = 64
    CLIST_DEPTH    = 64
    NS_BASE        = 0           # word1_location of CR15 in this harness
    WATERMARK_INIT = 256         # first free DMEM word (matches core.py)

    def __init__(self, slot_id: int, clist_slot_byte_addr: int, gt_raw: int):
        self._slot_id            = slot_id
        self._clist_slot_baddr   = clist_slot_byte_addr
        self._gt_raw             = gt_raw

        # Outform interface (drive from test)
        self.outform_start = Signal()
        self.rx_valid      = Signal()
        self.rx_data       = Signal(8)
        self.tx_ack        = Signal()

        # Outform outputs (observe from test)
        self.tx_valid           = Signal()
        self.tx_data            = Signal(8)
        self.outform_done       = Signal()
        self.outform_fault      = Signal()
        self.outform_fault_type = Signal(5)
        self.result_gt          = Signal(32)
        self.alloc_done_out     = Signal()  # pulses when alloc completes

        # NS/clist readback
        self.ns_rd_addr    = Signal(range(self.NS_DEPTH))
        self.ns_rd_data    = Signal(32)
        self.clist_rd_addr = Signal(range(self.CLIST_DEPTH))
        self.clist_rd_data = Signal(32)

    def elaborate(self, platform):
        m = Module()

        # ── ChurchOutformIoT ──────────────────────────────────────────────────
        u_out = ChurchOutformIoT()
        m.submodules.outform = u_out

        m.d.comb += [
            u_out.outform_start .eq(self.outform_start),
            u_out.gt_raw        .eq(self._gt_raw),
            u_out.slot_id       .eq(self._slot_id),
            u_out.tx_ack        .eq(self.tx_ack),
            u_out.rx_valid      .eq(self.rx_valid),
            u_out.rx_data       .eq(self.rx_data),
            self.tx_valid           .eq(u_out.tx_valid),
            self.tx_data            .eq(u_out.tx_data),
            self.outform_done       .eq(u_out.outform_done),
            self.outform_fault      .eq(u_out.outform_fault),
            self.outform_fault_type .eq(u_out.outform_fault_type),
            self.result_gt          .eq(u_out.result_gt),
        ]

        # Expose alloc_done so the test can wait before sending payload
        m.d.comb += self.alloc_done_out.eq(u_out.alloc_done)

        # ── DMEM (shared: outform writes, Mint reads) ─────────────────────────
        dmem = LibMemory(shape=unsigned(32), depth=self.DMEM_DEPTH,
                         init=[0] * self.DMEM_DEPTH)
        m.submodules.dmem = dmem

        dmem_rd = dmem.read_port(domain="comb")   # async/combinatorial reads
        dmem_wr = dmem.write_port()

        # Outform writes payload words directly into DMEM
        m.d.comb += [
            dmem_wr.addr .eq(u_out.mem_wr_addr[2:]),   # byte → word index
            dmem_wr.data .eq(u_out.mem_wr_data),
            dmem_wr.en   .eq(u_out.mem_wr_en),
        ]

        # Mint FSM read bus: address set combinatorially, data available immediately
        mint_dmem_addr = Signal(32)
        m.d.comb += dmem_rd.addr.eq(mint_dmem_addr[2:])   # byte → word index
        dmem_rd_data = dmem_rd.data                         # combinatorial

        # ── NS memory ─────────────────────────────────────────────────────────
        ns_mem = LibMemory(shape=unsigned(32), depth=self.NS_DEPTH,
                           init=[0] * self.NS_DEPTH)
        m.submodules.ns_mem = ns_mem
        ns_rd = ns_mem.read_port(domain="comb")
        ns_wr = ns_mem.write_port()

        ns_wr_en   = Signal()
        ns_wr_addr = Signal(32)
        ns_wr_data = Signal(32)
        m.d.comb += [
            ns_wr.en   .eq(ns_wr_en),
            ns_wr.addr .eq(ns_wr_addr[2:]),
            ns_wr.data .eq(ns_wr_data),
            ns_rd.addr .eq(self.ns_rd_addr),
            self.ns_rd_data .eq(ns_rd.data),
        ]

        # ── clist memory ──────────────────────────────────────────────────────
        cl_mem = LibMemory(shape=unsigned(32), depth=self.CLIST_DEPTH,
                           init=[0] * self.CLIST_DEPTH)
        m.submodules.cl_mem = cl_mem
        cl_rd = cl_mem.read_port(domain="comb")
        cl_wr = cl_mem.write_port()

        cl_wr_en   = Signal()
        cl_wr_addr = Signal(32)
        cl_wr_data = Signal(32)
        m.d.comb += [
            cl_wr.en   .eq(cl_wr_en),
            cl_wr.addr .eq(cl_wr_addr[2:]),
            cl_wr.data .eq(cl_wr_data),
            cl_rd.addr .eq(self.clist_rd_addr),
            self.clist_rd_data .eq(cl_rd.data),
        ]

        # ── Watermark allocator (matches core.py IoT block) ──────────────────
        DMEM_WORDS = self.DMEM_DEPTH

        watermark_reg   = Signal(32, init=self.WATERMARK_INIT)
        alloc_sz_w      = Signal(32)
        alloc_mask_w    = Signal(32)
        alloc_aligned_w = Signal(32)
        alloc_new_wm_w  = Signal(33)

        m.d.comb += alloc_sz_w.eq(C(1, 32) << u_out.alloc_n)
        m.d.comb += alloc_mask_w.eq(alloc_sz_w - 1)
        m.d.comb += alloc_aligned_w.eq(
            (watermark_reg + alloc_mask_w) & ~alloc_mask_w
        )
        m.d.comb += alloc_new_wm_w.eq(
            Cat(alloc_aligned_w, C(0, 1)) + Cat(alloc_sz_w, C(0, 1))
        )

        alloc_fits = Signal()
        alloc_n_ok = Signal()
        m.d.comb += alloc_fits.eq(alloc_new_wm_w <= DMEM_WORDS)
        m.d.comb += alloc_n_ok.eq(
            (u_out.alloc_n >= 6) & (u_out.alloc_n <= 14)
        )
        m.d.comb += [
            u_out.alloc_done .eq(u_out.alloc_req & alloc_fits & alloc_n_ok),
            u_out.alloc_fault.eq(u_out.alloc_req & (~alloc_fits | ~alloc_n_ok)),
            u_out.alloc_base .eq(alloc_aligned_w << 2),
        ]
        with m.If(u_out.alloc_req & alloc_fits & alloc_n_ok):
            m.d.sync += watermark_reg.eq(alloc_new_wm_w[:32])

        # ── Mint FSM (mirrors core.py MINT_* states for iot_profile=True) ────
        mint_base_reg      = Signal(32)
        mint_cw_reg        = Signal(13)
        mint_cc_reg        = Signal(8)
        mint_scan_idx_reg  = Signal(14)
        mint_copy_idx_reg  = Signal(8)
        mint_copy_data_reg = Signal(32)
        mint_hdr_reg       = Signal(32)
        mint_lump_sz_reg   = Signal(15)    # in words

        mint_slot_id_reg    = Signal(16, init=self._slot_id)
        mint_clist_addr_reg = Signal(32, init=self._clist_slot_baddr)

        # NS entry byte-address: NS_BASE + slot_id * 12
        mint_ns_entry_base = Signal(32)
        m.d.comb += mint_ns_entry_base.eq(
            self.NS_BASE
            + (mint_slot_id_reg << 3)
            + (mint_slot_id_reg << 2)
        )

        # E-GT: perms=E(bit30) | typ=Inform(01<<23) | gt_seq=1(<<16) | slot_id
        mint_e_gt = Signal(32)
        m.d.comb += mint_e_gt.eq(
            (1 << 30) | (GT_TYPE_INFORM << 23) | (1 << 16) | mint_slot_id_reg
        )

        # W2: gt_seq=1(<<21) | limit_offset=(lump_size-1)[20:0]
        mint_w2 = Signal(32)
        m.d.comb += mint_w2.eq((1 << 21) | (mint_lump_sz_reg - 1)[:21])

        # W3: CRC16/CCITT-FALSE over mint_e_gt[24:0] || mint_base[31:0] || mint_w2[31:0]
        _crc = [Signal(16, name=f"hcrc{i}") for i in range(90)]
        m.d.comb += _crc[0].eq(CRC16_INIT)
        for _i in range(89):
            if _i < 25:
                _db = mint_e_gt[24 - _i]
            elif _i < 57:
                _db = mint_base_reg[56 - _i]
            else:
                _db = mint_w2[88 - _i]
            _top = Signal(name=f"hcrc_top{_i}")
            _sh  = Signal(16, name=f"hcrc_sh{_i}")
            m.d.comb += _top.eq(_crc[_i][15] ^ _db)
            m.d.comb += _sh.eq(Cat(Const(0, 1), _crc[_i][:15]))
            m.d.comb += _crc[_i + 1].eq(_sh ^ Mux(_top, CRC16_POLY, 0))
        mint_w3 = _crc[89]

        mint_done_s  = Signal()
        mint_fault_s = Signal()

        with m.FSM(name="mint"):

            with m.State("IDLE"):
                with m.If(u_out.mint_call):
                    m.d.sync += mint_base_reg.eq(u_out.mint_base)
                    m.next = "READ_HDR"

            with m.State("READ_HDR"):
                m.d.comb += mint_dmem_addr.eq(mint_base_reg)
                m.d.sync += mint_hdr_reg.eq(dmem_rd_data)
                m.next = "CHECK_HDR"

            with m.State("CHECK_HDR"):
                hdr_v = View(LUMP_HEADER_LAYOUT, mint_hdr_reg)
                lsz   = Signal(15)
                m.d.comb += lsz.eq(1 << (hdr_v.n_minus_6 + 6))
                with m.If(hdr_v.magic != 0x1F):
                    m.next = "FAULT"
                with m.Elif(hdr_v.n_minus_6 > 8):
                    m.next = "FAULT"
                with m.Elif(hdr_v.cc > (lsz - 2)):
                    m.next = "FAULT"
                with m.Elif(hdr_v.cw > (lsz - hdr_v.cc - 2)):
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += [
                        mint_lump_sz_reg  .eq(lsz),
                        mint_cw_reg       .eq(hdr_v.cw),
                        mint_cc_reg       .eq(hdr_v.cc),
                        mint_scan_idx_reg .eq(hdr_v.cw + 1),
                    ]
                    m.next = "SCAN_FS"

            with m.State("SCAN_FS"):
                scan_end = Signal(15)
                m.d.comb += scan_end.eq(mint_lump_sz_reg - mint_cc_reg - 1)
                with m.If(mint_scan_idx_reg > scan_end):
                    m.d.sync += mint_copy_idx_reg.eq(0)
                    m.next = "WRITE_NS0"
                with m.Else():
                    m.d.comb += mint_dmem_addr.eq(
                        mint_base_reg + (mint_scan_idx_reg << 2)
                    )
                    with m.If(dmem_rd_data != 0):
                        m.next = "FAULT"
                    with m.Else():
                        m.d.sync += mint_scan_idx_reg.eq(mint_scan_idx_reg + 1)

            with m.State("WRITE_NS0"):
                m.d.comb += [
                    ns_wr_en  .eq(1),
                    ns_wr_addr.eq(mint_ns_entry_base),
                    ns_wr_data.eq(mint_base_reg),
                ]
                m.next = "WRITE_NS1"

            with m.State("WRITE_NS1"):
                m.d.comb += [
                    ns_wr_en  .eq(1),
                    ns_wr_addr.eq(mint_ns_entry_base + 4),
                    ns_wr_data.eq(mint_w2),
                ]
                m.next = "WRITE_NS2"

            with m.State("WRITE_NS2"):
                m.d.comb += [
                    ns_wr_en  .eq(1),
                    ns_wr_addr.eq(mint_ns_entry_base + 8),
                    ns_wr_data.eq(mint_w3),
                ]
                m.next = "COPY_CLIST_RD"

            with m.State("COPY_CLIST_RD"):
                with m.If(mint_copy_idx_reg >= mint_cc_reg):
                    m.next = "WRITE_CLIST"
                with m.Else():
                    cc_off = Signal(15)
                    m.d.comb += cc_off.eq(
                        mint_lump_sz_reg - mint_cc_reg + mint_copy_idx_reg
                    )
                    m.d.comb += mint_dmem_addr.eq(
                        mint_base_reg + (cc_off << 2)
                    )
                    m.d.sync += mint_copy_data_reg.eq(dmem_rd_data)
                    m.next = "COPY_CLIST_WR"

            with m.State("COPY_CLIST_WR"):
                m.d.comb += [
                    cl_wr_en  .eq(1),
                    cl_wr_addr.eq(
                        768 + (mint_slot_id_reg << 8)
                        + (mint_copy_idx_reg << 2)
                    ),
                    cl_wr_data.eq(mint_copy_data_reg),
                ]
                m.d.sync += mint_copy_idx_reg.eq(mint_copy_idx_reg + 1)
                m.next = "COPY_CLIST_RD"

            with m.State("WRITE_CLIST"):
                m.d.comb += [
                    cl_wr_en  .eq(1),
                    cl_wr_addr.eq(mint_clist_addr_reg),
                    cl_wr_data.eq(mint_e_gt),
                ]
                m.next = "DONE"

            with m.State("DONE"):
                m.d.comb += [
                    mint_done_s           .eq(1),
                    u_out.mint_result_gt  .eq(mint_e_gt),
                ]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += mint_fault_s.eq(1)
                m.next = "IDLE"

        m.d.comb += [
            u_out.mint_done .eq(mint_done_s),
            u_out.mint_fault.eq(mint_fault_s),
        ]

        return m


# ── Test 1: Protocol smoke test (mock alloc/mint) ─────────────────────────────

def test_iot_lazy_load_golden():
    """FSM protocol smoke test: tunnel→alloc→mint sequencing with mock drivers.

    Captures mint_base and mint_n at mint_call time.  Verifies they match the
    expected values a real Mint FSM would need, then checks result_gt passthrough.
    """
    SLOT_ID     = 3
    GT_RAW      = 0xDEADBEEF
    ALLOC_BASE  = 0x400           # 1024 bytes = word 256

    LUMP_WORDS  = 64              # 2^(n_minus_6=0 + 6)
    ALLOC_N_EXP = 6

    payload  = build_lump_payload()
    lean_hdr = build_lean_header(payload)

    dut = ChurchOutformIoT()
    captured = {}

    async def process(ctx):
        ctx.set(dut.gt_raw, GT_RAW)
        ctx.set(dut.slot_id, SLOT_ID)
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        await ack_tx_bytes(ctx, dut, TUNNEL_REQ_LEN)
        await send_bytes(ctx, dut, b"\xAC")          # connect byte
        await send_bytes(ctx, dut, lean_hdr)

        await wait_alloc_req(ctx, dut)
        await respond_alloc(ctx, dut, ALLOC_BASE)
        await send_bytes(ctx, dut, payload)

        mb, mn = await wait_mint_call(ctx, dut)
        captured["mint_base"] = mb
        captured["mint_n"]    = mn

        e_gt = ref_e_gt(SLOT_ID)
        await respond_mint(ctx, dut, e_gt)

        done, fault, ftype, rgt = await wait_done(ctx, dut)
        assert done  == 1, f"expected outform_done: done={done} fault={fault} ft=0x{ftype:02X}"
        assert fault == 0, f"unexpected fault ft=0x{ftype:02X}"
        assert rgt == e_gt, f"result_gt=0x{rgt:08X} expected=0x{e_gt:08X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_golden.vcd"):
        sim.run()

    assert "mint_base" in captured, "mint_call was never observed"
    assert captured["mint_base"] == ALLOC_BASE, (
        f"mint_base=0x{captured['mint_base']:08X} != alloc_base=0x{ALLOC_BASE:08X}"
    )
    assert captured["mint_n"] == ALLOC_N_EXP, (
        f"mint_n={captured['mint_n']} != {ALLOC_N_EXP}"
    )
    print("PASS: test_iot_lazy_load_golden")


# ── Test 2: Integration test — real allocator + Mint FSM + memory readback ────

def test_iot_lazy_load_integrated():
    """End-to-end integration: real watermark allocator + Mint FSM.

    Uses OutformIoTHarness which mirrors the core.py IoT block.
    After outform_done, reads NS and clist memories directly and checks:
      ns[slot*3 + 0]   == alloc_base       (lump byte-address pointer)
      ns[slot*3 + 1]   == W2               (gt_seq=1, limit_offset=63)
      ns[slot*3 + 2]   == CRC16 seal W3    (matches Python ref_crc16)
      clist[caller_idx] == E-GT            (E-perm, Inform, gt_seq=1, slot)
    """
    SLOT_ID    = 3
    GT_RAW     = 0xDEADBEEF

    # Caller clist slot byte address: slot_id * 4 → word index slot_id
    CLIST_BADDR = SLOT_ID * 4

    payload  = build_lump_payload()
    lean_hdr = build_lean_header(payload)

    dut = OutformIoTHarness(
        slot_id=SLOT_ID,
        clist_slot_byte_addr=CLIST_BADDR,
        gt_raw=GT_RAW,
    )

    # Watermark starts at word 256; alloc_n=6 → alloc_size=64 words, aligned.
    # alloc_base_bytes = 256 * 4 = 1024 = 0x400
    ALLOC_BASE_BYTES = OutformIoTHarness.WATERMARK_INIT * 4   # = 0x400
    LUMP_WORDS       = 64

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        await ack_tx_bytes(ctx, dut, TUNNEL_REQ_LEN)
        await send_bytes(ctx, dut, b"\xAC")          # connect byte
        await send_bytes(ctx, dut, lean_hdr)
        # Wait for the automatic allocator to fire (DERIVE_N → ALLOC → done),
        # then send the full payload in RECV_PAYLOAD state.
        await wait_alloc_done(ctx, dut)
        await send_bytes(ctx, dut, payload)

        done, fault, ftype, rgt = await wait_done(ctx, dut)
        assert done  == 1, f"expected outform_done: done={done} fault={fault} ft=0x{ftype:02X}"
        assert fault == 0, f"unexpected fault ft=0x{ftype:02X}"

        # Let memory writes settle (Mint FSM writes happen before DONE pulse)
        for _ in range(4):
            await ctx.tick()

        # ── Read NS memory ────────────────────────────────────────────────────
        # NS entry base: slot_id * 12 bytes = slot_id * 3 words
        ns_word0_idx = (OutformIoTHarness.NS_BASE + SLOT_ID * 12 + 0) >> 2
        ns_word1_idx = (OutformIoTHarness.NS_BASE + SLOT_ID * 12 + 4) >> 2
        ns_word2_idx = (OutformIoTHarness.NS_BASE + SLOT_ID * 12 + 8) >> 2

        ctx.set(dut.ns_rd_addr, ns_word0_idx)
        await ctx.tick()
        ns_word0 = ctx.get(dut.ns_rd_data)

        ctx.set(dut.ns_rd_addr, ns_word1_idx)
        await ctx.tick()
        ns_word1 = ctx.get(dut.ns_rd_data)

        ctx.set(dut.ns_rd_addr, ns_word2_idx)
        await ctx.tick()
        ns_word2 = ctx.get(dut.ns_rd_data)

        # ── Read clist memory ─────────────────────────────────────────────────
        ctx.set(dut.clist_rd_addr, CLIST_BADDR >> 2)
        await ctx.tick()
        clist_e_gt = ctx.get(dut.clist_rd_data)

        # ── Compute reference values ──────────────────────────────────────────
        exp_ns0  = ALLOC_BASE_BYTES
        exp_ns1  = ref_w2(LUMP_WORDS)
        exp_e_gt = ref_e_gt(SLOT_ID)
        exp_ns2  = ref_crc16(exp_e_gt, ALLOC_BASE_BYTES, exp_ns1)

        # ── Assertions against actual memory contents ─────────────────────────
        assert ns_word0 == exp_ns0, (
            f"ns[slot*3+0]=0x{ns_word0:08X}  expected alloc_base=0x{exp_ns0:08X}"
        )
        assert ns_word1 == exp_ns1, (
            f"ns[slot*3+1]=0x{ns_word1:08X}  expected W2=0x{exp_ns1:08X}"
        )
        assert ns_word2 == exp_ns2, (
            f"ns[slot*3+2]=0x{ns_word2:08X}  expected W3(CRC16)=0x{exp_ns2:04X}"
        )
        assert clist_e_gt == exp_e_gt, (
            f"clist[slot]=0x{clist_e_gt:08X}  expected E-GT=0x{exp_e_gt:08X}"
        )

        # Sanity-check E-GT bit-fields
        assert (clist_e_gt >> 30) & 1, (
            f"E-GT bit30 (perms=E) not set: 0x{clist_e_gt:08X}"
        )
        assert ((clist_e_gt >> 23) & 0x3) == GT_TYPE_INFORM, (
            f"E-GT type={((clist_e_gt>>23)&3)} != GT_TYPE_INFORM={GT_TYPE_INFORM}"
        )
        assert (clist_e_gt & 0xFFFF) == SLOT_ID, (
            f"E-GT slot_id={(clist_e_gt & 0xFFFF)} != {SLOT_ID}"
        )

        print(
            f"  ns[slot*3+0]       = 0x{ns_word0:08X}  (alloc_base)\n"
            f"  ns[slot*3+1] (W2)  = 0x{ns_word1:08X}  "
            f"(gt_seq=1, limit_offset={LUMP_WORDS-1})\n"
            f"  ns[slot*3+2] (W3)  = 0x{ns_word2:04X}      "
            f"(CRC16 seal)\n"
            f"  clist[caller] (E-GT)= 0x{clist_e_gt:08X}  "
            f"(E-perm, Inform, seq=1, slot={SLOT_ID})"
        )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_integrated.vcd"):
        sim.run()
    print("PASS: test_iot_lazy_load_integrated")


def test_iot_lazy_load_toplevel():
    """
    Top-level integration test: drives ChurchTangNano20K(iot_profile=True,
    sim_mode=True) end-to-end through the real UART bit path, then verifies:
      ns[slot*3+0] == alloc_base (0x400)
      ns[slot*3+1] == W2         (gt_seq=1, limit_offset=63)
      ns[slot*3+2] == CRC16 seal
      clist[caller] == valid E-GT (E-perm, Inform, seq=1, slot=0)

    Clock: 16 cycles per bit (clk_freq=16, baud=1).
    UART bytes are injected as serial bit-streams on dut.uart_rx.
    """
    from hardware.tang_nano_20k import ChurchTangNano20K

    # ── Test constants ────────────────────────────────────────────────────
    SLOT_ID       = 0
    CLIST_ADDR    = 768          # byte addr of caller's clist slot (NS_WORDS*4)
    CPB           = 16           # cycles per bit (clk_freq=16, baud=1)
    LUMP_WORDS    = 64
    ALLOC_BASE    = 256 * 4      # = 0x400  (watermark_init=256 words)
    CONNECT_BYTE  = 0xAC

    E_GT  = ref_e_gt(SLOT_ID)
    W2    = ref_w2(LUMP_WORDS)
    W3    = ref_crc16(E_GT, ALLOC_BASE, W2)

    payload   = build_lump_payload()
    lean_hdr  = build_lean_header(payload)

    # ── UART helpers ──────────────────────────────────────────────────────
    async def uart_send_byte(ctx, dut, byte):
        """Drive dut.uart_rx with one 8N1 UART byte at CPB cycles per bit."""
        ctx.set(dut.uart_rx, 0)           # start bit
        for _ in range(CPB):
            await ctx.tick()
        for bit in range(8):              # data bits LSB-first
            ctx.set(dut.uart_rx, (byte >> bit) & 1)
            for _ in range(CPB):
                await ctx.tick()
        ctx.set(dut.uart_rx, 1)           # stop bit
        for _ in range(CPB):
            await ctx.tick()

    async def uart_send_bytes(ctx, dut, data):
        for b in data:
            await uart_send_byte(ctx, dut, b)

    dut = ChurchTangNano20K(
        clk_freq=16,
        baud=1,
        iot_profile=True,
        sim_mode=True,
        test_mode=True,
    )

    async def process(ctx):
        # Idle RX line high; configure test injection context.
        ctx.set(dut.uart_rx, 1)
        ctx.set(dut.test_outform_slot_id, SLOT_ID)
        ctx.set(dut.test_outform_clist_addr, CLIST_ADDR)
        ctx.set(dut.test_outform_gt_raw, 0)
        await ctx.tick()

        # Pulse outform_start for one cycle to bypass the CPU mLoad path.
        ctx.set(dut.test_outform_start, 1)
        await ctx.tick()
        ctx.set(dut.test_outform_start, 0)

        # Wait for TUNNEL_REQ (6 bytes × 160 cycles/byte) to finish.
        # The outform then enters TUNNEL_CONNECT waiting for any RX byte.
        for _ in range(CPB * 10 * 6 + CPB * 5):   # 960 + 80 margin = 1040 cycles
            await ctx.tick()

        # ── Connect byte → lean header → payload ──────────────────────────
        await uart_send_byte(ctx, dut, CONNECT_BYTE)
        await uart_send_bytes(ctx, dut, lean_hdr)
        await uart_send_bytes(ctx, dut, payload)

        # ── Wait for Mint FSM to complete and accumulate NS/clist writes ──
        ns_writes    = {}
        clist_writes = {}
        MAX_POST   = 500

        for _ in range(MAX_POST):
            await ctx.tick()
            if ctx.get(dut.dbg_ns_wr_en):
                addr = ctx.get(dut.dbg_ns_wr_addr)
                data = ctx.get(dut.dbg_ns_wr_data)
                ns_writes[addr] = data
            if ctx.get(dut.dbg_clist_wr_en):
                addr = ctx.get(dut.dbg_clist_wr_addr)
                data = ctx.get(dut.dbg_clist_wr_data)
                clist_writes[addr] = data
            if not ctx.get(dut.dbg_outform_busy):
                break
        else:
            raise AssertionError(
                f"Timeout: outform_busy never cleared within {MAX_POST} cycles\n"
                f"  ns_writes={ns_writes}  clist_writes={clist_writes}"
            )

        # ── Assertions ────────────────────────────────────────────────────
        # NS word 0 (alloc_base)
        ns_word0 = ns_writes.get(0)
        assert ns_word0 == ALLOC_BASE, (
            f"ns[slot*3+0]: got 0x{ns_word0:08X} want 0x{ALLOC_BASE:08X}"
        )

        # NS word 1 (W2)
        ns_word1 = ns_writes.get(4)
        assert ns_word1 == W2, (
            f"ns[slot*3+1] W2: got 0x{ns_word1:08X} want 0x{W2:08X}"
        )

        # NS word 2 (CRC16 seal)
        ns_word2 = ns_writes.get(8)
        assert ns_word2 == W3, (
            f"ns[slot*3+2] CRC16: got 0x{ns_word2:04X} want 0x{W3:04X}"
        )

        # clist E-GT: check address, then structural fields
        clist_e_gt = clist_writes.get(CLIST_ADDR)
        assert clist_e_gt is not None, (
            f"No clist write at addr {CLIST_ADDR}; got: {clist_writes}"
        )
        assert clist_e_gt == E_GT, (
            f"E-GT: got 0x{clist_e_gt:08X} want 0x{E_GT:08X}"
        )
        assert ((clist_e_gt >> 30) & 0x3) != 0, (
            f"E-GT has no permission bits set: 0x{clist_e_gt:08X}"
        )
        assert ((clist_e_gt >> 23) & 0x3) == GT_TYPE_INFORM, (
            f"E-GT type={(clist_e_gt>>23)&3} != GT_TYPE_INFORM={GT_TYPE_INFORM}"
        )
        assert (clist_e_gt & 0xFFFF) == SLOT_ID, (
            f"E-GT slot_id={clist_e_gt & 0xFFFF} != {SLOT_ID}"
        )

        print(
            f"  ns[slot*3+0]        = 0x{ns_word0:08X}  (alloc_base)\n"
            f"  ns[slot*3+1] (W2)   = 0x{ns_word1:08X}  "
            f"(gt_seq=1, limit_offset={LUMP_WORDS-1})\n"
            f"  ns[slot*3+2] (W3)   = 0x{ns_word2:04X}      "
            f"(CRC16 seal)\n"
            f"  clist[caller] (E-GT)= 0x{clist_e_gt:08X}  "
            f"(E-perm, Inform, seq=1, slot={SLOT_ID})"
        )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_toplevel.vcd"):
        sim.run()
    print("PASS: test_iot_lazy_load_toplevel")


# ── Fault-path helpers ────────────────────────────────────────────────────────

async def respond_alloc_fault_iot(ctx, dut):
    """Wait for alloc_req, then assert alloc_fault for one cycle."""
    for _ in range(MAX_TICKS):
        await ctx.tick()
        if ctx.get(dut.alloc_req):
            ctx.set(dut.alloc_fault, 1)
            await ctx.tick()
            ctx.set(dut.alloc_fault, 0)
            return
    raise AssertionError("respond_alloc_fault_iot: timed out waiting for alloc_req")


async def respond_mint_fault_iot(ctx, dut):
    """Wait for mint_call, then assert mint_fault in MINT_WAIT state."""
    for _ in range(MAX_TICKS + 1):
        if ctx.get(dut.mint_call):
            ctx.set(dut.mint_fault, 1)
            await ctx.tick()  # FSM: MINT → MINT_WAIT (mint_fault=1 held)
            await ctx.tick()  # FSM: MINT_WAIT → FAULT (mint_fault=1 visible)
            ctx.set(dut.mint_fault, 0)
            return
        await ctx.tick()
    raise AssertionError("respond_mint_fault_iot: timed out waiting for mint_call")


async def run_to_derive_n(ctx, dut, payload_len: int, crc32_val: int):
    """Common prefix: start outform, drain tunnel TX, send connect + lean header.

    payload_len and crc32_val are written verbatim into the 8-byte lean header;
    no correctness is assumed here — callers supply whatever they need to trigger
    the desired fault path.
    """
    ctx.set(dut.outform_start, 1)
    await ctx.tick()
    ctx.set(dut.outform_start, 0)

    await ack_tx_bytes(ctx, dut, TUNNEL_REQ_LEN)
    await send_bytes(ctx, dut, b"\xAC")

    lean_hdr = struct.pack("<II", payload_len & 0xFFFFFFFF, crc32_val & 0xFFFFFFFF)
    await send_bytes(ctx, dut, lean_hdr)


# ── Fault test 1: payload_len not 4-byte aligned → OUTFORM_FAULT_HDR ─────────

def test_iot_hdr_fault():
    """payload_len=257 (low 2 bits != 0) triggers OUTFORM_FAULT_HDR in DERIVE_N."""
    dut = ChurchOutformIoT()

    async def process(ctx):
        await run_to_derive_n(ctx, dut, payload_len=257, crc32_val=0)

        done, fault, ftype, _ = await wait_done(ctx, dut)
        assert fault == 1,                   f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_HDR,   f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_hdr_fault.vcd"):
        sim.run()
    print("PASS: test_iot_hdr_fault")


# ── Fault test 2: payload_len=260 (not power-of-2 word count) → OUTFORM_FAULT_HDR

def test_iot_bad_n():
    """payload_len=260 → 65 words, not a power of 2 → OUTFORM_FAULT_HDR."""
    dut = ChurchOutformIoT()

    async def process(ctx):
        await run_to_derive_n(ctx, dut, payload_len=260, crc32_val=0)

        done, fault, ftype, _ = await wait_done(ctx, dut)
        assert fault == 1,                   f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_HDR,   f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_bad_n.vcd"):
        sim.run()
    print("PASS: test_iot_bad_n")


# ── Fault test 3: correct header but wrong stored CRC → OUTFORM_FAULT_CRC32 ──

def test_iot_crc_mismatch():
    """Valid payload_len=256, but stored CRC differs from computed CRC → OUTFORM_FAULT_CRC32."""
    payload  = build_lump_payload()
    bad_crc  = 0xDEADC0DE
    dut      = ChurchOutformIoT()

    async def process(ctx):
        await run_to_derive_n(ctx, dut, payload_len=256, crc32_val=bad_crc)

        await wait_alloc_req(ctx, dut)
        await respond_alloc(ctx, dut, 0x400)
        await send_bytes(ctx, dut, payload)

        done, fault, ftype, _ = await wait_done(ctx, dut)
        assert fault == 1,                    f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_CRC32,  f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_crc_mismatch.vcd"):
        sim.run()
    print("PASS: test_iot_crc_mismatch")


# ── Fault test 4: alloc_fault asserted → OUTFORM_FAULT_ALLOC ─────────────────

def test_iot_alloc_fault():
    """alloc_fault asserted in ALLOC state → OUTFORM_FAULT_ALLOC."""
    payload  = build_lump_payload()
    lean_hdr = build_lean_header(payload)
    dut      = ChurchOutformIoT()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        await ack_tx_bytes(ctx, dut, TUNNEL_REQ_LEN)
        await send_bytes(ctx, dut, b"\xAC")
        await send_bytes(ctx, dut, lean_hdr)

        await respond_alloc_fault_iot(ctx, dut)

        done, fault, ftype, _ = await wait_done(ctx, dut)
        assert fault == 1,                    f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_ALLOC,  f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_alloc_fault.vcd"):
        sim.run()
    print("PASS: test_iot_alloc_fault")


# ── Fault test 5: mint_fault asserted → OUTFORM_FAULT_MINT ───────────────────

def test_iot_mint_fault():
    """mint_fault asserted in MINT_WAIT state → OUTFORM_FAULT_MINT."""
    payload  = build_lump_payload()
    lean_hdr = build_lean_header(payload)
    dut      = ChurchOutformIoT()

    async def process(ctx):
        ctx.set(dut.outform_start, 1)
        await ctx.tick()
        ctx.set(dut.outform_start, 0)

        await ack_tx_bytes(ctx, dut, TUNNEL_REQ_LEN)
        await send_bytes(ctx, dut, b"\xAC")
        await send_bytes(ctx, dut, lean_hdr)

        await wait_alloc_req(ctx, dut)
        await respond_alloc(ctx, dut, 0x400)
        await send_bytes(ctx, dut, payload)

        await respond_mint_fault_iot(ctx, dut)

        done, fault, ftype, _ = await wait_done(ctx, dut)
        assert fault == 1,                   f"expected fault, got done={done}"
        assert ftype == OUTFORM_FAULT_MINT,  f"fault_type=0x{ftype:02X}"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/outform_iot_mint_fault.vcd"):
        sim.run()
    print("PASS: test_iot_mint_fault")


if __name__ == "__main__":
    test_iot_lazy_load_golden()
    test_iot_lazy_load_integrated()
    test_iot_lazy_load_toplevel()
    test_iot_hdr_fault()
    test_iot_bad_n()
    test_iot_crc_mismatch()
    test_iot_alloc_fault()
    test_iot_mint_fault()
    print("\nAll ChurchOutformIoT tests passed.")
