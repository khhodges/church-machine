"""Fixed one-second diagnostic timer; no software control or exemption port.

Integration must supply successful transition completion, never issue/detection,
and must enforce block_program_writes at every program-write destination.
This component alone is not integrated watchdog enforcement.
"""
from amaranth import Elaboratable, Module, Signal


class FixedWatchdog(Elaboratable):
    def __init__(self, *, clock_hz):
        if type(clock_hz) is not int or clock_hz <= 0:
            raise ValueError("clock_hz must be a positive integer")
        self.period = clock_hz
        self.execution_start = Signal()
        self.transition_complete = Signal()
        self.active = Signal()
        self.remaining = Signal(range(clock_hz + 1))
        self.expiry = Signal()
        self.expired = Signal()
        self.block_program_writes = Signal()

    def elaborate(self, platform):
        m = Module()
        m.d.comb += [
            self.expiry.eq(self.active & (self.remaining == 1)),
            self.block_program_writes.eq(self.expiry | self.expired),
        ]
        with m.If(self.expiry):
            m.d.sync += [self.expired.eq(1), self.active.eq(0),
                         self.remaining.eq(0)]
        with m.Elif(~self.expired):
            with m.If(self.execution_start | self.transition_complete):
                m.d.sync += [self.active.eq(1), self.remaining.eq(self.period)]
            with m.Elif(self.active):
                m.d.sync += self.remaining.eq(self.remaining - 1)
        return m
