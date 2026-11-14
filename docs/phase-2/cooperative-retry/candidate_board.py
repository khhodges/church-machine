"""Wukong V3 pin/clock/UART connection for the new 128 KiB candidate.

Not the historical CombinedStarterBoard and not a qualified final test image.
CSI3 installation and optional qualified runtime delivery share the UART.
Native service MMIO remains an explicit boundary, not fake peripheral responses.
"""
from amaranth import ClockDomain, ClockSignal, Elaboratable, Module, Signal
from hardware.wukong_top import WukongClock25
from hardware.uart_rx import UartRx
from hardware.uart_tx import UartTx
from .candidate_core import CandidateCoreTop
from .candidate_serial import CandidateSerial


class CandidateBoard(Elaboratable):
    def __init__(self, words, binding, *, sim_mode=False, delivery_records=None):
        self.sim_mode = sim_mode
        self.clk = Signal()
        self.maintenance_n = Signal(init=1)
        self.uart_rx_pin = Signal(init=1)
        self.uart_tx_pin = Signal(init=1)
        self.runtime = CandidateCoreTop(words, binding, clock_hz=25_000_000,
                                       delivery_records=delivery_records)

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
        tr = self.runtime.admission.transport
        route = m.submodules.serial_route = CandidateSerial(tr, self.runtime.delivery)
        m.d.comb += [
            rx.rx.eq(self.uart_rx_pin), self.uart_tx_pin.eq(tx.tx),
            route.maintenance.eq(maintenance),
            route.valid.eq(rx.valid), route.byte.eq(rx.data), route.error.eq(rx.error),
            route.ready.eq(~tx.busy & ~tx.done),
            tx.start.eq(route.tx_start), tx.data.eq(route.tx_data),
        ]
        return m
