"""Clocked ROM-to-memory initialization with explicit fetch/write sequencing."""

from amaranth import Elaboratable, Module, Signal, unsigned
from amaranth.lib.memory import Memory


class SparseMemoryInitializer(Elaboratable):
    """Write each supplied (14-bit word address, 32-bit data) pair exactly once.

    The sink accepts every enabled write on the rising edge. ``enable`` may
    pause either phase; ``done`` rises only after the last write is accepted.
    No ROM power-up output value is assumed, including for the first entry.
    """

    def __init__(self, pairs):
        self.pairs = tuple(pairs)
        if any(not 0 <= a < (1 << 14) or not 0 <= d < (1 << 32)
               for a, d in self.pairs):
            raise ValueError("Initialization address or data is out of range")
        self.enable = Signal()
        self.done = Signal(init=not self.pairs)
        self.write_en = Signal()
        self.write_addr = Signal(14)
        self.write_data = Signal(32)

    def elaborate(self, platform):
        m = Module()
        rom = m.submodules.init_rom = Memory(
            shape=unsigned(46),
            depth=max(1, len(self.pairs)),
            init=[(a << 32) | d for a, d in self.pairs] or [0],
        )
        rd = rom.read_port(domain="sync")
        index = Signal(range(max(2, len(self.pairs))))
        ready = Signal()
        active = self.enable & ~self.done
        m.d.comb += [
            rd.addr.eq(index),
            rd.en.eq(active & ~ready),
            self.write_en.eq(active & ready),
            self.write_addr.eq(rd.data[32:46]),
            self.write_data.eq(rd.data[:32]),
        ]
        with m.If(active):
            with m.If(~ready):
                # This edge fetches the current entry; write only next cycle.
                m.d.sync += ready.eq(1)
            with m.Else():
                m.d.sync += ready.eq(0)
                with m.If(index == max(0, len(self.pairs) - 1)):
                    m.d.sync += self.done.eq(1)
                with m.Else():
                    m.d.sync += index.eq(index + 1)
        return m
