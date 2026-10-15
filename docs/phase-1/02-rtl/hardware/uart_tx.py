from amaranth import *


class UartTx(Elaboratable):
    """Simple UART transmitter — 8N1, active-high idle.

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

        self.data = Signal(8)
        self.start = Signal()
        self.busy = Signal()
        self.done = Signal()
        self.tx = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        divisor = int(self.clk_freq // self.baud)

        counter = Signal(range(divisor + 1))
        bit_pos = Signal(4)
        shift_reg = Signal(10)

        with m.FSM(name="uart_tx"):
            with m.State("IDLE"):
                m.d.comb += [
                    self.tx.eq(1),
                    self.busy.eq(0),
                    self.done.eq(0),
                ]
                with m.If(self.start):
                    m.d.sync += [
                        shift_reg.eq(Cat(C(0, 1), self.data, C(1, 1))),
                        counter.eq(0),
                        bit_pos.eq(0),
                    ]
                    m.next = "TRANSMIT"

            with m.State("TRANSMIT"):
                m.d.comb += [
                    self.tx.eq(shift_reg[0]),
                    self.busy.eq(1),
                    self.done.eq(0),
                ]
                with m.If(counter == divisor - 1):
                    m.d.sync += [
                        counter.eq(0),
                        shift_reg.eq(shift_reg >> 1),
                        bit_pos.eq(bit_pos + 1),
                    ]
                    with m.If(bit_pos == 9):
                        m.next = "DONE"
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

            with m.State("DONE"):
                m.d.comb += [
                    self.tx.eq(1),
                    self.busy.eq(0),
                    self.done.eq(1),
                ]
                m.next = "IDLE"

        return m


class DebugPrinter(Elaboratable):
    """Sends hex-encoded register dumps over UART.

    Provides a simple debug interface: write a 32-bit value to `data`,
    pulse `send`, and this module transmits it as 8 hex digits + newline.
    Also supports single-byte mode for printing ASCII banners.
    """

    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud

        self.data = Signal(32)
        self.send = Signal()
        self.send_byte = Signal()
        self.byte_data = Signal(8)
        self.busy = Signal()
        self.tx = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        uart = UartTx(self.clk_freq, self.baud)
        m.submodules.uart = uart
        m.d.comb += self.tx.eq(uart.tx)

        HEX_CHARS = Array([C(ord(c), 8) for c in "0123456789ABCDEF"])

        data_reg = Signal(32)
        nibble_idx = Signal(4)
        byte_reg = Signal(8)

        nibble_val = Signal(4)
        hex_byte = Signal(8)
        m.d.comb += nibble_val.eq((data_reg >> (nibble_idx << 2)) & 0xF)
        m.d.comb += hex_byte.eq(HEX_CHARS[nibble_val])

        with m.FSM(name="debug_printer"):
            with m.State("IDLE"):
                m.d.comb += self.busy.eq(0)
                with m.If(self.send):
                    m.d.sync += [
                        data_reg.eq(self.data),
                        nibble_idx.eq(7),
                    ]
                    m.next = "HEX_SEND"
                with m.Elif(self.send_byte):
                    m.d.sync += byte_reg.eq(self.byte_data)
                    m.next = "SEND_BYTE"

            with m.State("HEX_SEND"):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(hex_byte),
                        uart.start.eq(1),
                    ]
                    m.next = "HEX_WAIT"

            with m.State("HEX_WAIT"):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    with m.If(nibble_idx == 0):
                        m.next = "SEND_NL"
                    with m.Else():
                        m.d.sync += nibble_idx.eq(nibble_idx - 1)
                        m.next = "HEX_SEND"

            with m.State("SEND_NL"):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(0x0A),
                        uart.start.eq(1),
                    ]
                    m.next = "NL_WAIT"

            with m.State("NL_WAIT"):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    m.next = "IDLE"

            with m.State("SEND_BYTE"):
                m.d.comb += self.busy.eq(1)
                with m.If(~uart.busy):
                    m.d.comb += [
                        uart.data.eq(byte_reg),
                        uart.start.eq(1),
                    ]
                    m.next = "BYTE_WAIT"

            with m.State("BYTE_WAIT"):
                m.d.comb += self.busy.eq(1)
                with m.If(uart.done):
                    m.next = "IDLE"

        return m
