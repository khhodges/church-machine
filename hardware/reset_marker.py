"""One-shot admission for the approved 0x27000001 reset-only CHANGE marker.

All context inputs must be wired to machine-owned state, never software M bits.
Admission is consumed on acceptance, not on later Thread-validation success.
The block grants no memory access and does not implement Thread activation.
"""
from amaranth import *
from .hw_types import FaultType

RESET_MARKER_WORD = 0x27000001


class ResetMarkerAdmission(Elaboratable):
    def __init__(self, marker_byte_address=4):
        if marker_byte_address < 0 or marker_byte_address & 3:
            raise ValueError("Reset marker address must be word aligned")
        self.marker_byte_address = marker_byte_address
        self.reset_enter = Signal()
        self.boot_handoff = Signal()
        self.issue = Signal()
        self.instruction = Signal(32)
        self.fetch_address = Signal(32)
        self.trusted_rom_fetch = Signal()
        self.namespace_admitted = Signal()
        self.accepted = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)
        self.available = Signal()

    def elaborate(self, platform):
        m = Module()
        active = Signal()
        consumed = Signal()
        marker = Signal()
        allowed = Signal()
        m.d.comb += [
            marker.eq(self.issue & (self.instruction == RESET_MARKER_WORD)),
            self.available.eq(active & ~consumed),
            allowed.eq(self.available & self.trusted_rom_fetch &
                       self.namespace_admitted &
                       (self.fetch_address == self.marker_byte_address) &
                       ~self.reset_enter & ~self.boot_handoff),
            self.accepted.eq(marker & allowed),
            self.fault.eq(marker & ~allowed),
            self.fault_type.eq(Mux(self.fault, FaultType.INVALID_OP, FaultType.NONE)),
        ]
        with m.If(self.reset_enter):
            m.d.sync += [active.eq(1), consumed.eq(0)]
        with m.Elif(self.boot_handoff):
            m.d.sync += active.eq(0)
        with m.Elif(self.accepted):
            m.d.sync += consumed.eq(1)
        return m
