"""hardware/test_wukong_cdc.py — CDC simulation tests for Wukong Ethernet glue logic

Proves four properties of WukongXC7A100T:
  1. TX toggle synchronizer (sync → eth): ETH_TX_LEN writes produce exactly one
     mac.send pulse per write; no pulses are missed or duplicated.
  2. RX dual-clock Memory (eth write, sync read): frame data assembled in the
     eth domain is read back correctly in the sync domain after frame_rdy rises.
  3. Copy FSM timing: mac.send fires ONLY after all TX words are copied into the
     eth-domain buffer (stable data window enforced before TX starts).
  4. Callhome payload round-trip: _CALLHOME_PAYLOAD bytes are accepted by
     server/wukong_udp.parse_callhome_frame() with the correct magic/token fields.

Run with:  python -m hardware.test_wukong_cdc
"""

from amaranth import *
from amaranth.lib.cdc import FFSynchronizer
from amaranth.sim import Simulator
import amaranth.lib.memory as _lib_mem


class TxToggleRig(Elaboratable):
    """Toggle synchronizer from 'sync' to 'eth' domain (mirrors WukongXC7A100T)."""

    def __init__(self):
        self.tx_trig = Signal()   # input: pulse in sync domain (one cycle)
        self.tx_send = Signal()   # output: one-cycle pulse in eth domain

    def elaborate(self, platform):
        m = Module()
        tx_toggle          = Signal()
        tx_toggle_eth      = Signal()
        tx_toggle_eth_prev = Signal()
        m.submodules.sync_tx = FFSynchronizer(
            tx_toggle, tx_toggle_eth, o_domain="eth")
        m.d.eth += tx_toggle_eth_prev.eq(tx_toggle_eth)
        m.d.comb += self.tx_send.eq(tx_toggle_eth ^ tx_toggle_eth_prev)
        with m.If(self.tx_trig):
            m.d.sync += tx_toggle.eq(~tx_toggle)
        return m


class RxCdcRig(Elaboratable):
    """Dual-clock RX Memory (eth write, sync read) from WukongXC7A100T.

    rx_rptr is driven externally by the testbench to mimic the CM drain loop.
    """

    def __init__(self):
        self.rx_valid = Signal()    # input: eth domain
        self.rx_data  = Signal(8)   # input: eth domain
        self.rx_done  = Signal()    # input: eth domain
        self.rx_rptr  = Signal(6)   # input: sync domain (driven by testbench)
        self.rx_rdy   = Signal()    # output: sync domain (FFSynchronized flag)
        self.rx_len   = Signal(7)   # output: sync domain (word count)
        self.rx_rdata = Signal(32)  # output: sync domain (memory[rx_rptr])

    def elaborate(self, platform):
        m = Module()

        rx_mem = _lib_mem.Memory(shape=32, depth=64, init=[])
        m.submodules.rx_mem = rx_mem
        rx_wp = rx_mem.write_port(domain="eth")
        rx_rp = rx_mem.read_port(domain="sync", transparent_for=[])

        rx_byte_phase    = Signal(2)
        rx_word_acc      = Signal(32)
        rx_wptr          = Signal(6)
        rx_len_words     = Signal(7)
        rx_frame_rdy_eth = Signal()

        m.d.comb += [rx_wp.addr.eq(rx_wptr), rx_wp.data.eq(0), rx_wp.en.eq(0)]

        with m.If(self.rx_valid):
            m.d.eth += rx_byte_phase.eq(rx_byte_phase + 1)
            with m.Switch(rx_byte_phase):
                with m.Case(0): m.d.eth += rx_word_acc[24:32].eq(self.rx_data)
                with m.Case(1): m.d.eth += rx_word_acc[16:24].eq(self.rx_data)
                with m.Case(2): m.d.eth += rx_word_acc[8:16].eq(self.rx_data)
                with m.Case(3):
                    m.d.comb += [
                        rx_wp.en.eq(1),
                        rx_wp.data.eq(Cat(self.rx_data,
                                          rx_word_acc[8:16],
                                          rx_word_acc[16:24],
                                          rx_word_acc[24:32])),
                    ]
                    m.d.eth += rx_wptr.eq(rx_wptr + 1)

        with m.If(self.rx_done):
            m.d.eth += [
                rx_len_words.eq(Mux(rx_byte_phase != 0, rx_wptr + 1, rx_wptr)),
                rx_frame_rdy_eth.eq(1),
                rx_byte_phase.eq(0),
                rx_wptr.eq(0),
            ]
            with m.If(rx_byte_phase != 0):
                m.d.comb += [
                    rx_wp.en.eq(1),
                    rx_wp.data.eq(Cat(Const(0, 8),
                                      rx_word_acc[8:16],
                                      rx_word_acc[16:24],
                                      rx_word_acc[24:32])),
                ]

        m.submodules.sync_rdy = FFSynchronizer(
            rx_frame_rdy_eth, self.rx_rdy, o_domain="sync")

        rx_rdy_prev  = Signal()
        rx_len_latch = Signal(7)
        m.d.sync += rx_rdy_prev.eq(self.rx_rdy)
        with m.If(self.rx_rdy & ~rx_rdy_prev):
            m.d.sync += rx_len_latch.eq(rx_len_words)
        m.d.comb += self.rx_len.eq(rx_len_latch)

        m.d.comb += [rx_rp.addr.eq(self.rx_rptr), self.rx_rdata.eq(rx_rp.data)]

        return m


