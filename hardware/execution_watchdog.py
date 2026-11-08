"""Execution watchdog timing/control unit; not a software-accessible device.

Integration must supply already-authorized control writes, the real ungated
clock frequency, execution boundaries and successful transition completions.
Expiry is a containment request, not proof that accepted writes have drained
or that fault evidence/recovery completed. No MMIO address is assigned here.
"""
from amaranth import Array, Const, Elaboratable, Module, Signal


class ExecutionWatchdog(Elaboratable):
    def __init__(self, *, clock_hz):
        if isinstance(clock_hz, bool) or not isinstance(clock_hz, int):
            raise ValueError("watchdog clock_hz must be an integer")
        if clock_hz <= 0 or clock_hz % 4:
            raise ValueError("watchdog periods require positive integral clock counts")
        self.periods = (clock_hz // 4, clock_hz // 2, clock_hz, clock_hz * 2)
        # Reset execution state, not the retained configuration.
        self.execution_reset = Signal()
        self.execution_start = Signal()
        # Only successful CHANGE/SWITCH or completed LLR may drive this input.
        self.transition_complete = Signal()
        self.control_write = Signal()
        self.control_data = Signal(32)
        self.control_read = Signal(32)
        self.control_accepted = Signal()
        self.invalid_control = Signal()
        self.control_rejected = Signal()
        self.expiry = Signal()
        self.expired = Signal()
        self.block_program_writes = Signal()
        # Internal observability for RTL tests, not a countdown/status MMIO ABI.
        self.active = Signal()
        self.remaining = Signal(range(self.periods[-1] + 1))
        self.control = Signal(3, init=5, reset_less=True)

    def elaborate(self, platform):
        m = Module()
        selected = Array(Const(value, len(self.remaining)) for value in self.periods)
        next_control = Signal(3)
        leaving_exemption = Signal()
        m.d.comb += [
            self.control_read.eq(self.control),
            self.expiry.eq(self.active & (self.remaining == 1) &
                           ~self.execution_reset),
            self.invalid_control.eq(self.control_write & (self.control_data[3:] != 0) &
                                    ~self.execution_reset),
            self.control_accepted.eq(self.control_write & ~self.invalid_control &
                                     ~self.expiry & ~self.expired & ~self.execution_reset),
            self.control_rejected.eq(self.control_write & ~self.control_accepted),
            next_control.eq(self.control),
            leaving_exemption.eq(self.control_accepted & self.control[0] &
                                 ~self.control_data[0]),
            self.block_program_writes.eq(self.expiry | self.expired),
        ]
        with m.If(self.control_accepted):
            m.d.comb += next_control.eq(self.control_data[:3])
            m.d.sync += self.control.eq(next_control)

        with m.If(self.execution_reset):
            m.d.sync += [self.active.eq(0), self.remaining.eq(0), self.expired.eq(0)]
        with m.Elif(self.expiry):
            # Neither a transfer nor exemption enabling rescues this edge.
            m.d.sync += [self.expired.eq(1), self.active.eq(0), self.remaining.eq(0)]
        with m.Elif(~self.expired):
            with m.If(next_control[0]):
                m.d.sync += [self.active.eq(0), self.remaining.eq(0)]
            with m.Elif(self.execution_start | self.transition_complete | leaving_exemption):
                m.d.sync += [self.active.eq(1), self.remaining.eq(selected[next_control[1:3]])]
            with m.Elif(self.active):
                m.d.sync += self.remaining.eq(self.remaining - 1)
        return m
