"""Isolated request receiver and read-only observation controller."""
from amaranth import Array, Cat, Const, Elaboratable, Module, Mux, Signal
from .request_protocol import REQUEST, RESPONSE, OBJECT_ID, OFFSETS, REPORT_SIZE


def crc_step(m, crc, byte):
    value = crc
    for bit in reversed(range(8)):
        step = Signal(16)
        m.d.comb += step.eq(Mux(value[15] ^ byte[bit],
                               (value << 1) ^ 0x1021, value << 1))
        value = step
    return value


def be(word):
    return [word[24:32], word[16:24], word[8:16], word[:8]]


class RequestDiagnostic(Elaboratable):
    def __init__(self):
        self.valid = Signal()
        self.byte = Signal(8)
        self.error = Signal()
        self.claim = Signal()
        self.pop = Signal()
        self.start = Signal()
        self.status = Signal(2)
        self.data = Signal(32)
        self.failed = Signal()
        self.accepted = Signal()
        self.count = Signal(range(len(RESPONSE) + 1))
        self.index = Signal(range(6))
        self.words = [Signal(32, name=f"request_word_{i}") for i in range(5)]
        self.tx_req = Signal()
        self.tx_byte = Signal(8)
        self.tx_last = Signal()
        self.tx_ack = Signal()
        self.request_sent = Signal()
        self.stopped = Signal()
        self.snapshot_complete = Signal()
        self.mem_active = Signal()
        self.mem_addr = Signal(14)
        self.mem_data = Signal(32)
        self.write = Signal()
        self.write_addr = Signal(32)
        self.handoff = Signal()
        self.retry = Signal()
        self.retire = Signal()
        self.nia = Signal(32)
        self.cr12 = Signal(32)
        self.dr12 = Signal(32)
        self.post_count = Signal(32)
        self.write_count = Signal(32)
        self.publish_count = Signal(32)
        self.handoffs = Signal(32)
        self.retries = Signal(32)

    def elaborate(self, platform):
        m = Module()
        started = Signal()
        ready = self.count == len(RESPONSE)
        reject = ~self.accepted & (self.error | (self.valid & (ready | ~self.request_sent)))
        expected = Array(Const(b, 8) for b in RESPONSE)
        m.d.comb += [
            self.status.eq(Mux(self.failed | reject, 2, Mux(ready, 1, 0))),
            self.data.eq(Mux(self.accepted & ~self.failed & (self.index < 5),
                             Array(self.words)[self.index], 0)),
        ]
        with m.If(~self.accepted & ~self.failed):
            with m.If(reject):
                m.d.sync += self.failed.eq(1)
            with m.Elif(self.valid):
                with m.If(self.byte != expected[self.count]):
                    m.d.sync += self.failed.eq(1)
                with m.Else():
                    m.d.sync += self.count.eq(self.count + 1)
                    for i in range(20):
                        with m.If(self.count == 38 + i):
                            m.d.sync += self.words[i // 4].eq(Cat(self.byte, self.words[i // 4][:24]))
            with m.Elif(self.claim & ready):
                m.d.sync += self.accepted.eq(1)
        with m.If(self.pop & self.accepted & ~self.failed & (self.index < 5)):
            m.d.sync += self.index.eq(self.index + 1)

        # These counters observe the real core/receiver signals; they grant no
        # write, resume, or recovery authority.
        post_crc = Signal(16, init=0xFFFF)
        errors = Signal(32)
        activity = Signal(32)
        with m.If(self.valid & self.accepted):
            m.d.sync += [self.post_count.eq(self.post_count + 1),
                         post_crc.eq(crc_step(m, post_crc, self.byte))]
        with m.If(self.error):
            m.d.sync += errors.eq(errors + 1)
        with m.If(self.write):
            m.d.sync += self.write_count.eq(self.write_count + 1)
            with m.If(self.write_addr == 0x5000):
                m.d.sync += self.publish_count.eq(self.publish_count + 1)
        with m.If(self.handoff):
            m.d.sync += self.handoffs.eq(self.handoffs + 1)
        with m.If(self.retry):
            m.d.sync += self.retries.eq(self.retries + 1)
        with m.If(self.stopped & (self.retire | self.write)):
            m.d.sync += activity.eq(activity + 1)

        # The architectural snapshot finishes before reusing its read port.
        terminal_seen = Signal()
        with m.If(self.snapshot_complete & self.stopped):
            m.d.sync += terminal_seen.eq(1)

        # Observation-only URP2+nonce parser. It never feeds claim/pop or RAM
        # writes. One challenge report only, after the baseline is sent.
        probe_enabled = Signal()
        shift = Signal(32)
        nonce = Signal(32)
        nonce_left = Signal(range(5))
        probe_pending = Signal()
        with m.If(probe_enabled & self.valid & ~probe_pending):
            with m.If(nonce_left != 0):
                m.d.sync += [nonce.eq(Cat(self.byte, nonce[:24])),
                             nonce_left.eq(nonce_left - 1)]
                with m.If(nonce_left == 1):
                    m.d.sync += probe_pending.eq(1)
            with m.Else():
                m.d.sync += shift.eq(Cat(self.byte, shift[:24]))
                with m.If(Cat(self.byte, shift[:24]) == int.from_bytes(b"URP2", "big")):
                    m.d.sync += nonce_left.eq(4)

        request_bytes = Array(Const(b, 8) for b in REQUEST)
        tx_index = Signal(range(max(REPORT_SIZE, len(REQUEST))))
        sequence = Signal(32)
        report_nonce = Signal(32)
        fields = [Signal(32, name=f"report_field_{i}") for i in range(25)]
        sources = [self.accepted, self.failed, self.index, self.count,
                   self.post_count, post_crc, errors, self.write_count,
                   self.publish_count, self.handoffs, self.retries,
                   self.nia, self.cr12, self.dr12, activity, *self.words]
        report_bytes = Array([
            *(Const(b, 8) for b in b"URV2"), *be(sequence), *be(report_nonce),
            *(Const(b, 8) for b in OBJECT_ID),
            *(b for field in fields for b in be(field)),
        ])
        report_crc = Signal(16, init=0xFFFF)
        read_index = Signal(range(5))
        read_addresses = Array(Const(0x1400 + offset, 14) for offset in OFFSETS)
        m.d.comb += self.mem_addr.eq(read_addresses[read_index])

        with m.FSM(name="request_observer"):
            with m.State("WAIT_START"):
                with m.If(self.start & ~started):
                    m.d.sync += [started.eq(1), tx_index.eq(0)]
                    m.next = "REQUEST"
            with m.State("REQUEST"):
                m.d.comb += [self.tx_req.eq(1), self.tx_byte.eq(request_bytes[tx_index]),
                             self.tx_last.eq(tx_index == len(REQUEST) - 1)]
                with m.If(self.tx_ack):
                    with m.If(tx_index == len(REQUEST) - 1):
                        m.d.sync += self.request_sent.eq(1)
                        m.next = "WAIT_STOP"
                    with m.Else():
                        m.d.sync += tx_index.eq(tx_index + 1)
            with m.State("WAIT_STOP"):
                with m.If(terminal_seen):
                    m.d.sync += [sequence.eq(1), report_nonce.eq(0)]
                    m.next = "LATCH"
            with m.State("WAIT_PROBE"):
                with m.If(probe_pending):
                    m.d.sync += [sequence.eq(2), report_nonce.eq(nonce), probe_enabled.eq(0)]
                    m.next = "LATCH"
            with m.State("LATCH"):
                for field, source in zip(fields, sources):
                    m.d.sync += field.eq(source)
                m.d.sync += [read_index.eq(0), tx_index.eq(0), report_crc.eq(0xFFFF)]
                m.next = "READ"
            with m.State("READ"):
                m.d.comb += self.mem_active.eq(1)
                m.next = "READ_WAIT"
            with m.State("READ_WAIT"):
                m.d.comb += self.mem_active.eq(1)
                m.d.sync += Array(fields[20:])[read_index].eq(self.mem_data)
                with m.If(read_index == 4):
                    m.next = "REPORT"
                with m.Else():
                    m.d.sync += read_index.eq(read_index + 1)
                    m.next = "READ"
            with m.State("REPORT"):
                m.d.comb += [
                    self.tx_req.eq(1), self.tx_last.eq(tx_index == REPORT_SIZE - 1),
                    self.tx_byte.eq(Mux(tx_index < REPORT_SIZE - 2, report_bytes[tx_index],
                                       Mux(tx_index == REPORT_SIZE - 2, report_crc[8:16], report_crc[:8]))),
                ]
                with m.If(self.tx_ack):
                    with m.If(tx_index < REPORT_SIZE - 2):
                        m.d.sync += report_crc.eq(crc_step(m, report_crc, self.tx_byte))
                    with m.If(tx_index == REPORT_SIZE - 1):
                        with m.If(sequence == 1):
                            m.d.sync += probe_enabled.eq(1)
                            m.next = "WAIT_PROBE"
                        with m.Else():
                            m.next = "DONE"
                    with m.Else():
                        m.d.sync += tx_index.eq(tx_index + 1)
            with m.State("DONE"):
                pass
        return m