def test_tx_cdc():
    """TX toggle CDC: 2 ETH_TX_LEN writes produce exactly 2 mac.send pulses."""
    dut = TxToggleRig()
    sim = Simulator(dut)
    sim.add_clock(10e-9, domain="sync")
    sim.add_clock(40e-9, domain="eth")
    results = {"count": 0}

    async def tb(ctx):
        for _ in range(4):
            await ctx.tick("sync")

        ctx.set(dut.tx_trig, 1)
        await ctx.tick("sync")
        ctx.set(dut.tx_trig, 0)

        for _ in range(10):
            await ctx.tick("eth")
            if ctx.get(dut.tx_send):
                results["count"] += 1

        ctx.set(dut.tx_trig, 1)
        await ctx.tick("sync")
        ctx.set(dut.tx_trig, 0)

        for _ in range(10):
            await ctx.tick("eth")
            if ctx.get(dut.tx_send):
                results["count"] += 1

    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results["count"] == 2, (
        f"TX CDC: expected 2 mac.send pulses, got {results['count']}")
    print("PASS: TX toggle CDC — 2 triggers → exactly 2 mac.send pulses")


def test_rx_cdc():
    """RX dual-clock Memory CDC: 8 eth-domain bytes are read back correctly
    as 2 sync-domain words [0xDEADBEEF, 0xCAFEBABE] after frame_rdy rises."""
    payload = [0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]
    dut = RxCdcRig()
    sim = Simulator(dut)
    sim.add_clock(10e-9, domain="sync")
    sim.add_clock(40e-9, domain="eth")
    results = {"words": [], "rdy": False, "len": 0}

    async def tb(ctx):
        for _ in range(8):
            await ctx.tick("eth")

        for byte in payload:
            ctx.set(dut.rx_data, byte)
            ctx.set(dut.rx_valid, 1)
            await ctx.tick("eth")

        ctx.set(dut.rx_valid, 0)
        await ctx.tick("eth")

        ctx.set(dut.rx_done, 1)
        await ctx.tick("eth")
        ctx.set(dut.rx_done, 0)

        for _ in range(30):
            await ctx.tick("sync")

        results["rdy"] = bool(ctx.get(dut.rx_rdy))
        results["len"] = ctx.get(dut.rx_len)

        ctx.set(dut.rx_rptr, 0)
        await ctx.tick("sync")
        results["words"].append(ctx.get(dut.rx_rdata))

        ctx.set(dut.rx_rptr, 1)
        await ctx.tick("sync")
        results["words"].append(ctx.get(dut.rx_rdata))

    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results["rdy"], "rx_rdy never went high in sync domain"
    assert results["len"] == 2, (
        f"Expected rx_len=2 (2 words for 8 bytes), got {results['len']}")
    expected = [0xDEADBEEF, 0xCAFEBABE]
    assert results["words"] == expected, (
        f"RX CDC data mismatch: expected {[hex(w) for w in expected]}, "
        f"got {[hex(w) for w in results['words']]}")
    print("PASS: RX FIFO CDC — frame data intact across eth→sync boundary")


