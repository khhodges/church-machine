"""Experimental address-issue/fetch/write initializer; not wired into Wukong."""
from amaranth import Module, Signal, unsigned
from amaranth.lib.memory import Memory

from .sparse_memory_init import SparseMemoryInitializer


class AddressedSparseMemoryInitializer(SparseMemoryInitializer):
    def elaborate(self, platform):
        m = Module()
        count = len(self.pairs)
        rom = m.submodules.init_rom = Memory(
            shape=unsigned(46), depth=max(1, count),
            init=[(a << 32) | d for a, d in self.pairs] or [0],
        )
        rd = rom.read_port(domain="sync")
        next_index = Signal(range(max(2, count)))
        # Unconsumed startup address. For a multi-entry ROM the first ISSUE
        # must clock an actual address transition to zero; do not rely on a
        # combinatorial ROM value implied by a counter's power-up value.
        issued_index = Signal(range(max(2, count)), init=max(0, count - 1))
        phase = Signal(range(3))  # ISSUE=0, FETCH=1, WRITE=2
        active = self.enable & ~self.done
        m.d.comb += [
            rd.addr.eq(issued_index),
            rd.en.eq(active & (phase == 1)),
            self.write_en.eq(active & (phase == 2)),
            self.write_addr.eq(rd.data[32:46]),
            self.write_data.eq(rd.data[:32]),
        ]
        with m.If(active):
            with m.Switch(phase):
                with m.Case(0):
                    m.d.sync += [issued_index.eq(next_index), phase.eq(1)]
                with m.Case(1):
                    m.d.sync += phase.eq(2)
                with m.Case(2):
                    m.d.sync += phase.eq(0)
                    with m.If(next_index == max(0, count - 1)):
                        m.d.sync += self.done.eq(1)
                    with m.Else():
                        m.d.sync += next_index.eq(next_index + 1)
        return m
