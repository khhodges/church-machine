from amaranth import *


class CRC16_CCITT(Elaboratable):
    """CRC-16/CCITT-FALSE calculator — processes one byte per clock.

    Polynomial: 0x1021, Init: 0xFFFF, MSB-first.
    Used for UART patch-packet integrity verification.

    Interface:
        reset   : in  — pulse high to reset CRC to 0xFFFF
        valid   : in  — pulse high when data_in is valid (processes one byte)
        data_in : in  — 8-bit input byte
        crc     : out — current 16-bit CRC value
    """

    def __init__(self):
        self.reset = Signal()
        self.valid = Signal()
        self.data_in = Signal(8)
        self.crc = Signal(16, init=0xFFFF)

    def elaborate(self, platform):
        m = Module()

        crc_next = Signal(16)
        cur = self.crc

        for i in range(8):
            data_bit = self.data_in.bit_select(7 - i, 1)
            xor_bit = data_bit ^ cur[15]
            shifted = Cat(C(0, 1), cur[:15])
            nxt = Signal(16, name=f"crc_s{i}")
            m.d.comb += nxt.eq(Mux(xor_bit, shifted ^ 0x1021, shifted))
            cur = nxt

        m.d.comb += crc_next.eq(cur)

        with m.If(self.reset):
            m.d.sync += self.crc.eq(0xFFFF)
        with m.Elif(self.valid):
            m.d.sync += self.crc.eq(crc_next)

        return m
