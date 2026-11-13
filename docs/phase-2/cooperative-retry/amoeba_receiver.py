"""General selected-record receiver, local RTL only. No executable writes."""
from amaranth import Array, Cat, Const, Elaboratable, Module, Mux, ResetInserter, Signal
from .amoeba_protocol import MAGIC, BEGIN, FINISH, ABORT, validate_records
from .starter_sha256 import ReceivedImageSHA256


class AmoebaReceiver(Elaboratable):
    EMPTY, RECEIVING, SEALED, VERIFYING, READY, COPYING, CONSUMED, FAILED, WAITING = range(9)

    def __init__(self, records, *, staging_base=0xa000, staging_words=1024,
                 clock_hz=25_000_000):
        self.records = validate_records(records, staging_base=staging_base,
                                        staging_words=staging_words)
        self.staging_base, self.staging_words = staging_base, staging_words
        self.clock_hz = clock_hz
        self.valid, self.error, self.running = Signal(), Signal(), Signal()
        self.byte, self.epoch = Signal(8), Signal(32)
        self.request, self.request_slot = Signal(), Signal(32)
        self.pop, self.commit, self.commit_transaction = Signal(), Signal(), Signal(32)
        self.state, self.selector, self.transaction = Signal(4), Signal(8), Signal(32)
        self.size, self.expected_header = Signal(32), Signal(32)
        self.consumed, self.word = Signal(range(staging_words + 1)), Signal(32)
        self.memory_write, self.memory_ready = Signal(), Signal()
        self.memory_address = Signal(range(staging_words))
        self.memory_data = Signal(32)
        self.read_address = Signal(range(staging_words))
        self.read_data = Signal(32)
        # REQUEST packet goes logically to IDE; transport grants no publication.
        self.tx_req, self.tx_ack, self.tx_last = Signal(), Signal(), Signal()
        self.tx_byte = Signal(8)

    def elaborate(self, platform):
        m = Module()
        epoch, selected = Signal(32), Signal(range(max(2, len(self.records))))
        lengths = Array(Const(r["sizeWords"], 32) for r in self.records)
        headers = Array(Const(r["words"][0], 32) for r in self.records)
        hashes = Array(Const(int(r["localizedSha256LE"], 16), 256) for r in self.records)
        sha_by_size = {}
        for size in sorted({r["sizeWords"] for r in self.records}):
            sha = ReceivedImageSHA256(words=size)
            sha_by_size[size] = sha
            m.submodules[f"sha_{size}"] = ResetInserter(
                ~self.running | (epoch != self.epoch))(sha)
            m.d.comb += sha.data.eq(self.read_data)
        started, done, digest = Signal(), Signal(), Signal(256)
        m.d.comb += [self.size.eq(lengths[selected]), self.expected_header.eq(headers[selected])]
        with m.Switch(self.size):
            for size, sha in sha_by_size.items():
                with m.Case(size):
                    m.d.comb += [done.eq(sha.done), digest.eq(sha.digest)]
                    with m.If(self.state == self.VERIFYING):
                        m.d.comb += self.read_address.eq(sha.address)
        with m.If(self.state != self.VERIFYING):
            m.d.comb += self.read_address.eq(self.consumed)
        for size, sha in sha_by_size.items():
            m.d.comb += sha.start.eq((self.state == self.VERIFYING) &
                                    (self.size == size) & ~started)
        locked = (self.state == self.READY) | (self.state == self.COPYING)
        m.d.comb += self.word.eq(Mux(locked & (self.consumed < self.size), self.read_data, 0))
        count, byte_index, word = Signal(range(self.staging_words + 1)), Signal(2), Signal(32)
        pending = Signal()
        header = Array(Signal(8) for _ in range(20))
        index = Signal(range(20))
        idle = Signal(range(self.clock_hz * 2 + 1))
        m.d.comb += [
            self.memory_write.eq(pending & self.running & (epoch == self.epoch) &
                                 (self.state == self.RECEIVING) & ~self.error),
            self.memory_address.eq(count - 1), self.memory_data.eq(word),
        ]
        tx_busy, tx_index, packet = Signal(), Signal(range(16)), Signal(128)
        octets = Array(packet[i:i+8] for i in range(120, -1, -8))
        m.d.comb += [self.tx_req.eq(tx_busy), self.tx_byte.eq(octets[tx_index]),
                     self.tx_last.eq(tx_index == 15)]
        with m.If(tx_busy & self.tx_ack):
            with m.If(tx_index == 15):
                m.d.sync += tx_busy.eq(0)
            with m.Else():
                m.d.sync += tx_index.eq(tx_index + 1)
        with m.If(~self.running | (epoch != self.epoch)):
            m.d.sync += [epoch.eq(self.epoch), self.state.eq(self.EMPTY),
                         self.transaction.eq(0), self.consumed.eq(0), pending.eq(0),
                         index.eq(0), count.eq(0), byte_index.eq(0), started.eq(0),
                         idle.eq(0), tx_busy.eq(0)]
        with m.Else():
            with m.If(self.request):
                with m.If(((self.state == self.EMPTY) | (self.state == self.CONSUMED)) &
                          (self.transaction != 0xffffffff) & ~tx_busy):
                    m.d.sync += self.state.eq(self.FAILED)
                    for i, record in enumerate(self.records):
                        with m.If(self.request_slot == record["slot"]):
                            m.d.sync += [
                                selected.eq(i), self.selector.eq(record["slot"]),
                                self.transaction.eq(self.transaction + 1),
                                self.state.eq(self.WAITING), self.consumed.eq(0),
                                index.eq(0), idle.eq(0), tx_index.eq(0), tx_busy.eq(1),
                                # CAR1 | slot:u32 | epoch:u32 | transaction:u32
                                packet.eq(Cat((self.transaction + 1)[:32], epoch,
                                              self.request_slot, Const(0x43415231, 32))),
                            ]
                with m.Else():
                    # Reentry is a software error, never permission to replace data.
                    m.d.sync += self.state.eq(self.FAILED)
            with m.If(pending & self.memory_ready):
                m.d.sync += pending.eq(0)
                with m.If(count == self.size):
                    m.d.sync += self.state.eq(self.SEALED)
            with m.If(self.state == self.VERIFYING):
                m.d.sync += started.eq(1)
                with m.If(done):
                    m.d.sync += [self.state.eq(Mux(digest == hashes[selected],
                                                  self.READY, self.FAILED)), started.eq(0)]
            with m.If(self.pop & locked):
                with m.If(self.consumed < self.size):
                    m.d.sync += [self.consumed.eq(self.consumed + 1), self.state.eq(self.COPYING)]
                with m.Else():
                    m.d.sync += self.state.eq(self.FAILED)
            with m.If(self.commit):
                m.d.sync += self.state.eq(Mux(locked & (self.consumed == self.size) &
                    (self.commit_transaction == self.transaction), self.CONSUMED, self.FAILED))
            active = (self.state == self.RECEIVING) | (self.state == self.SEALED)
            with m.If(~locked & self.error):
                m.d.sync += [self.state.eq(self.FAILED), pending.eq(0), index.eq(0)]
            with m.Elif(self.valid & ~locked):
                m.d.sync += idle.eq(0)
                with m.If(self.state == self.RECEIVING):
                    with m.If(pending & ~self.memory_ready):
                        m.d.sync += [self.state.eq(self.FAILED), pending.eq(0)]
                    with m.Else():
                        m.d.sync += [word.word_select(byte_index, 8).eq(self.byte),
                                     byte_index.eq(byte_index + 1)]
                        with m.If(byte_index == 3):
                            m.d.sync += [pending.eq(1), count.eq(count + 1)]
                with m.Else():
                    m.d.sync += header[index].eq(self.byte)
                    with m.If(index != 19):
                        m.d.sync += index.eq(index + 1)
                    with m.Else():
                        m.d.sync += index.eq(0)
                        length = Cat(self.byte, header[18], header[17], header[16])
                        framing = ((Cat(*header[:4]) == int.from_bytes(MAGIC, "little")) &
                            (header[5] == self.selector) & (header[6] == 0) & (header[7] == 0) &
                            (Cat(header[11], header[10], header[9], header[8]) == epoch) &
                            (Cat(header[15], header[14], header[13], header[12]) == self.transaction))
                        with m.If(framing & (header[4] == BEGIN) &
                                  (self.state == self.WAITING) & (length == self.size << 2)):
                            m.d.sync += [self.state.eq(self.RECEIVING), count.eq(0),
                                         byte_index.eq(0), pending.eq(0), self.consumed.eq(0)]
                        with m.Elif(framing & (header[4] == FINISH) &
                                    (self.state == self.SEALED) & (length == 0)):
                            m.d.sync += [self.state.eq(self.VERIFYING), started.eq(0)]
                        with m.Else():
                            m.d.sync += self.state.eq(self.FAILED)
            with m.Elif(active | (index != 0)):
                with m.If(idle == self.clock_hz * 2):
                    m.d.sync += [self.state.eq(self.FAILED), pending.eq(0), index.eq(0)]
                with m.Else():
                    m.d.sync += idle.eq(idle + 1)
        return m
