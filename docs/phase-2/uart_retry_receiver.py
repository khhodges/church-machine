"""One-shot exact-fixture receiver, not a general loading or trust service."""
from amaranth import Array, Cat, Const, Elaboratable, Module, Mux, Signal


PAYLOAD_WORDS = (2, 0xAF60400D, 0x1F000000, 0x4A000006, 0xF8001001)
FRAME = b"URX1" + b"\x00\x14" + b"".join(
    word.to_bytes(4, "big") for word in PAYLOAD_WORDS) + b"END!"


class DiagnosticReceiver(Elaboratable):
    """Status: 0 pending, 1 validated, 2 failed.

    A valid status read claims the frame. Extra bytes or UART errors before
    that claim fail; bytes/errors after claim are ignored permanently.
    No timeout, retry, or reset
    recovery is provided. Data reads pop only after claim.
    """
    def __init__(self):
        self.valid = Signal()
        self.byte = Signal(8)
        self.error = Signal()
        self.claim = Signal()
        self.pop = Signal()
        self.status = Signal(2)
        self.data = Signal(32)
        self.failed = Signal()
        self.accepted = Signal()
        self.count = Signal(range(len(FRAME) + 1))
        self.index = Signal(range(6))

    def elaborate(self, platform):
        m = Module()
        words = Array(Signal(32, name=f"received_word_{i}") for i in range(5))
        expected = Array(Const(byte, 8) for byte in FRAME)
        ready = self.count == len(FRAME)
        # Collision: a byte arriving on the claim cycle wins and rejects.
        overflow = self.valid & ready & ~self.accepted
        reject = overflow | (self.error & ~self.accepted)
        m.d.comb += [
            self.status.eq(Mux(self.failed | reject, 2, Mux(ready, 1, 0))),
            self.data.eq(Mux(self.accepted & ~self.failed & (self.index < 5),
                             words[self.index], 0)),
        ]
        with m.If(~self.failed & ~self.accepted):
            # A line error wins over both a matching byte and a status claim.
            with m.If(self.error):
                m.d.sync += self.failed.eq(1)
            with m.Elif(self.valid):
                with m.If(ready):
                    m.d.sync += self.failed.eq(1)
                with m.Elif(self.byte != expected[self.count]):
                    m.d.sync += self.failed.eq(1)
                with m.Else():
                    m.d.sync += self.count.eq(self.count + 1)
                    # Buffer the actual received bytes, not an expected-data ROM.
                    for i in range(20):
                        with m.If(self.count == 6 + i):
                            m.d.sync += words[i // 4].eq(
                                Cat(self.byte, words[i // 4][:24]))
            with m.Elif(self.claim & ready):
                m.d.sync += self.accepted.eq(1)
        with m.If(self.pop & self.accepted & ~self.failed & (self.index < 5)):
            m.d.sync += self.index.eq(self.index + 1)
        return m
