"""hardware/test_wukong_upload_fsm.py — RTL simulation tests for the UART upload FSM.

Exercises the 'u' (0x75) upload protocol from wukong_top.py using a minimal
``UploadFsmRig`` that embeds the exact same Amaranth FSM code (UPLOAD_LEN /
UPLOAD_DATA / UPLOAD_ACK) and the same UartRx/UartTx submodules.

Why two concurrent testbenches
──────────────────────────────
``ack_sent`` fires for exactly ONE simulation cycle: the cycle where UPLOAD_ACK
first sees ~uart_tx.busy and fires uart_tx.start.  That same sync edge also
transitions cmd_parser back to IDLE, so the second time ~uart_tx.busy is true
(UartTx DONE) upload_ack_req is already 0 and ack_sent doesn't re-fire.

In a sequential testbench, ``_send_uart_bytes`` returns ≈50 cycles AFTER this
pulse (the UartRx fires DONE for the last byte ≈50 cycles before the stop-bit
period that _send_uart_bytes drives finishes).  So a sequential testbench always
misses the pulse.

Fix: every test that needs to detect ACK emission uses TWO concurrent
testbenches — ``drive_rx`` (drives uart_rx_pin) and ``monitor_ack`` (watches
ack_sent from tick 0).  Tests that only need to verify ACK *absence* (zero-
length / oversized) use a sequential testbench with ack_sent_latch (which stays
HIGH once set) and a post-send timeout.

Tests:
  - Normal 4-word upload → correct DMEM writes + 0x06 ACK sent on TX
  - Multi-word upload (8 words) → all words written at correct addresses
  - Zero-length frame → FSM returns to IDLE, no ACK
  - Oversized frame (> DMEM capacity) → FSM returns to IDLE, no ACK
  - Non-word-aligned length (not a multiple of 4) → partial last word discarded,
    ACK still emitted after last byte is consumed
  - Second upload overwrites DMEM from the first upload

Simulation parameters: clk_freq=100, baud=1 → DIVISOR=100.
Each UART bit takes 100 cycles; a 10-bit byte frame takes 1000 cycles.

Run with:  python -m pytest hardware/test_wukong_upload_fsm.py -v
"""

import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, ROOT)

from amaranth import *
from amaranth.lib.memory import Memory
from amaranth.sim import Simulator

from hardware.uart_rx import UartRx
from hardware.uart_tx import UartTx


# ── Test-rig ──────────────────────────────────────────────────────────────────

