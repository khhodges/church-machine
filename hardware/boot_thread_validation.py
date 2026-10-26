"""Read-only slot-2 admission checks; no register restoration or activation."""
from amaranth import *
from .boot_pair_guard import BootPairGuard, validate_boot_guard
from .integrity32 import integrity32_amaranth
from .hw_types import FaultType
from .thread_design import THREAD_MIN_N_MINUS_6, THREAD_MAX_N_MINUS_6


class BootThreadValidation(Elaboratable):
    def __init__(self, *, expected_guard):
        validate_boot_guard(expected_guard)
        self.expected_guard = expected_guard
        self.start = Signal()
        self.namespace_slots = Signal(13)
        self.mem_addr = Signal(32)
        self.mem_en = Signal()
        self.mem_data = Signal(32)
        self.mem_valid = Signal()
        self.done = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)
        self.base_word = Signal(32)
        self.authority = Signal(32)
        self.header = Signal(32)
        self.indicator = Signal(32)
        self.entry_gt = Signal(32)

    def elaborate(self, platform):
        m = Module()
        m.submodules.guard = guard = BootPairGuard(expected_guard=self.expected_guard)
        d = Array(Signal(32) for _ in range(4))
        index = Signal(range(9))
        armed = Signal()
        slots = Signal(13)
        computed = Signal(32)
        integrity32_amaranth(m, d[0], d[1], computed)
        size = Signal(15)
        caps = Signal(15)
        stack_start = Signal(15)
        m.d.comb += [
            size.eq(Const(1, 15) << (self.header[23:27] + 6)),
            caps.eq(size - 12),
            stack_start.eq(caps - self.header[10:23]),
            guard.thread_stage.eq(1),
            guard.observed_version.eq(d[1][17:26]),
        ]

        def fail(code):
            m.d.sync += self.fault_type.eq(code)
            m.next = "FAULT"

        with m.FSM():
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        index.eq(0), armed.eq(0), slots.eq(self.namespace_slots),
                        self.fault_type.eq(0), self.base_word.eq(0),
                        self.authority.eq(0), self.header.eq(0),
                        self.indicator.eq(0), self.entry_gt.eq(0),
                    ]
                    m.next = "READ"
            with m.State("READ"):
                m.d.comb += self.mem_en.eq(1)
                with m.Switch(index):
                    with m.Case(0, 1, 2, 3):
                        m.d.comb += self.mem_addr.eq(32 + (index << 2))
                    with m.Case(4):
                        m.d.comb += self.mem_addr.eq(d[0] << 2)
                    with m.Case(5):
                        m.d.comb += self.mem_addr.eq((d[0] + 17) << 2)
                    with m.Case(6):
                        m.d.comb += self.mem_addr.eq((d[0] + caps - 2) << 2)
                    with m.Case(7):
                        m.d.comb += self.mem_addr.eq((d[0] + caps - 1) << 2)
                    with m.Case(8):
                        m.d.comb += self.mem_addr.eq((d[0] + caps) << 2)
                m.d.sync += armed.eq(1)
                with m.If(armed & self.mem_valid):
                    m.d.sync += armed.eq(0)
                    with m.Switch(index):
                        with m.Case(0, 1, 2):
                            m.d.sync += [d[index].eq(self.mem_data), index.eq(index + 1)]
                        with m.Case(3):
                            m.d.sync += d[3].eq(self.mem_data)
                            m.next = "VERSION_START"
                        with m.Case(4):
                            m.d.sync += self.header.eq(self.mem_data)
                            m.next = "HEADER_CHECK"
                        with m.Case(5):
                            m.d.sync += self.indicator.eq(self.mem_data)
                            m.next = "INDICATOR_CHECK"
                        with m.Case(6):
                            m.d.sync += self.entry_gt.eq(self.mem_data)
                            with m.If((self.mem_data[25:27] != 1) |
                                      ~self.mem_data[27] | (self.mem_data[28:31] != 4)):
                                fail(FaultType.STACK_CORRUPT)
                            with m.Else():
                                m.d.sync += index.eq(7)
                        with m.Case(7):
                            with m.If(self.mem_data != ((caps - 1) | (0x7fff << 13) | 0x1000)):
                                fail(FaultType.STACK_CORRUPT)
                            with m.Else():
                                m.d.sync += index.eq(8)
                        with m.Case(8):
                            with m.If(self.mem_data != self.entry_gt):
                                fail(FaultType.STACK_CORRUPT)
                            with m.Else():
                                m.d.sync += [self.base_word.eq(d[0]), self.authority.eq(d[1])]
                                m.next = "DONE"
            with m.State("VERSION_START"):
                m.d.comb += guard.start.eq(1)
                m.next = "VERSION_WAIT"
            with m.State("VERSION_WAIT"):
                with m.If(guard.fault):
                    fail(guard.fault_type)
                with m.Elif(guard.accepted):
                    m.next = "DESCRIPTOR_CHECK"
            with m.State("DESCRIPTOR_CHECK"):
                with m.If(computed != d[2]):
                    fail(FaultType.SEAL)
                with m.Elif(d[1][31] | (d[0] < (slots << 2)) |
                            (d[0] >= 16384) | (d[1][:17] >= 16384) |
                            ((d[0] + d[1][:17]) >= 16384)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += index.eq(4)
                    m.next = "READ"
            with m.State("HEADER_CHECK"):
                with m.If(
                    (self.header[27:32] != 31) | (self.header[8:10] != 2) |
                    (self.header[:8] != 12) |
                    (self.header[23:27] < THREAD_MIN_N_MINUS_6) |
                    (self.header[23:27] > THREAD_MAX_N_MINUS_6) |
                    (self.header[10:23] == 0) | (self.header[10:23] >= size - 30) |
                    (d[1][:17] != size - 1)
                ):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += index.eq(5)
                    m.next = "READ"
            with m.State("INDICATOR_CHECK"):
                with m.If(
                    (self.indicator[:28] != ((caps - 3) | 0x1000)) |
                    (caps - 3 < stack_start) | (caps - 1 > 0xfff)
                ):
                    fail(FaultType.STACK_CORRUPT)
                with m.Else():
                    m.d.sync += index.eq(6)
                    m.next = "READ"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.fault.eq(1)
                m.next = "IDLE"
        return m
