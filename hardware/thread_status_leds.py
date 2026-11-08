"""Passive two-LED status unit for the bounded Phase 2 RTL trial.

Inputs must be synchronous: one pulse per successful CHANGE, every Hard Fault,
and an already-authorized security-monitor clear. No MMIO ABI is assigned.
This unit has no execution, scheduler, fault-record or reset-request outputs.
It is not yet connected to the installed Wukong wrapper.
"""
from amaranth import Elaboratable, Module, Signal


class ThreadStatusLEDs(Elaboratable):
    def __init__(self, *, clock_hz):
        if (isinstance(clock_hz, bool) or not isinstance(clock_hz, int)
                or clock_hz < 4 or clock_hz % 4):
            raise ValueError("clock_hz must be a positive multiple of four")
        self.half_period = clock_hz // 4  # two complete blink cycles per second
        self.board_reset = Signal()
        self.change_complete = Signal()
        self.hard_fault = Signal()
        self.monitor_clear = Signal()
        self.count = Signal(2)
        self.fault_pending = Signal()
        self.led_on = Signal(2)
        self.led_pins = Signal(2)  # active-low physical outputs

    def elaborate(self, platform):
        m = Module()
        phase = Signal(init=1)
        ticks = Signal(range(max(2, self.half_period)))
        with m.If(self.board_reset):
            m.d.sync += [
                self.count.eq(0), self.fault_pending.eq(0),
                ticks.eq(0), phase.eq(1),
            ]
        with m.Else():
            with m.If(self.change_complete):
                m.d.sync += self.count.eq(self.count + 1)
            with m.If(self.hard_fault):
                m.d.sync += self.fault_pending.eq(1)
            with m.Elif(self.monitor_clear):
                m.d.sync += self.fault_pending.eq(0)
            # Start visibly ON at the first fault. Repeated fault assertions
            # must not restart the divider and suppress blinking.
            with m.If(~self.fault_pending):
                m.d.sync += [ticks.eq(0), phase.eq(1)]
            with m.Elif(ticks == self.half_period - 1):
                m.d.sync += [ticks.eq(0), phase.eq(~phase)]
            with m.Else():
                m.d.sync += ticks.eq(ticks + 1)
        with m.If(self.fault_pending):
            m.d.comb += self.led_on.eq(phase.replicate(2))
        with m.Else():
            m.d.comb += self.led_on.eq(self.count)
        m.d.comb += self.led_pins.eq(~self.led_on)
        return m
