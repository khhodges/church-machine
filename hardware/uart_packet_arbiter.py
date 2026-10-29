"""Non-preemptive UART packet arbitration; producers advance only on ack."""
from amaranth import Array, Elaboratable, Module, Signal


class UartPacketArbiter(Elaboratable):
    def __init__(self, count):
        self.req = [Signal(name=f"req_{i}") for i in range(count)]
        self.data = [Signal(8, name=f"data_{i}") for i in range(count)]
        self.last = [Signal(name=f"last_{i}") for i in range(count)]
        self.ack = [Signal(name=f"ack_{i}") for i in range(count)]
        self.ready = Signal()
        self.tx_data = Signal(8)
        self.tx_start = Signal()
        self.owner = Signal(range(count + 1))

    def elaborate(self, platform):
        m = Module()
        selected = Signal(range(len(self.req)))
        # Lower index wins only at packet boundaries.
        for i in reversed(range(len(self.req))):
            with m.If(self.req[i]):
                m.d.comb += selected.eq(i)
        with m.If(self.owner != 0):
            m.d.comb += selected.eq(self.owner - 1)
        m.d.comb += [
            self.tx_data.eq(Array(self.data)[selected]),
            self.tx_start.eq(self.ready & Array(self.req)[selected]),
        ]
        for i in range(len(self.req)):
            m.d.comb += self.ack[i].eq(self.tx_start & (selected == i))
        with m.If(self.tx_start):
            with m.If(Array(self.last)[selected]):
                m.d.sync += self.owner.eq(0)
            with m.Else():
                m.d.sync += self.owner.eq(selected + 1)
        return m