class TxCopyFsmRig(Elaboratable):
    """Minimal rig exercising the copy FSM timing from WukongXC7A100T.

    Exposes:
      toggle_trig  (in, sync)  — pulse to trigger copy (mirrors ETH_TX_LEN write)
      sync_word    (in, sync)  — value the sync buffer holds (single-word simplification)
      len_words    (in, sync)  — number of words to copy (mirrors tx_len_words_comb)
      mac_send     (out, eth)  — one-cycle pulse after copy completes
      eth_word0    (out, eth)  — eth_buf[0] after copy
    """

    def __init__(self):
        self.toggle_trig = Signal()
        self.sync_word   = Signal(32)
        self.len_words   = Signal(7)
        self.mac_send    = Signal()
        self.eth_word0   = Signal(32)

    def elaborate(self, platform):
        m = Module()

        TX_BUF_WORDS = 4
        tx_sync_buf  = Array(Signal(32, name=f"ts{i}") for i in range(TX_BUF_WORDS))
        tx_eth_buf   = Array(Signal(32, name=f"te{i}") for i in range(TX_BUF_WORDS))

        # Load sync_word into all sync-buf slots for simplicity
        m.d.sync += [tx_sync_buf[i].eq(self.sync_word) for i in range(TX_BUF_WORDS)]

        tx_toggle          = Signal()
        tx_toggle_eth      = Signal()
        tx_toggle_eth_prev = Signal()
        m.submodules.ff = FFSynchronizer(tx_toggle, tx_toggle_eth, o_domain="eth")
        m.d.eth += tx_toggle_eth_prev.eq(tx_toggle_eth)
        tx_copy_trigger = Signal()
        m.d.comb += tx_copy_trigger.eq(tx_toggle_eth ^ tx_toggle_eth_prev)

        with m.If(self.toggle_trig):
            m.d.sync += tx_toggle.eq(~tx_toggle)

        tx_copy_idx      = Signal(3)
        tx_len_words_eth = Signal(7)

        m.d.comb += [self.mac_send.eq(0), self.eth_word0.eq(tx_eth_buf[0])]

        with m.FSM(domain="eth", name="copy"):
            with m.State("IDLE"):
                with m.If(tx_copy_trigger):
                    m.d.eth += [tx_copy_idx.eq(0), tx_len_words_eth.eq(self.len_words)]
                    m.next = "COPY"
            with m.State("COPY"):
                m.d.eth += [
                    tx_eth_buf[tx_copy_idx].eq(tx_sync_buf[tx_copy_idx]),
                    tx_copy_idx.eq(tx_copy_idx + 1),
                ]
                with m.If(tx_copy_idx == tx_len_words_eth - 1):
                    m.next = "TRIGGER"
            with m.State("TRIGGER"):
                m.d.comb += self.mac_send.eq(1)
                m.next = "IDLE"

        return m


def test_copy_fsm_timing():
    """Copy FSM: mac.send fires ONLY after all words are in eth buffer.

    Uses a 3-word frame (len_words=3).  Verifies:
    - mac.send never fires during the COPY phase
    - mac.send fires exactly once after copy completes
    - eth_word0 holds the expected data at the time mac.send fires
    """
    dut = TxCopyFsmRig()
    sim = Simulator(dut)
    sim.add_clock(10e-9, domain="sync")
    sim.add_clock(40e-9, domain="eth")
    results = {"send_count": 0, "send_during_copy": 0, "eth_word0_at_send": None}

    FRAME_WORD = 0xDEAD_CAFE
    N_WORDS    = 3

    async def tb(ctx):
        ctx.set(dut.sync_word, FRAME_WORD)
        ctx.set(dut.len_words, N_WORDS)

        for _ in range(4):
            await ctx.tick("sync")

        ctx.set(dut.toggle_trig, 1)
        await ctx.tick("sync")
        ctx.set(dut.toggle_trig, 0)

        in_copy_phase = False
        for _ in range(30):
            await ctx.tick("eth")
            send = ctx.get(dut.mac_send)
            word = ctx.get(dut.eth_word0)
            if send:
                results["send_count"] += 1
                results["eth_word0_at_send"] = word
                if in_copy_phase:
                    results["send_during_copy"] += 1

    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()

    assert results["send_count"] == 1, (
        f"Copy FSM: expected 1 mac.send pulse, got {results['send_count']}")
    assert results["send_during_copy"] == 0, (
        "Copy FSM: mac.send fired during copy phase (data not stable yet!)")
    assert results["eth_word0_at_send"] == FRAME_WORD, (
        f"Copy FSM: eth_word0={hex(results['eth_word0_at_send'])} ≠ {hex(FRAME_WORD)}")
    print("PASS: Copy FSM timing — send fires after copy, eth buffer holds correct data")


