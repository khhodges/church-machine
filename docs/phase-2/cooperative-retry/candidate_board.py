"""Wukong V3 pin/clock/UART connection for the new 128 KiB candidate.

Not the historical CombinedStarterBoard and not a qualified final test image.
Only CSI3 stopped installation is connected here; runtime services remain an
explicit integration boundary, not fake peripheral responses.
"""
from amaranth import ClockDomain, ClockSignal, Elaboratable, Module, Signal
from hardware.wukong_top import WukongClock25
from hardware.uart_rx import UartRx
from hardware.uart_tx import UartTx
from hardware.uart_packet_arbiter import UartPacketArbiter
from .candidate_core import CandidateCoreTop


class CandidateBoard(Elaboratable):
    def __init__(self, words, binding, *, sim_mode=False):
        self.sim_mode = sim_mode
        self.clk = Signal()
        self.maintenance_n = Signal(init=1)
        self.uart_rx_pin = Signal(init=1)
        self.uart_tx_pin = Signal(init=1)
        self.runtime = CandidateCoreTop(words, binding, clock_hz=25_000_000)

    def ports(self):
        return [self.clk, self.maintenance_n, self.uart_rx_pin, self.uart_tx_pin]

    def elaborate(self, platform):
        m = Module()
        m.domains += ClockDomain("sync", reset_less=True)
        m.submodules.runtime = self.runtime
        if not self.sim_mode:
            clock = m.submodules.clock25 = WukongClock25()
            m.d.comb += [clock.clk_in.eq(self.clk),
                         ClockSignal("sync").eq(clock.clk_out)]
        meta, maintenance = Signal(), Signal()
        m.d.sync += [meta.eq(~self.maintenance_n), maintenance.eq(meta)]
        rx = m.submodules.rx = UartRx(clk_freq=25_000_000, baud=57_600)
        tx = m.submodules.tx = UartTx(clk_freq=25_000_000, baud=57_600)
        arb = m.submodules.tx_arbiter = UartPacketArbiter(1)
        tr = self.runtime.admission.transport
        m.d.comb += [
            rx.rx.eq(self.uart_rx_pin), self.uart_tx_pin.eq(tx.tx),
            tr.maintenance.eq(maintenance),
            tr.valid.eq(rx.valid & maintenance), tr.byte.eq(rx.data),
            tr.error.eq(rx.error & maintenance),
            arb.req[0].eq(tr.tx_req), arb.data[0].eq(tr.tx_byte),
            arb.last[0].eq(tr.tx_last), tr.tx_ack.eq(arb.ack[0]),
            arb.ready.eq(~tx.busy & ~tx.done),
            tx.start.eq(arb.tx_start), tx.data.eq(arb.tx_data),
        ]
        return m
