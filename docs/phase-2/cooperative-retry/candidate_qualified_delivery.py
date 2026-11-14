"""Single-flight qualified record delivery; trusted service inputs, not MMIO.

CRQ1/CLQ1 use an immutable table selector, NEVER a Namespace slot number.
The provisioned table binds that selector to Namespace96 + exact target GT32.
No executable writes or publication authority are provided by this adapter.
"""
from amaranth import Elaboratable, Module, Signal
from .candidate_delivery import CandidateDelivery
from .candidate_transfer_owner import TransferOwner


class QualifiedDelivery(Elaboratable):
    def __init__(self, memory, records, *, clock_hz=25_000_000):
        self.records = tuple(dict(r) for r in records)
        keys = set()
        normalized = []
        for i, record in enumerate(self.records):
            ns, target = record["namespace"], record["target"]
            if (type(ns) is not int or not 0 < ns < 2**96 or
                    type(target) is not int or not 0 < target < 2**32 or
                    (target & 0xffff) != record["slot"] or
                    (ns, target) in keys):
                raise ValueError("Invalid or duplicate qualified record identity")
            keys.add((ns, target))
            normalized.append(dict(record, slot=i + 3))
        self.delivery = CandidateDelivery(memory, normalized, clock_hz=clock_hz,
                                          qualified=True)
        self.receiver = self.delivery.receiver
        self.owner = TransferOwner()
        self.enabled = Signal()
        self.epoch = Signal(32)
        self.request = Signal()
        self.request_namespace = Signal(96)
        self.request_thread = Signal(32)
        self.request_target = Signal(32)
        self.accepted, self.rejected = Signal(), Signal()
        self.failed, self.completed = Signal(), Signal()
        # Fault identity comes from the trusted termination path, not UART.
        self.fault = Signal()
        self.fault_namespace = Signal(96)
        self.fault_thread = Signal(32)

    def elaborate(self, platform):
        m = Module()
        m.submodules.delivery = d = self.delivery
        m.submodules.owner = o = self.owner
        rx = self.receiver
        selected = Signal(8)
        launch = Signal()
        valid = Signal()
        choice = Signal(8)
        for i, record in enumerate(self.records):
            with m.If((self.request_namespace == record["namespace"]) &
                      (self.request_target == record["target"])):
                m.d.comb += [valid.eq(1), choice.eq(i + 3)]
        m.d.comb += [
            o.enabled.eq(self.enabled), o.epoch.eq(self.epoch),
            o.request.eq(self.request), o.selection_valid.eq(valid),
            o.request_namespace.eq(self.request_namespace),
            o.request_thread.eq(self.request_thread),
            o.request_target.eq(self.request_target),
            self.accepted.eq(o.accepted), self.rejected.eq(o.rejected),
            o.fault.eq(self.fault), o.fault_namespace.eq(self.fault_namespace),
            o.fault_thread.eq(self.fault_thread),
            d.enabled.eq(self.enabled & o.active & ~o.cancelled),
            d.epoch.eq(self.epoch),
            rx.request.eq(launch & o.active & ~o.cancelled),
            rx.request_slot.eq(selected),
            rx.request_transaction.eq(o.transaction),
            self.failed.eq(o.active & (rx.state == rx.FAILED)),
            self.completed.eq(o.active & (rx.state == rx.CONSUMED)),
            o.finish.eq(self.failed | self.completed),
            o.finish_epoch.eq(o.owner_epoch), o.finish_transaction.eq(rx.transaction),
        ]
        m.d.sync += launch.eq(o.accepted)
        with m.If(o.accepted):
            m.d.sync += selected.eq(choice)
        return m
