"""Single-flight ownership latch for the native Amoeba service boundary.

The trusted service supplies selection_valid only after selecting its exact
provisioned Namespace/target record. This latch does not validate capabilities,
grant publication, queue requests or alter CPU scheduling.
"""
from amaranth import Elaboratable, Module, Signal


class TransferOwner(Elaboratable):
    def __init__(self):
        for name in ("enabled", "request", "selection_valid", "accepted", "rejected",
                     "active", "finish", "finished", "fault", "cancelled"):
            setattr(self, name, Signal(name=name))
        for name in ("epoch", "request_thread", "request_target", "transaction",
                     "owner_epoch", "owner_thread", "owner_target",
                     "finish_epoch", "finish_transaction", "fault_thread"):
            setattr(self, name, Signal(32, name=name))
        self.request_namespace = Signal(96)
        self.owner_namespace = Signal(96)
        self.fault_namespace = Signal(96)

    def elaborate(self, platform):
        m = Module()
        epoch = Signal(32)
        owner_fault = self.fault & self.active & (
            self.fault_namespace == self.owner_namespace) & (
            self.fault_thread == self.owner_thread)
        finish_ok = self.finish & self.active & (
            self.finish_epoch == self.owner_epoch) & (
            self.finish_transaction == self.transaction)
        stable = self.enabled & (self.epoch == epoch)
        m.d.comb += [
            self.accepted.eq(stable & self.request & self.selection_valid &
                             ~self.active & ~self.fault & ~self.finish &
                             (self.transaction != 0xffffffff)),
            self.rejected.eq(self.request & ~self.accepted),
            self.finished.eq(stable & finish_ok & ~owner_fault),
            self.cancelled.eq(self.active & (~stable | owner_fault)),
        ]
        with m.If(self.epoch != epoch):
            m.d.sync += [epoch.eq(self.epoch), self.active.eq(0),
                         self.transaction.eq(0)]
        with m.Elif(~self.enabled | owner_fault):
            # Preserve the transaction counter on cancellation/disable. Reuse
            # in the same image epoch must not make delayed responses current.
            m.d.sync += self.active.eq(0)
        with m.Elif(self.finished):
            m.d.sync += self.active.eq(0)
        with m.Elif(self.accepted):
            m.d.sync += [
                self.active.eq(1), self.owner_epoch.eq(self.epoch),
                self.transaction.eq(self.transaction + 1),
                self.owner_namespace.eq(self.request_namespace),
                self.owner_thread.eq(self.request_thread),
                self.owner_target.eq(self.request_target),
            ]
        return m
