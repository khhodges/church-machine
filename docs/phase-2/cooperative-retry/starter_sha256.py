"""Iterative SHA-256 over the received 64 KiB RAM, not UART assertions.

Memory is synchronous, word addressed and little endian. One final padding
block is implicit for the fixed, block-aligned image profile.
"""
from amaranth import Array, Cat, Const, Elaboratable, Module, Signal

IV = (0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19)
K = (
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2)


def rotr(x, n):
    return Cat(x[n:], x[:n])


class ReceivedImageSHA256(Elaboratable):
    def __init__(self, *, words=16384):
        if words <= 0 or words % 16:
            raise ValueError("SHA image geometry must be positive and block aligned")
        self.words = words
        self.start = Signal()
        self.address = Signal(range(words))
        self.data = Signal(32)
        self.done = Signal()
        self.digest = Signal(256)

    def elaborate(self, platform):
        m = Module()
        h = [Signal(32, init=v) for v in IV]
        v = [Signal(32) for _ in IV]
        w = Array(Signal(32) for _ in range(16))
        block = Signal(range(self.words // 16 + 1))
        index = Signal(4)
        rnd = Signal(6)
        t1, t2 = Signal(32), Signal(32)
        a, b, c, d, e, f, g, hh = v
        s0 = rotr(w[1], 7) ^ rotr(w[1], 18) ^ (w[1] >> 3)
        s1 = rotr(w[14], 17) ^ rotr(w[14], 19) ^ (w[14] >> 10)
        m.d.comb += [
            self.address.eq(block * 16 + index),
            self.digest.eq(Cat(*reversed(h))),
            t1.eq(hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
                  ((e & f) ^ (~e & g)) + Array(Const(k, 32) for k in K)[rnd] + w[0]),
            t2.eq((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
                  ((a & b) ^ (a & c) ^ (b & c))),
        ]
        with m.FSM():
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [x.eq(y) for x, y in zip(h, IV)]
                    m.d.sync += [block.eq(0), index.eq(0)]
                    m.next = "READ"
            with m.State("READ"):
                m.next = "CAPTURE"
            with m.State("CAPTURE"):
                with m.If(block == self.words // 16):
                    m.d.sync += w[index].eq(0)
                    with m.If(index == 0):
                        m.d.sync += w[index].eq(0x80000000)
                    with m.If(index == 15):
                        m.d.sync += w[index].eq(self.words * 32)
                with m.Else():
                    m.d.sync += w[index].eq(Cat(
                        self.data[24:32], self.data[16:24],
                        self.data[8:16], self.data[:8]))
                with m.If(index == 15):
                    m.d.sync += [x.eq(y) for x, y in zip(v, h)]
                    m.d.sync += rnd.eq(0)
                    m.next = "ROUND"
                with m.Else():
                    m.d.sync += index.eq(index + 1)
                    m.next = "READ"
            with m.State("ROUND"):
                m.d.sync += [a.eq(t1 + t2), b.eq(a), c.eq(b), d.eq(c),
                             e.eq(d + t1), f.eq(e), g.eq(f), hh.eq(g)]
                m.d.sync += [w[i].eq(w[i + 1]) for i in range(15)]
                m.d.sync += w[15].eq(w[0] + s0 + w[9] + s1)
                with m.If(rnd == 63):
                    m.next = "ADD"
                with m.Else():
                    m.d.sync += rnd.eq(rnd + 1)
            with m.State("ADD"):
                m.d.sync += [x.eq(x + y) for x, y in zip(h, v)]
                with m.If(block == self.words // 16):
                    m.next = "DONE"
                with m.Else():
                    m.d.sync += [block.eq(block + 1), index.eq(0)]
                    m.next = "READ"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
        return m
