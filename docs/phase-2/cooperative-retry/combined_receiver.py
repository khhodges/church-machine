"""Non-executable staging receiver. No Namespace or executable write authority.

All addresses are relative to a fixed 256-word staging allocation wired by the
top. CPU writes have priority there; held receiver writes require acceptance.
SHA reads actual RAM. Only SYSTEM's separately granted read/commit interface
can consume validated data. No completion output fabricates publication.
"""
from amaranth import Array, Cat, Const, Elaboratable, Module, Mux, ResetInserter, Signal
from .starter_sha256 import ReceivedImageSHA256
from .combined_protocol import MAGIC, BEGIN, FINISH, ABORT, validate_records


class CombinedReceiver(Elaboratable):
    EMPTY, RECEIVING, SEALED, VERIFYING, READY, COPYING, CONSUMED, FAILED = range(8)

    def __init__(self, records, *, clock_hz=25_000_000):
        self.records = validate_records(records)
        self.clock_hz = clock_hz
        self.valid, self.error = Signal(), Signal()
        self.byte = Signal(8)
        self.epoch = Signal(32)
        self.running = Signal()
        self.state = Signal(3)
        self.selector = Signal()
        self.transaction = Signal(32)
        self.phase = Signal(2)  # old, new, finished; only SYSTEM commit advances
        self.accepted = Signal()
        self.rejected = Signal()
        self.pop, self.commit = Signal(), Signal()
        self.consumed = Signal(9)
        self.word = Signal(32)
        self.memory_write, self.memory_ready = Signal(), Signal()
        self.memory_address = Signal(8)
        self.memory_data = Signal(32)
        self.read_address = Signal(8)
        self.read_data = Signal(32)

    def elaborate(self, platform):
        m = Module()
        state = self.state
        epoch = Signal(32)
        count = Signal(9)
        byte_index = Signal(2)
        word = Signal(32)
        pending = Signal()
        header = Array(Signal(8) for _ in range(20))
        index = Signal(range(20))
        idle = Signal(range(self.clock_hz * 2 + 1))
        lengths = Array(Const(r["sizeWords"], 9) for r in self.records)
        size = lengths[self.selector]
        hashes = Array(Const(int(r["localizedSha256LE"], 16), 256) for r in self.records)
        sha_units = []
        for i, r in enumerate(self.records):
            sha = ReceivedImageSHA256(words=r["sizeWords"])
            m.submodules[f"sha_{i}"] = ResetInserter(
                ~self.running | (epoch != self.epoch))(sha)
            sha_units.append(sha)
            m.d.comb += sha.data.eq(self.read_data)
        started = Signal()
        sha_done = Mux(self.selector, sha_units[1].done, sha_units[0].done)
        sha_digest = Mux(self.selector, sha_units[1].digest, sha_units[0].digest)
        m.d.comb += [
            self.memory_write.eq(pending & self.running & (epoch == self.epoch) &
                                 (state == self.RECEIVING) & ~self.error),
            self.memory_address.eq(count - 1),
            self.memory_data.eq(word),
            self.read_address.eq(Mux(state == self.VERIFYING,
                Mux(self.selector, sha_units[1].address, sha_units[0].address),
                self.consumed)),
            self.word.eq(Mux(((state == self.READY) | (state == self.COPYING)) &
                             (self.consumed < size), self.read_data, 0)),
        ]
        for i, sha in enumerate(sha_units):
            m.d.comb += sha.start.eq(
                (state == self.VERIFYING) & ~started & (self.selector == i) &
                self.running & (epoch == self.epoch))

        # Status pulses are observations, never validation inputs.
        m.d.sync += [self.accepted.eq(0), self.rejected.eq(0)]
        with m.If(~self.running | (epoch != self.epoch)):
            m.d.sync += [
                epoch.eq(self.epoch), state.eq(self.EMPTY), index.eq(0),
                pending.eq(0), count.eq(0), byte_index.eq(0), started.eq(0),
                self.consumed.eq(0), self.transaction.eq(0), idle.eq(0), self.phase.eq(0),
            ]
        with m.Else():
            with m.If(pending & self.memory_ready):
                m.d.sync += pending.eq(0)
                with m.If(count == size):
                    m.d.sync += state.eq(self.SEALED)
            with m.If(state == self.VERIFYING):
                m.d.sync += started.eq(1)
                with m.If(sha_done):
                    with m.If((sha_digest == hashes[self.selector]) &
                              (self.phase == self.selector)):
                        m.d.sync += [state.eq(self.READY), self.accepted.eq(1)]
                    with m.Else():
                        m.d.sync += [state.eq(self.FAILED), self.rejected.eq(1)]
            with m.If(self.pop):
                with m.If(((state == self.READY) | (state == self.COPYING)) &
                          (self.consumed < size)):
                    m.d.sync += [self.consumed.eq(self.consumed + 1),
                                 state.eq(self.COPYING)]
                with m.Else():
                    m.d.sync += self.rejected.eq(1)
            with m.If(self.commit):
                with m.If((state == self.COPYING) & (self.consumed == size)):
                    m.d.sync += [state.eq(self.CONSUMED), self.phase.eq(self.phase + 1)]
                with m.Else():
                    m.d.sync += self.rejected.eq(1)
            # Timeout bounds only incomplete framing/receipt. It cannot pause,
            # renew or reset the independent execution watchdog.
            with m.If((index != 0) | (state == self.RECEIVING) | (state == self.SEALED)):
                with m.If(idle == self.clock_hz * 2):
                    m.d.sync += [state.eq(self.FAILED), pending.eq(0),
                                 index.eq(0), self.rejected.eq(1), idle.eq(0)]
                with m.Else():
                    m.d.sync += idle.eq(idle + 1)
            locked = (state == self.READY) | (state == self.COPYING)
            # Once SYSTEM can consume bytes, UART cannot invalidate that
            # snapshot mid-copy. Only consumption/commit or execution reset can
            # release it. An attacker-induced framing error is not a revocation.
            with m.If(locked & (self.valid | self.error)):
                m.d.sync += [self.rejected.eq(1), index.eq(0)]
            with m.If(self.valid & ~locked):
                m.d.sync += idle.eq(0)
                with m.If(state == self.RECEIVING):
                    with m.If(pending & ~self.memory_ready):
                        m.d.sync += [state.eq(self.FAILED), pending.eq(0),
                                     self.rejected.eq(1)]
                    with m.Else():
                        m.d.sync += word.word_select(byte_index, 8).eq(self.byte)
                        m.d.sync += byte_index.eq(byte_index + 1)
                        with m.If(byte_index == 3):
                            m.d.sync += [pending.eq(1), count.eq(count + 1)]
                with m.Else():
                    m.d.sync += header[index].eq(self.byte)
                    with m.If(index != 19):
                        m.d.sync += index.eq(index + 1)
                    with m.Else():
                        m.d.sync += index.eq(0)
                        op = header[4]
                        selector = header[5]
                        wire_epoch = Cat(header[11], header[10], header[9], header[8])
                        txn = Cat(header[15], header[14], header[13], header[12])
                        length = Cat(self.byte, header[18], header[17], header[16])
                        framing = ((Cat(*header[:4]) == int.from_bytes(MAGIC, "little")) &
                                   (header[6] == 0) & (header[7] == 0) &
                                   (selector < 2) & (wire_epoch == epoch))
                        fresh = ((self.transaction != 0xffffffff) &
                                 (txn == self.transaction + 1))
                        available = ((state == self.EMPTY) | (state == self.CONSUMED) |
                                     (state == self.FAILED))
                        with m.If(framing & (op == BEGIN) & fresh & available &
                                  (length == (lengths[selector[:1]] << 2))):
                            m.d.sync += [self.selector.eq(selector), self.transaction.eq(txn),
                                         count.eq(0), byte_index.eq(0), pending.eq(0),
                                         started.eq(0), self.consumed.eq(0),
                                         state.eq(self.RECEIVING)]
                        with m.Elif(framing & (selector == self.selector) &
                                    (txn == self.transaction) & (length == 0) &
                                    (op == FINISH) & (state == self.SEALED)):
                            m.d.sync += [state.eq(self.VERIFYING), started.eq(0)]
                        with m.Elif(framing & (selector == self.selector) &
                                    (txn == self.transaction) & (length == 0) &
                                    (op == ABORT) & (state != self.CONSUMED)):
                            m.d.sync += [state.eq(self.FAILED), pending.eq(0),
                                         self.rejected.eq(1)]
                        with m.Else():
                            m.d.sync += self.rejected.eq(1)
                            with m.If(state == self.SEALED):
                                m.d.sync += state.eq(self.FAILED)
            # A bad UART stop bit invalidates an in-flight delivery, including
            # any pending write on this edge. Never consume partial data.
            with m.If(self.error & ~locked):
                m.d.sync += [state.eq(self.FAILED), pending.eq(0), index.eq(0),
                             self.rejected.eq(1), self.accepted.eq(0)]
        return m
