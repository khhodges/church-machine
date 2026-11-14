"""Candidate-only installer/runtime byte routing with cancelled-packet release."""
from amaranth import Array, Elaboratable, Module, ResetInserter, Signal
from hardware.uart_packet_arbiter import UartPacketArbiter


class CandidateSerial(Elaboratable):
    def __init__(self, transport, delivery=None):
        self.transport, self.delivery = transport, delivery
        self.maintenance = Signal()
        self.valid, self.error = Signal(), Signal()
        self.byte = Signal(8)
        self.ready, self.tx_start = Signal(), Signal()
        self.tx_data = Signal(8)

    def elaborate(self, platform):
        m = Module()
        tr, d = self.transport, self.delivery
        arb = UartPacketArbiter(2 if d is not None else 1)
        # A cancelled producer withdraws req. The maintained arbiter deliberately
        # retains packets, so release only its ownership, never UART bit timing.
        abandoned = Signal()
        m.submodules.arbiter = ResetInserter(abandoned)(arb)
        m.d.comb += [
            tr.maintenance.eq(self.maintenance),
            tr.valid.eq(self.valid & self.maintenance),
            tr.error.eq(self.error & self.maintenance), tr.byte.eq(self.byte),
            arb.req[0].eq(tr.tx_req), arb.data[0].eq(tr.tx_byte),
            arb.last[0].eq(tr.tx_last), tr.tx_ack.eq(arb.ack[0]),
            arb.ready.eq(self.ready), self.tx_start.eq(arb.tx_start),
            self.tx_data.eq(arb.tx_data),
            abandoned.eq((arb.owner != 0) & ~Array(arb.req)[arb.owner - 1]),
        ]
        if d is not None:
            rx = d.receiver
            allowed = d.enabled & ~self.maintenance
            m.d.comb += [
                rx.valid.eq(self.valid & allowed), rx.error.eq(self.error & allowed),
                rx.byte.eq(self.byte), arb.req[1].eq(rx.tx_req & allowed),
                arb.data[1].eq(rx.tx_byte), arb.last[1].eq(rx.tx_last),
                rx.tx_ack.eq(arb.ack[1]),
            ]
        return m
