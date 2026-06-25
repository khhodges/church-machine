"""hardware/test_wukong_cdc.py — CDC simulation tests for Wukong Ethernet glue logic

Proves two CDC paths in WukongXC7A100T:
  1. TX toggle synchronizer (sync → eth): ETH_TX_LEN writes produce exactly one
     mac.send pulse per write; no pulses are missed or duplicated.
  2. RX dual-clock Memory (eth write, sync read): frame data assembled in the
     eth domain is read back correctly in the sync domain after frame_rdy rises.

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


if __name__ == "__main__":
    test_tx_cdc()
    test_rx_cdc()
    print("All Wukong CDC simulation tests PASSED.")
