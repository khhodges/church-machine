"""Selected-record delivery into the isolated bank, never executable writes.

This is a memory-side adapter, not cross-Namespace request arbitration. The
record set must belong to one explicitly provisioned service context until the
Namespace-qualified pending-request contract is connected.
"""
from amaranth import Elaboratable, Module, Signal
from .amoeba_receiver import AmoebaReceiver


class CandidateDelivery(Elaboratable):
    def __init__(self, memory, records, *, clock_hz=25_000_000):
        self.memory = memory
        self.receiver = AmoebaReceiver(
            records, staging_base=0x20000, staging_words=4096,
            clock_hz=clock_hz, memory_profile="candidate128")
        self.enabled = Signal()
        self.epoch = Signal(32)

    def elaborate(self, platform):
        m = Module()
        m.submodules.receiver = rx = self.receiver
        mem = self.memory
        m.d.comb += [
            rx.running.eq(self.enabled), rx.epoch.eq(self.epoch),
            mem.receiver_enabled.eq(self.enabled),
            mem.receive.write.eq(rx.memory_write & self.enabled),
            mem.receive.address.eq(0x20000 + (rx.memory_address << 2)),
            mem.receive.wdata.eq(rx.memory_data),
            rx.memory_ready.eq(mem.receive.ready & ~mem.receive.error),
            # The runtime owner must reserve this inspection channel. No
            # competing admission hash or debugger may drive it concurrently.
            mem.inspect.read.eq(self.enabled),
            mem.inspect.address.eq(0x20000 + (rx.read_address << 2)),
            rx.read_data.eq(mem.inspect.rdata),
        ]
        return m
