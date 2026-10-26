"""The approved reset boot-pair VERSION comparison, independent of geometry.

Called at each admission stage; does not preflight or activate either object.
Expected versions are explicit elaboration constants, never read from the image.
This block does not generate guards, grant reset authority, or modify versions.
"""
from amaranth import *
from .hw_types import FaultType


def validate_boot_guard(expected_guard):
    """Validate explicit build configuration before allocating any RTL objects."""
    if (isinstance(expected_guard, bool) or not isinstance(expected_guard, int)
            or not 0 <= expected_guard < (1 << 18)
            or (expected_guard >> 9) == 511 or (expected_guard & 511) == 511):
        raise ValueError("Expected boot guard must contain two versions in 0–510")


class BootPairGuard(Elaboratable):
    def __init__(self, *, expected_guard):
        validate_boot_guard(expected_guard)
        self.expected_guard = expected_guard
        self.start = Signal()
        self.thread_stage = Signal()  # 0 = slot 1 admission, 1 = slot 2
        self.observed_version = Signal(9)
        self.done = Signal()
        self.accepted = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)
        self.fault_slot = Signal(2)

    def elaborate(self, platform):
        m = Module()
        thread_stage = Signal()
        version = Signal(9)
        expected = Signal(9)
        m.d.comb += expected.eq(Mux(
            thread_stage, self.expected_guard & 511, self.expected_guard >> 9))
        with m.FSM():
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        thread_stage.eq(self.thread_stage),
                        version.eq(self.observed_version),
                    ]
                    m.next = "RESULT"
            with m.State("RESULT"):
                m.d.comb += [
                    self.done.eq(1),
                    self.accepted.eq(version == expected),
                    self.fault.eq(version != expected),
                    self.fault_type.eq(Mux(version == expected,
                                           FaultType.NONE, FaultType.VERSION)),
                    self.fault_slot.eq(Mux(version == expected, 0,
                                           Mux(thread_stage, 2, 1))),
                ]
                m.next = "IDLE"
        return m