class UploadFsmRig(Elaboratable):
    """Minimal RTL harness for the Wukong upload FSM.

    Contains:
      • UartRx / UartTx at configurable clk_freq / baud
      • A 256-word DMEM (read back via dmem_rd_addr / dmem_rd_data)
      • The exact upload FSM states (UPLOAD_LEN / UPLOAD_DATA / UPLOAD_ACK)
        from ChurchWukongXC7A100T — same Signal declarations, same
        combinatorial upload_wr_en / Cat() word assembly, same transition
        conditions.

    Extra output signals for testbench use (not present in the full top):
      • ``ack_sent``       — HIGH for exactly one cycle when ``uart_tx.start``
                             fires for the ACK byte.  A concurrent monitor
                             testbench must watch from tick 0 to catch it.
      • ``ack_sent_latch`` — sticky version: stays HIGH after ack_sent fires.
                             Safe to poll after _send_uart_bytes returns when
                             a sequential testbench is sufficient (e.g. absence
                             tests where NO ack should have occurred).
      • ``ack_byte``       — the data byte loaded into UartTx when ack_sent is
                             HIGH (always 0x06 for a correct implementation).
    """

    DMEM_DEPTH = 256          # 256 × 32-bit words = 1 KB (enough for all tests)
    MAX_BYTES  = DMEM_DEPTH * 4  # 1024

    def __init__(self, clk_freq=100, baud=1):
        self.clk_freq       = clk_freq
        self.baud           = baud
        self.uart_rx_pin    = Signal(init=1)   # UART RX (active-high idle)
        self.uart_tx_pin    = Signal(init=1)   # UART TX (active-high idle)
        # Testbench-driven DMEM read port
        self.dmem_rd_addr   = Signal(range(self.DMEM_DEPTH))
        self.dmem_rd_data   = Signal(32)
        # ACK-emission signals
        self.ack_sent       = Signal()         # 1 cycle HIGH when TX start fires
        self.ack_sent_latch = Signal()         # sticky: stays HIGH after ack_sent fires
        self.ack_byte       = Signal(8)        # byte being sent (always 0x06)
        # Halt-state signals — mirrors ChurchWukongXC7A100T.step_mode / .step_halted.
        # Set to 1 on 'u' reception; kept at 1 on all abort paths (fail-closed).
        self.step_mode      = Signal(init=0)
        self.step_halted    = Signal()

    def elaborate(self, platform):
        m = Module()

        # ── BRAM ──────────────────────────────────────────────────────────────
        dmem    = m.submodules.dmem = Memory(
            shape=unsigned(32), depth=self.DMEM_DEPTH, init=[])
        dmem_rd = dmem.read_port(domain="sync")
        dmem_wr = dmem.write_port()
        m.d.comb += [dmem_rd.addr.eq(self.dmem_rd_addr),
                     self.dmem_rd_data.eq(dmem_rd.data)]

        # ── UartRx / UartTx ───────────────────────────────────────────────────
        uart_rx = m.submodules.uart_rx = UartRx(
            clk_freq=self.clk_freq, baud=self.baud)
        uart_tx = m.submodules.uart_tx = UartTx(
            clk_freq=self.clk_freq, baud=self.baud)
        m.d.comb += [uart_rx.rx.eq(self.uart_rx_pin),
                     self.uart_tx_pin.eq(uart_tx.tx)]

        # ── Upload FSM signals — mirror ChurchWukongXC7A100T exactly ──────────
        up_len_bytes     = [Signal(8,  name=f"up_len_b{i}") for i in range(4)]
        up_len_cnt       = Signal(2)
        up_byte_cnt      = Signal(17)
        up_word_buf      = [Signal(8,  name=f"up_wb{i}") for i in range(3)]
        up_byte_in_word  = Signal(2)
        upload_wr_addr_r = Signal(range(self.DMEM_DEPTH))
        upload_wr_en     = Signal()
        upload_wr_addr   = Signal(range(self.DMEM_DEPTH))
        upload_wr_data   = Signal(32)
        upload_ack_req   = Signal()
        # Watchdog — mirrors the production RTL; threshold = 20 × one-byte period
        # 20 complete 8N1 byte periods (10 bit-periods each) — mirrors wukong_top.py.
        # clk_freq=100, baud=1: 1 byte = 10 × 100 = 1000 cycles; 20 bytes = 20 000.
        _WDG_LIMIT = max(self.clk_freq // self.baud * 10 * 20, 1000)
        upload_watchdog  = Signal(range(_WDG_LIMIT + 1))

        # ── DMEM write arbitration ────────────────────────────────────────────
        with m.If(upload_wr_en):
            m.d.comb += [
                dmem_wr.addr.eq(upload_wr_addr),
                dmem_wr.data.eq(upload_wr_data),
                dmem_wr.en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                dmem_wr.addr.eq(0),
                dmem_wr.data.eq(0),
                dmem_wr.en.eq(0),
            ]

        # ── UART TX arbitration — upload ACK only (no ChurchCore/banner) ──────
        # ack_sent fires for exactly ONE cycle: the cycle UPLOAD_ACK first sees
        # ~uart_tx.busy.  That same edge fires uart_tx.start (UartTx starts
        # transmitting) AND transitions cmd_parser to IDLE (upload_ack_req→0).
        # So there is no second pulse when UartTx finishes.
        ack_start = Signal()
        m.d.comb += [
            uart_tx.data.eq(0x06),
            ack_start.eq(upload_ack_req & ~uart_tx.busy),
            uart_tx.start.eq(ack_start),
            self.ack_sent.eq(ack_start),
            self.ack_byte.eq(uart_tx.data),
        ]
        # Sticky latch so sequential testbenches can poll after returning from
        # _send_uart_bytes (for absence checks: latch stays LOW → no ACK fired).
        with m.If(ack_start):
            m.d.sync += self.ack_sent_latch.eq(1)

        # ── Halt signals — aliases for class attributes ────────────────────────
        step_mode   = self.step_mode
        step_halted = self.step_halted

        # ── Upload FSM — identical states to ChurchWukongXC7A100T ─────────────
        with m.FSM(name="upload_fsm"):

            with m.State("IDLE"):
                with m.If(uart_rx.valid):
                    with m.Switch(uart_rx.data):
                        with m.Case(0x75):  # 'u' — start upload
                            # Mirror production: halt CM immediately on 'u'.
                            m.d.sync += [up_len_cnt.eq(0),
                                         step_mode.eq(1), step_halted.eq(1)]
                            m.next = "UPLOAD_LEN"

            with m.State("UPLOAD_LEN"):
                with m.If(uart_rx.valid):
                    m.d.sync += upload_watchdog.eq(0)
                    with m.Switch(up_len_cnt):
                        for _i in range(4):
                            with m.Case(_i):
                                m.d.sync += [up_len_bytes[_i].eq(uart_rx.data),
                                             up_len_cnt.eq(_i + 1)]
                    with m.If(up_len_cnt == 3):
                        m.next = "UPLOAD_LEN_COMMIT"
                with m.Else():
                    m.d.sync += upload_watchdog.eq(upload_watchdog + 1)
                    with m.If(upload_watchdog == _WDG_LIMIT - 1):
                        m.d.sync += upload_watchdog.eq(0)
                        m.next = "IDLE"

            with m.State("UPLOAD_LEN_COMMIT"):
                up_len_val = Signal(32, name="up_len_val")
                m.d.comb += up_len_val.eq(
                    Cat(up_len_bytes[3], up_len_bytes[2],
                        up_len_bytes[1], up_len_bytes[0]))
                with m.If((up_len_val == 0) | (up_len_val > self.MAX_BYTES)):
                    m.next = "IDLE"
                with m.Else():
                    m.d.sync += [
                        up_byte_cnt.eq(up_len_val[0:17]),
                        up_byte_in_word.eq(0),
                        upload_wr_addr_r.eq(0),
                    ]
                    m.next = "UPLOAD_DATA"

            with m.State("UPLOAD_DATA"):
                with m.If(uart_rx.valid):
                    m.d.sync += upload_watchdog.eq(0)
                    with m.Switch(up_byte_in_word):
                        with m.Case(0): m.d.sync += up_word_buf[0].eq(uart_rx.data)
                        with m.Case(1): m.d.sync += up_word_buf[1].eq(uart_rx.data)
                        with m.Case(2): m.d.sync += up_word_buf[2].eq(uart_rx.data)
                    with m.If(up_byte_in_word == 3):
                        m.d.comb += [
                            upload_wr_en.eq(1),
                            upload_wr_addr.eq(upload_wr_addr_r),
                            upload_wr_data.eq(
                                Cat(uart_rx.data, up_word_buf[2],
                                    up_word_buf[1], up_word_buf[0])),
                        ]
                        m.d.sync += upload_wr_addr_r.eq(upload_wr_addr_r + 1)
                    m.d.sync += up_byte_cnt.eq(up_byte_cnt - 1)
                    with m.If(up_byte_cnt == 1):
                        m.next = "UPLOAD_ACK"
                    with m.Else():
                        m.d.sync += up_byte_in_word.eq(
                            Mux(up_byte_in_word == 3, 0, up_byte_in_word + 1))
                with m.Else():
                    m.d.sync += upload_watchdog.eq(upload_watchdog + 1)
                    with m.If(upload_watchdog == _WDG_LIMIT - 1):
                        m.d.sync += upload_watchdog.eq(0)
                        m.next = "IDLE"

            with m.State("UPLOAD_ACK"):
                m.d.comb += upload_ack_req.eq(1)
                with m.If(~uart_tx.busy):
                    m.next = "IDLE"

        return m


# ── Simulation helpers ────────────────────────────────────────────────────────

_DIVISOR = 100   # clk_freq=100, baud=1  → 100 cycles per UART bit


async def _send_uart_bytes(ctx, rx_pin, data):
    """Drive rx_pin with 8N1-encoded bytes (active-high idle, LSB first)."""
    ctx.set(rx_pin, 1)
    await ctx.tick()
    await ctx.tick()
    for b in data:
        ctx.set(rx_pin, 0)                       # start bit
        for _ in range(_DIVISOR):
            await ctx.tick()
        for bit_idx in range(8):                 # 8 data bits, LSB first
            ctx.set(rx_pin, (b >> bit_idx) & 1)
            for _ in range(_DIVISOR):
                await ctx.tick()
        ctx.set(rx_pin, 1)                       # stop bit
        for _ in range(_DIVISOR):
            await ctx.tick()
    await ctx.tick()


async def _read_dmem_word(ctx, dut, word_addr):
    """Read one 32-bit word from DMEM (1-cycle registered latency)."""
    ctx.set(dut.dmem_rd_addr, word_addr)
    await ctx.tick()   # latch address
    await ctx.tick()   # data available
    return ctx.get(dut.dmem_rd_data)


def _upload_frame(words):
    """Bytes for a well-formed upload: 0x75 + 4-byte BE length + BE words."""
    payload = b''.join(struct.pack('>I', w) for w in words)
    return bytes([0x75]) + struct.pack('>I', len(payload)) + payload


def _sim_ticks_for(frame):
    """Upper-bound cycle count for receiving `frame` bytes through UartRx."""
    return len(frame) * _DIVISOR * 10 + 200


def _run_concurrent(dut, drive_fn, monitor_fn):
    """Run two concurrent testbenches on dut and return when both complete."""
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(drive_fn)
    sim.add_testbench(monitor_fn)
    with sim.write_vcd('/dev/null'):
        sim.run()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_upload_4_words_writes_dmem_and_acks():
    """Normal 4-word upload: DMEM[0..3] receive the correct big-endian words
    and ack_sent fires with ack_byte == 0x06."""
    words  = [0xDEADBEEF, 0xCAFEBABE, 0x00000001, 0x12345678]
    frame  = _upload_frame(words)
    dut    = UploadFsmRig()
    result = {'ack': False, 'byte': None, 'dmem': []}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(5000):   # hold idle so monitor can read DMEM
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 5000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack']  = True
                result['byte'] = ctx.get(dut.ack_byte)
                for i in range(4):
                    result['dmem'].append(await _read_dmem_word(ctx, dut, i))
                break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack'],  "ack_sent never fired for 4-word upload"
    assert result['byte'] == 0x06, (
        f"ACK byte should be 0x06, got 0x{result['byte']:02X}")
    assert result['dmem'] == words, (
        f"DMEM mismatch: {[hex(w) for w in result['dmem']]} "
        f"vs {[hex(w) for w in words]}")


def test_upload_8_words_all_at_correct_addresses():
    """8-word upload: all 8 words land at DMEM[0..7]."""
    words  = [0x10000001 + i for i in range(8)]
    frame  = _upload_frame(words)
    dut    = UploadFsmRig()
    result = {'ack': False, 'dmem': []}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(5000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 5000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack'] = True
                for i in range(8):
                    result['dmem'].append(await _read_dmem_word(ctx, dut, i))
                break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack'], "ack_sent never fired for 8-word upload"
    bad = [i for i, (a, b) in enumerate(zip(result['dmem'], words)) if a != b]
    assert not bad, f"DMEM mismatch at word indices {bad}"


def test_upload_zero_length_rejected_no_ack():
    """Zero-length frame: FSM transitions IDLE → UPLOAD_LEN_COMMIT → IDLE
    without entering UPLOAD_DATA, so ack_sent_latch stays LOW."""
    frame = bytes([0x75]) + struct.pack('>I', 0)
    dut   = UploadFsmRig()
    result = {'latch': None}

    async def tb(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(2000):
            await ctx.tick()
        # Read the latch value DURING the simulation via ctx.get()
        result['latch'] = ctx.get(dut.ack_sent_latch)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(tb)
    with sim.write_vcd('/dev/null'):
        sim.run()

    assert result['latch'] == 0, (
        f"ack_sent_latch was SET (value={result['latch']}) for a zero-length frame"
    )


def test_upload_zero_length_no_ack_via_monitor():
    """Zero-length frame: ack_sent never transitions from 0→1 (concurrent monitor)."""
    frame  = bytes([0x75]) + struct.pack('>I', 0)
    dut    = UploadFsmRig()
    result = {'ack_count': 0}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(2000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 2000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack_count'] += 1
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack_count'] == 0, (
        f"ack_sent fired {result['ack_count']} time(s) for a zero-length frame")


def test_upload_oversized_length_no_ack():
    """Length > MAX_BYTES: FSM rejects and returns to IDLE, ack_sent never fires."""
    oversized = UploadFsmRig.MAX_BYTES + 4
    frame     = bytes([0x75]) + struct.pack('>I', oversized)
    dut       = UploadFsmRig()
    result    = {'ack_count': 0}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(2000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 2000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack_count'] += 1
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack_count'] == 0, (
        f"ack_sent fired {result['ack_count']} time(s) for an oversized frame")


def test_upload_non_word_aligned_length_acks_anyway():
    """Length not a multiple of 4: the FSM consumes all declared bytes,
    discards the partial last word, and ack_sent fires after the final byte."""
    # 9 bytes = 2 complete words (8 bytes) + 1 partial byte
    words_bytes = (struct.pack('>I', 0xAAAAAAAA)
                   + struct.pack('>I', 0xBBBBBBBB)
                   + b'\xCC')
    frame  = bytes([0x75]) + struct.pack('>I', len(words_bytes)) + words_bytes
    dut    = UploadFsmRig()
    result = {'ack': False}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(3000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 3000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack'] = True
                break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack'], (
        "ack_sent never fired after non-word-aligned upload (should still ACK)")


def test_upload_second_upload_overwrites_first():
    """Two consecutive uploads: second upload overwrites DMEM from the first
    and fires ack_sent a second time."""
    first   = [0xAAAAAAAA, 0xBBBBBBBB]
    second  = [0x11111111, 0x22222222]
    f1, f2  = _upload_frame(first), _upload_frame(second)
    dut     = UploadFsmRig()
    result  = {'ack_count': 0, 'dmem': []}
    INTER   = 2000   # inter-upload idle cycles

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, f1)
        for _ in range(INTER):
            await ctx.tick()
        await _send_uart_bytes(ctx, dut.uart_rx_pin, f2)
        for _ in range(5000):   # hold for monitor to read DMEM
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        total = _sim_ticks_for(f1) + INTER + _sim_ticks_for(f2) + 5000
        for _ in range(total):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack_count'] += 1
                if result['ack_count'] == 2:
                    for i in range(2):
                        result['dmem'].append(await _read_dmem_word(ctx, dut, i))
                    break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack_count'] == 2, (
        f"Expected 2 ack_sent pulses, got {result['ack_count']}")
    assert result['dmem'] == second, (
        f"Second upload did not overwrite: {[hex(w) for w in result['dmem']]}")


def test_le_file_bytes_after_bridge_swap_land_correctly_in_dmem():
    """End-to-end endianness contract: LE boot-image bytes → bridge BE-swap
    → RTL upload FSM → DMEM values match the original LE word values.

    boot-image.bin is little-endian (struct.pack('<...I')).
    The RTL assembles the first received byte as DMEM-word MSByte (big-endian).
    The bridge must swap each 4-byte LE word to BE before UART transmission.
    This test verifies the complete contract:
        known_words  →  LE bytes (file)  →  BE bytes (bridge output)  →  DMEM == known_words
    """
    # Choose words that reveal byte-order bugs even in symmetric values
    known_words = [0xDEADBEEF, 0x12345678, 0xCAFEBABE, 0x80000001]
    le_bytes = struct.pack(f'<{len(known_words)}I', *known_words)

    # Bridge byte-swap: LE file bytes → BE wire bytes (mirrors _handle_upload)
    n        = len(le_bytes) // 4
    be_bytes = struct.pack(f'>{n}I', *struct.unpack(f'<{n}I', le_bytes[:n * 4]))
    # Build the upload frame with BE-swapped payload
    frame  = bytes([0x75]) + struct.pack('>I', len(be_bytes)) + be_bytes

    dut    = UploadFsmRig()
    result = {'ack': False, 'dmem': []}

    async def drive(ctx):
        await _send_uart_bytes(ctx, dut.uart_rx_pin, frame)
        for _ in range(5000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        for _ in range(_sim_ticks_for(frame) + 5000):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack'] = True
                for i in range(len(known_words)):
                    result['dmem'].append(await _read_dmem_word(ctx, dut, i))
                break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack'], "ack_sent never fired for endianness round-trip upload"
    assert result['dmem'] == known_words, (
        f"DMEM endianness mismatch — bridge LE→BE swap may be wrong.\n"
        f"  Expected: {[hex(w) for w in known_words]}\n"
        f"  Got:      {[hex(w) for w in result['dmem']]}"
    )


def test_upload_watchdog_aborts_truncated_frame():
    """Watchdog: if only the header arrives and payload bytes never come, the
    FSM should abort back to IDLE after _WDG_LIMIT cycles without an ACK.

    Sends magic + length-header for 4 words (16 bytes) then stops transmitting.
    Verifies that ack_sent never fires (no ACK for a truncated upload) and that
    a subsequent full upload completes correctly (FSM returned to IDLE).
    """
    # _WDG_LIMIT = clk_freq // baud * 10 * 20 = 100 * 10 * 20 = 20 000 cycles
    # (20 complete 8N1 byte periods; 1 byte = 10 bit-periods × 100 cycles/bit)
    dut    = UploadFsmRig()
    _WDG   = dut.clk_freq // dut.baud * 10 * 20   # 20 000 cycles
    result = {'ack_count': 0, 'second_ack': False, 'dmem': []}

    # Truncated header: 0x75 + 4-byte length saying 16 bytes, then silence
    truncated = bytes([0x75]) + struct.pack('>I', 16)   # no payload bytes

    # Full second upload (after watchdog recovery)
    words2 = [0xAABBCCDD, 0x11223344, 0x55667788, 0x99AABBCC]
    full   = _upload_frame(words2)

    truncated_ticks = _sim_ticks_for(truncated)
    watchdog_ticks  = _WDG + 500           # enough margin for the watchdog to fire
    full_ticks      = _sim_ticks_for(full)

    async def drive(ctx):
        # Send truncated frame then wait for watchdog to fire
        await _send_uart_bytes(ctx, dut.uart_rx_pin, truncated)
        for _ in range(watchdog_ticks):
            await ctx.tick()
        # Now send a valid second upload
        await _send_uart_bytes(ctx, dut.uart_rx_pin, full)
        for _ in range(5000):
            await ctx.tick()

    async def monitor(ctx):
        prev = 0
        total = truncated_ticks + watchdog_ticks + _sim_ticks_for(full) + 5000
        for _ in range(total):
            cur = ctx.get(dut.ack_sent)
            if cur and not prev:
                result['ack_count'] += 1
                if result['ack_count'] == 1:
                    # This should be the second upload's ACK (the first was truncated)
                    result['second_ack'] = True
                    for i in range(len(words2)):
                        result['dmem'].append(await _read_dmem_word(ctx, dut, i))
                    break
            prev = cur
            await ctx.tick()

    _run_concurrent(dut, drive, monitor)

    assert result['ack_count'] == 1, (
        f"Expected exactly 1 ACK (from the second upload after watchdog recovery), "
        f"got {result['ack_count']}"
    )
    assert result['second_ack'], "ACK fired but not from expected second upload"
    assert result['dmem'] == words2, (
        f"DMEM after watchdog recovery incorrect:\n"
        f"  expected {[hex(w) for w in words2]}\n"
        f"  got      {[hex(w) for w in result['dmem']]}"
    )


def test_upload_rig_elaborates():
    """Sanity check: UploadFsmRig elaborates to non-empty RTLIL."""
    from amaranth.back.rtlil import convert
    dut   = UploadFsmRig()
    rtlil = convert(dut, ports=[dut.uart_rx_pin, dut.uart_tx_pin,
                                 dut.dmem_rd_addr, dut.dmem_rd_data,
                                 dut.ack_sent, dut.ack_sent_latch, dut.ack_byte,
                                 dut.step_mode, dut.step_halted])
    assert len(rtlil) > 0, "RTLIL output is empty"


def test_full_top_elaborates_with_upload_signals():
    """ChurchWukongXC7A100T.elaborate() with upload signals declared before
    the UART TX mux — should produce valid RTLIL without UnboundLocalError."""
    from amaranth.back.rtlil import convert
    from hardware.wukong_top import ChurchWukongXC7A100T
    top   = ChurchWukongXC7A100T()
    rtlil = convert(top, ports=[top.clk, top.uart_tx_pin, top.uart_rx_pin,
                                 top.led[0], top.led[1],
                                 top.step_mode, top.step_halted])
    assert len(rtlil) > 0, "Full top-level RTLIL is empty"


# ── Production-top integration tests (use ChurchWukongXC7A100T directly) ─────
#
# These tests exercise the upload FSM in the actual production module so that
# the rig-vs-production divergence the reviewer identified is covered.
# They use clk_freq=100, baud=1 (same divisor as the rig) so _send_uart_bytes
# works without change.

def _run_top(drive_fn, monitor_fn):
    """Run two concurrent testbenches on a production ChurchWukongXC7A100T.

    sim_mode=True skips the `m.d.comb += ClockSignal("sync").eq(self.clk)`
    assignment so that sim.add_clock() can drive the sync domain directly
    without a DriverConflict (the physical clk pin is unused in simulation).
    """
    from hardware.wukong_top import ChurchWukongXC7A100T
    top = ChurchWukongXC7A100T(clk_freq=100, baud=1, sim_mode=True)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive_fn)
    sim.add_testbench(monitor_fn)
    with sim.write_vcd('/dev/null'):
        sim.run()
    return top


def test_production_top_upload_len_watchdog_keeps_halted():
    """Production top: UPLOAD_LEN watchdog abort must leave step_mode=1 and
    step_halted=1.

    Previously the RTL reset both to 0 on abort, allowing the CM to free-run
    with a partially-overwritten DMEM.  With the fail-closed fix, the CM stays
    halted and the bridge must send an explicit 'r' to resume execution.
    """
    from hardware.wukong_top import ChurchWukongXC7A100T
    top = ChurchWukongXC7A100T(clk_freq=100, baud=1, sim_mode=True)
    _WDG_TICKS = top.clk_freq // top.baud * 10 * 20   # 20 000 cycles

    result = {'step_mode_after': None, 'step_halted_after': None}

    async def drive(ctx):
        # Send the 'u' magic byte only — no length header follows.
        await _send_uart_bytes(ctx, top.uart_rx_pin, bytes([0x75]))
        # Wait well past the watchdog limit for it to fire.
        for _ in range(_WDG_TICKS + 1000):
            await ctx.tick()

    async def monitor(ctx):
        total = _sim_ticks_for(bytes([0x75])) + _WDG_TICKS + 1000
        for _ in range(total):
            await ctx.tick()
        result['step_mode_after']   = ctx.get(top.step_mode)
        result['step_halted_after'] = ctx.get(top.step_halted)

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(monitor)
    with sim.write_vcd('/dev/null'):
        sim.run()

    assert result['step_mode_after'] == 1, (
        f"Production top UPLOAD_LEN watchdog: step_mode={result['step_mode_after']} "
        f"(expected 1 — fail-closed: CM must stay halted after abort)")
    assert result['step_halted_after'] == 1, (
        f"Production top UPLOAD_LEN watchdog: step_halted={result['step_halted_after']} "
        f"(expected 1 — CM must stay halted so a free-run never starts with corrupt DMEM)")


def test_production_top_upload_len_commit_zero_length_keeps_halted():
    """Production top: UPLOAD_LEN_COMMIT zero-length rejection must leave
    step_mode=1 and step_halted=1.

    A zero-length upload frame is rejected before any DMEM write.  The CM must
    stay halted so the bridge can report the error and let the user retry.
    """
    from hardware.wukong_top import ChurchWukongXC7A100T
    top = ChurchWukongXC7A100T(clk_freq=100, baud=1, sim_mode=True)

    # Frame: magic byte + 4-byte BE zero length
    zero_frame = bytes([0x75]) + struct.pack('>I', 0)
    result = {'step_mode_after': None, 'step_halted_after': None}

    async def drive(ctx):
        await _send_uart_bytes(ctx, top.uart_rx_pin, zero_frame)
        for _ in range(2000):
            await ctx.tick()

    async def monitor(ctx):
        for _ in range(_sim_ticks_for(zero_frame) + 2000):
            await ctx.tick()
        result['step_mode_after']   = ctx.get(top.step_mode)
        result['step_halted_after'] = ctx.get(top.step_halted)

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(monitor)
    with sim.write_vcd('/dev/null'):
        sim.run()

    assert result['step_mode_after'] == 1, (
        f"Production top zero-length: step_mode={result['step_mode_after']} "
        f"(expected 1 — CM must stay halted on malformed frame)")
    assert result['step_halted_after'] == 1, (
        f"Production top zero-length: step_halted={result['step_halted_after']} "
        f"(expected 1)")


def test_production_top_upload_data_watchdog_keeps_halted():
    """Production top: UPLOAD_DATA watchdog abort must leave step_mode=1 and
    step_halted=1.

    Sends a valid header (declaring 8 bytes) then only 1 data byte.  The
    UPLOAD_DATA watchdog fires when no further bytes arrive.  The CM must stay
    halted — a partial DMEM write with the remaining 7 bytes missing leaves
    DMEM in an inconsistent state that could fault or execute garbage.
    """
    from hardware.wukong_top import ChurchWukongXC7A100T
    top = ChurchWukongXC7A100T(clk_freq=100, baud=1, sim_mode=True)
    _WDG_TICKS = top.clk_freq // top.baud * 10 * 20   # 20 000 cycles

    # Valid header for 8 bytes, then only 1 data byte (truncated)
    truncated = bytes([0x75]) + struct.pack('>I', 8) + bytes([0xAA])
    result = {'step_mode_after': None, 'step_halted_after': None}

    async def drive(ctx):
        await _send_uart_bytes(ctx, top.uart_rx_pin, truncated)
        # Wait for watchdog to fire in UPLOAD_DATA state
        for _ in range(_WDG_TICKS + 1000):
            await ctx.tick()

    async def monitor(ctx):
        total = _sim_ticks_for(truncated) + _WDG_TICKS + 1000
        for _ in range(total):
            await ctx.tick()
        result['step_mode_after']   = ctx.get(top.step_mode)
        result['step_halted_after'] = ctx.get(top.step_halted)

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(monitor)
    with sim.write_vcd('/dev/null'):
        sim.run()

    assert result['step_mode_after'] == 1, (
        f"Production top UPLOAD_DATA watchdog: step_mode={result['step_mode_after']} "
        f"(expected 1 — partial DMEM write: CM must not free-run)")
    assert result['step_halted_after'] == 1, (
        f"Production top UPLOAD_DATA watchdog: step_halted={result['step_halted_after']} "
        f"(expected 1)")


if __name__ == '__main__':
    import sys
    tests = [
        test_upload_rig_elaborates,
        test_full_top_elaborates_with_upload_signals,
        test_upload_4_words_writes_dmem_and_acks,
        test_upload_8_words_all_at_correct_addresses,
        test_upload_zero_length_rejected_no_ack,
        test_upload_zero_length_no_ack_via_monitor,
        test_upload_oversized_length_no_ack,
        test_upload_non_word_aligned_length_acks_anyway,
        test_upload_second_upload_overwrites_first,
    ]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f'PASS  {t.__name__}')
            passed += 1
        except Exception as exc:
            import traceback
            print(f'FAIL  {t.__name__}: {exc}')
            traceback.print_exc()
            failed += 1
    print(f'\n{passed} passed, {failed} failed')
    sys.exit(0 if failed == 0 else 1)