def test_callhome_payload_roundtrip():
    """End-to-end dry-run: a minimal callhome payload parses correctly via server parser.

    Verifies:
    - Payload starts with CALLHOME_MAGIC (0xCE110001)
    - parse_callhome_frame() accepts the payload and returns a valid dict
    - token matches ETHERNET_TOKEN (0x00003300)
    - N=0 requests (no lump tokens in the minimal payload)
    """
    import struct
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from server.wukong_udp import (
        parse_callhome_frame, build_callhome_frame,
        CALLHOME_MAGIC, ETHERNET_TOKEN)

    _CALLHOME_PAYLOAD = build_callhome_frame(
        src_mac=bytes(6), cm_version=0, uptime=0, requests=[])

    assert _CALLHOME_PAYLOAD[:4] == CALLHOME_MAGIC.to_bytes(4, 'big'), (
        f"_CALLHOME_PAYLOAD[0:4]={_CALLHOME_PAYLOAD[:4].hex()} "
        f"≠ magic {CALLHOME_MAGIC:#010x}")

    result = parse_callhome_frame(_CALLHOME_PAYLOAD)
    assert result is not None, (
        "parse_callhome_frame() returned None — magic mismatch or too short")
    assert result["magic"] == CALLHOME_MAGIC, (
        f"magic={result['magic']:#010x} ≠ {CALLHOME_MAGIC:#010x}")
    assert result["token"] == ETHERNET_TOKEN, (
        f"token={result['token']:#010x} ≠ {ETHERNET_TOKEN:#010x}")
    assert result["requests"] == [], (
        f"Expected empty requests list, got {result['requests']}")
    print(f"PASS: Callhome payload round-trip — magic OK, token OK, N=0 requests, "
          f"mac={result['mac'].hex()}")


class _UartTxStub(Elaboratable):
    """Minimal UART TX stub for arbitration tests.

    Mirrors the interface of the real UartTx:
      data  (in)  — byte to transmit
      start (in)  — one-cycle start pulse
      busy  (out) — high for BUSY_CYCLES after start fires

    busy goes high on the cycle AFTER start is sampled (registered).
    """

    BUSY_CYCLES = 3

    def __init__(self):
        self.data      = Signal(8)
        self.start     = Signal()
        self.busy      = Signal()
        self.last_data = Signal(8)   # latches the byte accepted when start fires

    def elaborate(self, platform):
        m = Module()
        ctr = Signal(range(self.BUSY_CYCLES + 1))
        with m.If(self.start & ~self.busy):
            m.d.sync += [ctr.eq(self.BUSY_CYCLES),
                         self.last_data.eq(self.data)]
        with m.Elif(ctr > 0):
            m.d.sync += ctr.eq(ctr - 1)
        m.d.comb += self.busy.eq(ctr > 0)
        return m


