from amaranth import *


class UartRx(Elaboratable):
    """Simple UART receiver — 8N1, active-high idle.

    Parameters
    ----------
    clk_freq : int
        System clock frequency in Hz (default 12_000_000 for iCE40 HFOSC).
    baud : int
        Baud rate (default 115200).
    """

    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud

        self.rx = Signal(init=1)
        self.data = Signal(8)
        self.valid = Signal()
        self.error = Signal()

    def elaborate(self, platform):
        m = Module()

        divisor = int(self.clk_freq // self.baud)
        half_divisor = divisor // 2

        counter = Signal(range(divisor + 1))
        bit_pos = Signal(4)
        shift_reg = Signal(8)

        rx_sync = Signal(2, init=3)
        m.d.sync += [
            rx_sync[0].eq(self.rx),
            rx_sync[1].eq(rx_sync[0]),
        ]
        rx_in = rx_sync[1]

        with m.FSM(name="uart_rx"):
            with m.State("IDLE"):
                m.d.comb += [self.valid.eq(0), self.error.eq(0)]
                with m.If(~rx_in):
                    m.d.sync += counter.eq(0)
                    m.next = "START"

            with m.State("START"):
                m.d.comb += [self.valid.eq(0), self.error.eq(0)]
                with m.If(counter == half_divisor - 1):
                    with m.If(~rx_in):
                        m.d.sync += [counter.eq(0), bit_pos.eq(0)]
                        m.next = "DATA"
                    with m.Else():
                        m.next = "IDLE"
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

            with m.State("DATA"):
                m.d.comb += [self.valid.eq(0), self.error.eq(0)]
                with m.If(counter == divisor - 1):
                    m.d.sync += [
                        counter.eq(0),
                        shift_reg.eq(Cat(shift_reg[1:8], rx_in)),
                        bit_pos.eq(bit_pos + 1),
                    ]
                    with m.If(bit_pos == 7):
                        m.next = "STOP"
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

            with m.State("STOP"):
                m.d.comb += [self.valid.eq(0), self.error.eq(0)]
                with m.If(counter == divisor - 1):
                    with m.If(rx_in):
                        m.d.sync += self.data.eq(shift_reg)
                        m.next = "DONE"
                    with m.Else():
                        m.next = "ERROR"
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

            with m.State("DONE"):
                m.d.comb += [self.valid.eq(1), self.error.eq(0)]
                m.next = "IDLE"

            with m.State("ERROR"):
                m.d.comb += [self.valid.eq(0), self.error.eq(1)]
                m.next = "IDLE"

        return m
