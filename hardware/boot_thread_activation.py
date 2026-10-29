"""Incoming-only reset activation; validate and buffer before register writes.

No outgoing Thread save, instruction execution, M grant, or CR13/CR14 write.
Inputs are a structurally validated Thread and machine-owned marker admission.
"""
from amaranth import *
from .hw_types import FaultType, M_BIT_PORT
from .integrity32 import integrity32_amaranth
from .boot_pair_guard import validate_boot_guard
from .ascending_authority import cached_authority


class BootThreadActivation(Elaboratable):
    def __init__(self, *, expected_guard):
        validate_boot_guard(expected_guard)
        self.expected_guard = expected_guard
        self.start = Signal()
        self.base_word = Signal(32)
        self.authority = Signal(32)
        self.header = Signal(32)
        self.indicator = Signal(32)
        self.entry_gt = Signal(32)
        self.resume = Signal()
        self.namespace_slots = Signal(13)
        self.mem_addr = Signal(32)
        self.mem_en = Signal()
        self.mem_data = Signal(32)
        self.mem_valid = Signal()
        self.busy = Signal()
        self.done = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)
        self.cr_en = Signal()
        self.cr_addr = Signal(4)
        self.cr_data = Signal(96)
        self.dr_en = Signal()
        self.dr_addr = Signal(4)
        self.dr_data = Signal(32)
        self.flags_en = Signal()
        self.flags = Signal(4)
        self.thread_base_byte = Signal(32)

    def elaborate(self, platform):
        m = Module()
        base, authority, header, indicator, entry = [Signal(32) for _ in range(5)]
        slots = Signal(13)
        resume = Signal()
        row = Signal(4)
        part = Signal(range(3))
        armed = Signal()
        gt = Signal(32)
        descriptor = Array(Signal(32) for _ in range(3))
        caps = Array(Signal(96) for _ in range(12))
        drs = Array(Signal(32) for _ in range(16))
        size = Signal(15)
        cap_start = Signal(15)
        seal = Signal(32)
        integrity32_amaranth(m, descriptor[0], descriptor[1], seal)
        m.d.comb += [
            size.eq(Const(1, 15) << (header[23:27] + 6)),
            cap_start.eq(size - 12),
            self.thread_base_byte.eq(base << 2),
            self.flags.eq(indicator[28:32]),
        ]

        def fail(code):
            m.d.sync += self.fault_type.eq(code)
            m.next = "FAULT"

        def read(address):
            m.d.comb += [self.mem_addr.eq(address), self.mem_en.eq(1)]
            m.d.sync += armed.eq(1)

        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        base.eq(self.base_word), authority.eq(self.authority),
                        header.eq(self.header), indicator.eq(self.indicator),
                        entry.eq(self.entry_gt), slots.eq(self.namespace_slots),
                        resume.eq(self.resume),
                        row.eq(0), armed.eq(0), self.fault_type.eq(0),
                    ]
                    m.next = "HOME"
            with m.State("HOME"):
                read((base + cap_start + row) << 2)
                with m.If(armed & self.mem_valid):
                    m.d.sync += [armed.eq(0), gt.eq(self.mem_data)]
                    with m.If(~resume & (row == 0) & (self.mem_data != entry)):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Else():
                        m.next = "KIND"
            with m.State("KIND"):
                with m.If(gt[25:27] == 0):
                    # NULL discards all cached authority, including its payload.
                    m.d.sync += caps[row].eq(0)
                    m.next = "NEXT"
                with m.Elif(gt[25:27] == 2):
                    # No authenticated Outform-to-resident ingress exists here.
                    # A zero-based cache must never turn it into memory authority.
                    fail(FaultType.OUTFORM_UNAUTH)
                with m.Elif(gt[25:27] == 3):
                    # Abstract operands remain opaque, without cached resident
                    # authority; ordinary instruction type gates still apply.
                    m.d.sync += caps[row].eq(Cat(gt, Const(0, 64)))
                    m.next = "NEXT"
                with m.Elif((gt[:16] == 0) | (gt[:16] >= slots)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += part.eq(0)
                    m.next = "DESCRIPTOR"
            with m.State("DESCRIPTOR"):
                read((gt[:16] << 4) + (part << 2))
                with m.If(armed & self.mem_valid):
                    m.d.sync += [descriptor[part].eq(self.mem_data), armed.eq(0)]
                    with m.If(part == 2):
                        m.next = "CHECK"
                    with m.Else():
                        m.d.sync += part.eq(part + 1)
            with m.State("CHECK"):
                with m.If(gt[16:25] != descriptor[1][21:30]):
                    fail(FaultType.VERSION)
                with m.Elif(seal != descriptor[2]):
                    fail(FaultType.SEAL)
                with m.Elif(descriptor[1][31]):
                    fail(FaultType.BOUNDS)
                with m.Elif(descriptor[0] < 16384):
                    with m.If(descriptor[0] + descriptor[1][:21] >= 16384):
                        fail(FaultType.BOUNDS)
                    with m.Else():
                        m.d.sync += caps[row].eq(Cat(
                            gt, (descriptor[0] << 2)[:32], cached_authority(descriptor[1])))
                        m.next = "NEXT"
                with m.Elif((descriptor[0][30:32] == 1) | (descriptor[0] == M_BIT_PORT)):
                    m.d.sync += caps[row].eq(Cat(gt, descriptor[0], cached_authority(descriptor[1])))
                    m.next = "NEXT"
                with m.Else():
                    fail(FaultType.BOUNDS)
            with m.State("NEXT"):
                with m.If(row == 11):
                    m.d.sync += row.eq(1)
                    m.next = "DR"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
                    m.next = "HOME"
            with m.State("DR"):
                read((base + 1 + row) << 2)
                with m.If(armed & self.mem_valid):
                    m.d.sync += [drs[row].eq(self.mem_data), armed.eq(0)]
                    with m.If(row == 15):
                        m.d.sync += row.eq(0)
                        m.next = "COMMIT_CAPS"
                    with m.Else():
                        m.d.sync += row.eq(row + 1)
            with m.State("COMMIT_CAPS"):
                m.d.comb += [self.cr_en.eq(1), self.cr_addr.eq(row), self.cr_data.eq(caps[row])]
                with m.If(row == 11):
                    m.next = "COMMIT_THREAD"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("COMMIT_THREAD"):
                m.d.comb += [
                    self.cr_en.eq(1), self.cr_addr.eq(12),
                    self.cr_data.eq(Cat(
                        Const(0x02000002 | ((self.expected_guard & 511) << 16), 32),
                        (base << 2)[:32], cached_authority(authority))),
                ]
                m.next = "COMMIT_HEAP"
            with m.State("COMMIT_HEAP"):
                m.d.comb += [
                    self.cr_en.eq(1), self.cr_addr.eq(5),
                    self.cr_data.eq(Cat(
                        Const(0x32000002 | ((self.expected_guard & 511) << 16), 32),
                        ((base + 18) << 2)[:32],
                        ((size - header[10:23] - 31).as_unsigned() |
                         Const((self.expected_guard & 511) << 21, 32))[:32])),
                ]
                m.d.sync += row.eq(1)
                m.next = "COMMIT_DR"
            with m.State("COMMIT_DR"):
                m.d.comb += [self.dr_en.eq(1), self.dr_addr.eq(row), self.dr_data.eq(drs[row])]
                with m.If(row == 15):
                    m.next = "FLAGS"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("FLAGS"):
                m.d.comb += self.flags_en.eq(1)
                m.next = "DONE"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.fault.eq(1)
                m.next = "IDLE"
            m.d.comb += self.busy.eq(~fsm.ongoing("IDLE"))
        return m