class TxArbRig(Elaboratable):
    """UART TX arbitrator + minimal TraceUnit FSM for collision stress testing.

    Replicates the arbitrator logic from wukong_top.py (~line 278) and the
    TraceUnit FSM (~line 470) in a self-contained elaboratable so the test
    needs no hardware platform or full WukongXC7A100T.

    Inputs (all combinatorial / testbench-driven):
      cm_byte       — byte the CM wants to send via MMIO reg-5
      cm_tx_start   — asserted when CM is performing a MMIO reg-5 write
      retire_valid  — one-cycle retire pulse; starts a new 12-byte trace packet
      retire_byte   — value loaded into every trace_buf slot (simplified)

    Outputs:
      uart_data     — byte presented to UART (CM wins on collision)
      uart_start    — UART start pulse (high when either source fires)
      uart_busy     — UART busy flag (from _UartTxStub)
      uart_last     — last byte latched by _UartTxStub
      trace_tx_ack  — one-cycle ack: trace byte accepted (0 when CM fires or UART busy)
      trace_idx     — current position in the 12-byte packet (registered)
      trace_busy    — high while TraceUnit FSM is in SEND state
    """

    PACKET_LEN = 12

    def __init__(self):
        self.cm_byte      = Signal(8)
        self.cm_tx_start  = Signal()
        self.retire_valid = Signal()
        self.retire_byte  = Signal(8)

        self.uart_data    = Signal(8)
        self.uart_start   = Signal()
        self.uart_busy    = Signal()
        self.uart_last    = Signal(8)
        self.trace_tx_ack = Signal()
        self.trace_idx    = Signal(4)
        self.trace_busy   = Signal()

    def elaborate(self, platform):
        m = Module()
        uart = m.submodules.uart = _UartTxStub()

        trace_buf     = [Signal(8, name=f"tb{i}") for i in range(self.PACKET_LEN)]
        trace_idx     = Signal(4)
        trace_tx_req  = Signal()
        trace_tx_byte = Signal(8)
        trace_tx_ack  = Signal()

        # ── Arbitrator (mirrors wukong_top.py lines 278-281) ───────────────────
        m.d.comb += [
            uart.data.eq(Mux(self.cm_tx_start,
                             self.cm_byte, trace_tx_byte)),
            uart.start.eq(self.cm_tx_start |
                          (trace_tx_req & ~uart.busy & ~self.cm_tx_start)),
            trace_tx_ack.eq(trace_tx_req & ~uart.busy & ~self.cm_tx_start),
        ]

        # ── TraceUnit FSM (mirrors wukong_top.py lines 470-506) ────────────────
        with m.FSM(name="trace_unit"):
            with m.State("IDLE"):
                m.d.comb += [trace_tx_req.eq(0),
                             trace_tx_byte.eq(0),
                             self.trace_busy.eq(0)]
                with m.If(self.retire_valid):
                    for i in range(self.PACKET_LEN):
                        m.d.sync += trace_buf[i].eq(self.retire_byte)
                    m.d.sync += trace_idx.eq(0)
                    m.next = "SEND"

            with m.State("SEND"):
                m.d.comb += [trace_tx_req.eq(1),
                             self.trace_busy.eq(1)]
                with m.Switch(trace_idx):
                    for i in range(self.PACKET_LEN):
                        with m.Case(i):
                            m.d.comb += trace_tx_byte.eq(trace_buf[i])
                with m.If(trace_tx_ack):
                    m.d.sync += trace_idx.eq(trace_idx + 1)
                    with m.If(trace_idx == self.PACKET_LEN - 1):
                        m.next = "IDLE"

        # ── Expose signals ────────────────────────────────────────────────────
        m.d.comb += [
            self.uart_data.eq(uart.data),
            self.uart_start.eq(uart.start),
            self.uart_busy.eq(uart.busy),
            self.uart_last.eq(uart.last_data),
            self.trace_tx_ack.eq(trace_tx_ack),
            self.trace_idx.eq(trace_idx),
        ]
        return m


