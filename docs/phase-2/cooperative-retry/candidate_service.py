"""Native candidate delivery MMIO. Capability authorization remains in the core.

Word offsets: 0 pop, 1 state, 2 target GT, 3 transaction/commit,
4 size, 5 request (write 1), 6 expected header, 7..9 origin Namespace,
10 origin Thread, 11 target GT. Origin fields are software handoff evidence,
not authority. Only exact provisioned records can be selected.
"""
from amaranth import Cat, Elaboratable, Module, Mux, Signal
from .candidate_memory import Port

BASE = 0x40000100


class CandidateService(Elaboratable):
    def __init__(self, delivery):
        self.delivery = delivery
        self.bus = Port("service")
        self.enabled = Signal()
        self.namespace = Signal(96)
        self.thread = Signal(32)

    def elaborate(self, platform):
        m = Module()
        d, p = self.delivery, self.bus
        rx = d.receiver
        fields = [Signal(32, name=f"handoff_{i}") for i in range(5)]
        mask = Signal(5)
        writer_ns, writer_thread = Signal(96), Signal(32)
        same = (mask == 0) | ((writer_ns == self.namespace) &
                              (writer_thread == self.thread))
        locked = (rx.state == rx.READY) | (rx.state == rx.COPYING)
        read_ok, write_ok, data = Signal(), Signal(), Signal(32)
        request = Signal()
        m.d.comb += [
            d.request_namespace.eq(Cat(*fields[:3])),
            d.request_thread.eq(fields[3]), d.request_target.eq(fields[4]),
            d.request.eq(request),
            p.ready.eq(self.enabled & (p.read | p.write)),
            p.error.eq(p.ready & (~d.enabled | (p.read & p.write) |
                                 (p.read & ~read_ok) | (p.write & ~write_ok))),
            request.eq(self.enabled & d.enabled & p.write & ~p.read &
                       (p.address == BASE + 20) & (p.wdata == 1) &
                       (mask == 31) & same),
            rx.pop.eq(p.ready & ~p.error & p.read & (p.address == BASE)),
            rx.commit.eq(p.ready & ~p.error & p.write & (p.address == BASE + 12)),
            rx.commit_transaction.eq(p.wdata),
        ]
        with m.Switch(p.address):
            with m.Case(BASE):
                m.d.comb += [read_ok.eq(locked & (rx.consumed < rx.size)),
                             data.eq(rx.word)]
            with m.Case(BASE + 4):
                m.d.comb += [read_ok.eq(1), data.eq(Mux(d.failure_latched, rx.FAILED, rx.state))]
            with m.Case(BASE + 8):
                m.d.comb += [read_ok.eq(1), data.eq(d.owner.owner_target)]
            with m.Case(BASE + 12):
                m.d.comb += [read_ok.eq(1), data.eq(d.owner.transaction),
                    write_ok.eq(locked & (rx.consumed == rx.size) &
                                (p.wdata == d.owner.transaction))]
            with m.Case(BASE + 16):
                m.d.comb += [read_ok.eq(1), data.eq(rx.size)]
            with m.Case(BASE + 20):
                m.d.comb += write_ok.eq(request & d.accepted)
            with m.Case(BASE + 24):
                m.d.comb += [read_ok.eq(1), data.eq(rx.expected_header)]
            for i, field in enumerate(fields):
                with m.Case(BASE + 28 + i * 4):
                    m.d.comb += write_ok.eq(same & ~d.owner.active)
                    with m.If(p.ready & ~p.error & p.write):
                        m.d.sync += [field.eq(p.wdata), mask[i].eq(1),
                                     writer_ns.eq(self.namespace),
                                     writer_thread.eq(self.thread)]
        m.d.sync += [p.rvalid.eq(p.ready & p.read), p.rerror.eq(p.error),
                     p.rdata.eq(data)]
        with m.If(~self.enabled | ~d.enabled | d.accepted):
            m.d.sync += mask.eq(0)
        return m