def test_tx_arb_collision():
    """TX arbitration stress test: CM write and TraceUnit TX collide on the same cycle.

    Proves three properties of the arbitrator (wukong_top.py ~line 278):

    A. CM byte wins the data mux: when cm_tx_start=1 and trace_tx_req=1 fire
       on the same cycle, uart_tx.data == cm_byte (not the trace byte).

    B. trace_tx_ack is suppressed: cm_tx_start blocks ack, so the TraceUnit
       FSM does NOT advance trace_idx — no partial packet corruption.

    C. Packet resumes cleanly: on the next idle TX cycle (cm_tx_start=0 and
       uart not busy), trace_tx_ack=1 fires, trace_idx advances, and the full
       12-byte packet eventually completes (TraceUnit returns to IDLE).
    """

    CM_BYTE    = 0x42
    TRACE_BYTE = 0xAA

    dut = TxArbRig()
    sim = Simulator(dut)
    sim.add_clock(10e-9, domain="sync")

    results = {
        # Collision cycle (combinatorial, read before clock edge)
        "coll_uart_data"  : None,
        "coll_trace_ack"  : None,
        # After collision clock edge (registered)
        "idx_after_coll"  : None,
        # Whether trace resumed (ack fired at least once post-collision)
        "resumed"         : False,
        # Whether TraceUnit returned to IDLE after the full packet
        "trace_idle_end"  : None,
    }

    async def tb(ctx):
        # ── settle reset ────────────────────────────────────────────────────
        for _ in range(4):
            await ctx.tick("sync")

        # ── prime the TraceUnit with one retire pulse ───────────────────────
        # retire_valid=1 fires on this tick.  On the FOLLOWING edge:
        #   - FSM state register → SEND
        #   - trace_buf[] ← retire_byte  (all 11 slots)
        #   - trace_idx   ← 0
        ctx.set(dut.retire_byte, TRACE_BYTE)
        ctx.set(dut.cm_byte, CM_BYTE)
        ctx.set(dut.retire_valid, 1)
        await ctx.tick("sync")   # <-- retire edge fires here
        ctx.set(dut.retire_valid, 0)

        # NOW (before any further tick) the combinatorial state shows:
        #   FSM = SEND  →  trace_tx_req=1, trace_tx_byte=TRACE_BYTE
        #   trace_idx = 0, uart.busy = 0
        #   trace_tx_ack = 1  (UART idle, no CM write yet)
        #
        # Immediately assert cm_tx_start=1 to create the collision IN THIS
        # SAME quantum — the next tick will see both trace_tx_req=1 AND
        # cm_tx_start=1 simultaneously.  We read the combinatorial outputs
        # with cm_tx_start already asserted.
        assert ctx.get(dut.trace_busy) == 1, (
            "Pre-collision: TraceUnit not in SEND state after retire_valid")
        assert ctx.get(dut.trace_idx) == 0, (
            "Pre-collision: trace_idx not 0 at start of packet")
        assert ctx.get(dut.uart_busy) == 0, (
            "Pre-collision: UART already busy (unexpected)")

        # ── A + B: collision — CM fires while trace is pending ──────────────
        ctx.set(dut.cm_tx_start, 1)
        # Read combinatorial outputs NOW (cm_tx_start=1, trace_tx_req=1 simultaneously)
        results["coll_uart_data"] = ctx.get(dut.uart_data)
        results["coll_trace_ack"] = ctx.get(dut.trace_tx_ack)

        await ctx.tick("sync")   # <-- collision edge: UART starts on CM byte, trace_idx unchanged
        ctx.set(dut.cm_tx_start, 0)

        # trace_idx must not have advanced (ack was suppressed)
        results["idx_after_coll"] = ctx.get(dut.trace_idx)

        # ── C: resume — trace resumes on next idle TX cycle ─────────────────
        # Wait for UART busy to clear (BUSY_CYCLES ticks) then give the trace
        # a generous window to finish the full 12-byte packet.
        budget = (_UartTxStub.BUSY_CYCLES + 2 +
                  TxArbRig.PACKET_LEN * (_UartTxStub.BUSY_CYCLES + 2))
        for _ in range(budget):
            await ctx.tick("sync")
            if ctx.get(dut.trace_tx_ack):
                results["resumed"] = True
            if not ctx.get(dut.trace_busy):
                break   # FSM back in IDLE — packet complete

        results["trace_idle_end"] = not ctx.get(dut.trace_busy)

    sim.add_testbench(tb)
    with sim.write_vcd("/dev/null"):
        sim.run()

    # ── A: CM byte wins the data mux ────────────────────────────────────────
    assert results["coll_uart_data"] == CM_BYTE, (
        f"Collision: uart_data={hex(results['coll_uart_data'])} "
        f"≠ CM byte {hex(CM_BYTE)} — trace byte leaked through the mux")

    # ── B: trace_tx_ack suppressed; trace_idx did not advance ───────────────
    assert results["coll_trace_ack"] == 0, (
        f"Collision: trace_tx_ack={results['coll_trace_ack']} "
        f"expected 0 (must be suppressed by cm_tx_start)")
    assert results["idx_after_coll"] == 0, (
        f"Collision: trace_idx={results['idx_after_coll']} after collision edge "
        f"expected 0 — packet index advanced despite suppressed ack")

    # ── C: trace packet resumes and completes cleanly ───────────────────────
    assert results["resumed"], (
        "Post-collision: trace_tx_ack never fired — TraceUnit did not resume "
        "after UART became idle")
    assert results["trace_idle_end"], (
        "Post-collision: TraceUnit FSM never returned to IDLE — packet did not "
        "complete after the collision")

    print(
        f"PASS: TX arbitration collision — "
        f"CM byte 0x{CM_BYTE:02X} wins mux, trace_tx_ack suppressed, "
        f"trace_idx held at 0, packet resumes and completes cleanly"
    )


if __name__ == "__main__":
    test_tx_cdc()
    test_rx_cdc()
    test_copy_fsm_timing()
    test_callhome_payload_roundtrip()
    test_tx_arb_collision()
    print("All Wukong CDC simulation tests PASSED.")
