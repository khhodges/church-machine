"""Machine-owned local-RAM fault entry. No event snapshot lives in this unit.

The owner freezes the issuing engine until ``release_source``. All event stores
read that engine directly. Working header/indicator registers are geometry,
not an alternate event bank. Every bus operation has the local one-edge
contract; no retry or elapsed-time watchdog is used.
"""
from dataclasses import dataclass
import hashlib
import struct

from amaranth import *
from .fault_stash import FaultStash
from .hw_types import FaultType
from .thread_design import (THREAD_SUPPORTED_BODY_WORDS, THREAD_MIN_N_MINUS_6,
                           THREAD_MAX_N_MINUS_6)


@dataclass(frozen=True)
class FaultBootBinding:
    namespace: int
    thread: int
    thread_words: int
    checks: tuple
    image_sha256: str
    resident_words: bool
    boot_guard: object

    @classmethod
    def from_prepared_image(cls, words, *, image_sha256, boot_guard):
        """Consume the selected ascending IDE image; never select artifacts.

        Boot Namespace and Boot.Thread are foundational slots 1 and 2.
        The LightningBolt/retained frame is already in the prepared Thread.
        No faultHandlerSlot or separate executable selection is consumed.
        """
        words = tuple(words)
        if (len(words) != 16384 or
                any(type(w) is not int or not 0 <= w <= 0xffffffff for w in words)):
            raise ValueError("Prepared Boot image must contain 16384 uint32 words")
        if words[4] != 0:
            raise ValueError("Prepared ascending Boot Namespace must start at zero")
        expected_guard = (((words[5] >> 21) & 511) << 9) | ((words[9] >> 21) & 511)
        if type(boot_guard) is not int or boot_guard != expected_guard:
            raise ValueError("Boot guard differs from prepared Namespace/Thread versions")
        namespace = (0x02000001 | ((words[5] >> 21) & 511) << 16 |
                     words[5] << 64)
        thread_gt = 0x02000002 | ((words[9] >> 21) & 511) << 16
        return cls.from_image(
            words, namespace=namespace, thread_gt=thread_gt,
            image_sha256=image_sha256, resident_words=True, boot_guard=boot_guard)

    @classmethod
    def from_image(cls, words, *, namespace, thread_gt,
                   image_sha256, resident_words=False, boot_guard=None):
        """Bind explicit inputs, never discover/select an artifact or revision."""
        words = tuple(words)
        if (len(words) != 16384 or
                any(type(w) is not int or not 0 <= w <= 0xffffffff for w in words)):
            raise ValueError("Fault entry requires 16384 uint32 words")
        digest = hashlib.sha256(b"".join(struct.pack("<I", w) for w in words)).hexdigest()
        if len(words) != 16384 or digest != image_sha256:
            raise ValueError("Fault entry requires the exact 64 KiB admitted image")
        if resident_words != (boot_guard is not None):
            raise ValueError("Fault entry address profile and boot guard must agree")
        root_gt = namespace & 0xffffffff
        root_base = (namespace >> 32) & 0xffffffff
        root_auth = namespace >> 64
        if (root_base % 4 or root_base >= 65536 or root_gt & 0xffff != 1 or
                root_gt >> 25 & 3 != 1 or root_auth & 0x80000000):
            raise ValueError("Invalid explicit Boot Namespace")
        if thread_gt & 0xfe00ffff != 0x02000002:
            raise ValueError("Boot.Thread must be permissionless slot 2")
        checks = {}

        def descriptor(gt):
            slot = gt & 0xffff
            if slot * 4 + 3 > (root_auth & 0x1fffff):
                raise ValueError("Binding outside Boot Namespace")
            address = root_base + slot * 16
            if address + 16 > 65536:
                raise ValueError("Descriptor aliases local RAM")
            raw, auth, seal, token = words[address // 4:address // 4 + 4]
            def rol(v, n):
                return ((v << n) | (v >> (32 - n))) & 0xffffffff
            if (seal != (rol(raw, 7) ^ rol(auth & 0x3fffffff, 13) ^ 0xdeadbeef) or
                    ((auth >> 21) & 511) != ((gt >> 16) & 511) or auth & 0x80000000):
                raise ValueError("Invalid sealed binding or version")
            base = raw * 4 if resident_words else raw
            limit = auth & 0x1fffff
            if base % 4 or base + (limit + 1) * 4 > 65536:
                raise ValueError("Binding aliases local RAM")
            for i, value in enumerate((raw, auth, seal, token)):
                checks[address + i * 4] = value
            return gt | base << 32 | auth << 64, base, limit

        root, _, _ = descriptor(root_gt)
        if root != namespace:
            raise ValueError("Boot root descriptor differs from trusted root")
        thread, base, limit = descriptor(thread_gt)
        size = limit + 1
        header = words[base // 4]
        if (size not in THREAD_SUPPORTED_BODY_WORDS or header >> 27 != 31 or
                (header >> 8) & 3 != 2 or header & 255 != 12 or
                1 << (((header >> 23) & 15) + 6) != size or
                not 0 < (header >> 10) & 8191 < size - 30):
            raise ValueError("Invalid Boot.Thread geometry")
        # The executable is selected by Boot.Thread's retained frame at
        # runtime, not by a second release-time handler selection.
        checks[base] = header
        if any(base <= a < base + size * 4 and a != base for a in checks):
            raise ValueError("Boot.Thread overlaps trusted descriptors")
        return cls(namespace, thread, size, tuple(sorted(checks.items())),
                   digest, resident_words, boot_guard)


class FaultEntry(Elaboratable):
    def __init__(self, binding):
        self.binding = binding
        for name in ("start", "safe", "owned", "busy", "freeze_source",
                     "release_source", "cleanup", "activate", "activated",
                     "activation_fault", "done", "catastrophic", "read_en",
                     "write_en", "read_valid", "write_granted",
                     "evidence_ready", "evidence_captured"):
            setattr(self, name, Signal())
        self.thread = Signal(96)
        self.namespace = Signal(96)
        self.code_base = Signal(32)
        self.code_gt = Signal(32)
        self.fault_code = Signal(5)
        self.fault_address = Signal(32)
        self.fault_instruction = Signal(32)
        self.flags = Signal(4)
        self.crs = Array(Signal(32, name=f"fault_live_cr{i}") for i in range(12))
        self.drs = Array(Signal(32, name=f"fault_live_dr{i}") for i in range(16))
        self.address, self.write_data, self.read_data = Signal(32), Signal(32), Signal(32)
        self.save_error = Signal(5)

    def elaborate(self, platform):
        m = Module()
        b = self.binding
        base = (b.thread >> 32) & 0xffffffff
        source = self.thread[32:64]
        limit = self.thread[64:85]
        end = Signal(34)
        header, indicator = Signal(32), Signal(32)
        size, caps, lo = Signal(16), Signal(16), Signal(16)
        row = Signal(5)
        index = Signal(range(len(b.checks)))
        checks_a = Array(Const(a, 32) for a, _ in b.checks)
        checks_d = Array(Const(d, 32) for _, d in b.checks)
        overlap = Signal()
        m.d.comb += [
            end.eq(source + ((limit + 1) << 2)),
            size.eq(Const(1, 16) << (header[23:27] + 6)),
            caps.eq(size - 12), lo.eq(caps - header[10:23]),
            overlap.eq((source < base + b.thread_words * 4) & (end > base)),
        ]
        protected_overlap = Const(0)
        for a, _ in b.checks:
            protected_overlap = protected_overlap | ((source <= a) & (end > a))
        stash = FaultStash(thread_base=base, thread_words=b.thread_words)
        m.submodules.stash = ResetInserter(~self.busy)(stash)
        m.d.comb += [
            stash.thread_gt.eq(self.thread[:32]), stash.namespace_gt.eq(self.namespace[:32]),
            stash.fault_code.eq(self.fault_code), stash.fault_address.eq(self.fault_address),
            stash.fault_instruction.eq(self.fault_instruction),
            stash.safe.eq(self.safe), stash.read_data.eq(self.read_data),
            stash.read_valid.eq(self.read_valid), stash.write_granted.eq(self.write_granted),
        ]

        def read(address):
            m.d.comb += [self.read_en.eq(1), self.address.eq(address)]

        def write(address, data):
            m.d.comb += [self.write_en.eq(1), self.address.eq(address),
                         self.write_data.eq(data)]

        def save_fail(code):
            m.d.sync += self.save_error.eq(code)
            m.next = "STATUS_WRITE"

        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [index.eq(0), row.eq(0), self.save_error.eq(0)]
                    m.next = "CHECK_SAFE"
            with m.State("CHECK_SAFE"):
                with m.If(~self.safe | ~self.owned | overlap | protected_overlap |
                          (source[:2] != 0) | (end > 65536) |
                          (self.thread[25:32] != 1)):
                    m.next = "CATASTROPHIC"
                with m.Else():
                    m.next = "BIND_READ"
            with m.State("BIND_READ"):
                read(checks_a[index])
                m.next = "BIND_CHECK"
            with m.State("BIND_CHECK"):
                with m.If(~self.read_valid | (self.read_data != checks_d[index])):
                    m.next = "CATASTROPHIC"
                with m.Elif(index == len(b.checks) - 1):
                    m.next = "STASH_START"
                with m.Else():
                    m.d.sync += index.eq(index + 1)
                    m.next = "BIND_READ"
            with m.State("STASH_START"):
                m.d.comb += stash.start.eq(1)
                m.next = "STASH"
            with m.State("STASH"):
                m.d.comb += [
                    self.address.eq(stash.address), self.write_data.eq(stash.write_data),
                    self.write_en.eq(stash.write_en), self.read_en.eq(stash.read_en),
                ]
                with m.If(stash.catastrophic):
                    m.next = "CATASTROPHIC"
                with m.Elif(stash.done):
                    m.next = "OUT_HEADER"
            with m.State("OUT_HEADER"):
                read(source)
                m.next = "OUT_HEADER_CHECK"
            with m.State("OUT_HEADER_CHECK"):
                with m.If(~self.read_valid):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Else():
                    m.d.sync += header.eq(self.read_data)
                    m.next = "OUT_GEOMETRY"
            with m.State("OUT_GEOMETRY"):
                with m.If((header[27:32] != 31) | (header[8:10] != 2) |
                          (header[:8] != 12) | (header[23:27] < THREAD_MIN_N_MINUS_6) |
                          (header[23:27] > THREAD_MAX_N_MINUS_6) | (header[10:23] == 0) |
                          (header[10:23] >= size - 30) | (limit != size - 1)):
                    save_fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "OUT_INDICATOR"
            with m.State("OUT_INDICATOR"):
                read(source + 68)
                m.next = "OUT_INDICATOR_CHECK"
            with m.State("OUT_INDICATOR_CHECK"):
                with m.If(~self.read_valid):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Else():
                    m.d.sync += indicator.eq(self.read_data)
                    m.next = "OUT_STACK"
            with m.State("OUT_STACK"):
                with m.If((indicator[13:28] != 0) | (indicator[:12] > caps - 1)):
                    save_fail(FaultType.STACK_CORRUPT)
                with m.Elif(indicator[:12] < lo + 2):
                    save_fail(FaultType.STACK_OVERFLOW)
                with m.Else():
                    m.next = "SAVE_CR"
            with m.State("SAVE_CR"):
                write(source + ((caps + row) << 2), self.crs[row])
                with m.If(~self.write_granted):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Elif(row == 11):
                    m.d.sync += row.eq(0)
                    m.next = "SAVE_EGT"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("SAVE_EGT"):
                write(source + ((indicator[:12] - 1) << 2),
                      (self.code_gt & 0x87ffffff) | 0x48000000)
                with m.If(~self.write_granted):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Else():
                    m.next = "SAVE_FRAME"
            with m.State("SAVE_FRAME"):
                write(source + (indicator[:12] << 2),
                      Cat(indicator[:13],
                          ((self.fault_address - self.code_base) >> 2)[:15], self.flags))
                with m.If(~self.write_granted):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Else():
                    m.next = "SAVE_INDICATOR"
            with m.State("SAVE_INDICATOR"):
                write(source + 68, Cat((indicator[:12] - 2)[:12], Const(1, 1),
                                       Const(0, 15), self.flags))
                with m.If(~self.write_granted):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Else():
                    m.next = "SAVE_DR"
            with m.State("SAVE_DR"):
                write(source + ((row + 1) << 2), self.drs[row])
                with m.If(~self.write_granted):
                    save_fail(FaultType.THREAD_CONTEXT)
                with m.Elif(row == 15):
                    m.next = "STATUS_WRITE"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("STATUS_WRITE"):
                write(base + 16, Mux(self.save_error == 0, 1, 2))
                with m.If(~self.write_granted):
                    m.next = "CATASTROPHIC"
                with m.Else():
                    m.next = "STATUS_READ"
            with m.State("STATUS_READ"):
                read(base + 16)
                m.next = "STATUS_CHECK"
            with m.State("STATUS_CHECK"):
                with m.If(~self.read_valid |
                          (self.read_data != Mux(self.save_error == 0, 1, 2))):
                    m.next = "CATASTROPHIC"
                with m.Else():
                    m.next = "ERROR_WRITE"
            with m.State("ERROR_WRITE"):
                write(base + 24, self.save_error)
                with m.If(~self.write_granted):
                    m.next = "CATASTROPHIC"
                with m.Else():
                    m.next = "ERROR_READ"
            with m.State("ERROR_READ"):
                read(base + 24)
                m.next = "ERROR_CHECK"
            with m.State("ERROR_CHECK"):
                with m.If(~self.read_valid | (self.read_data != self.save_error)):
                    m.next = "CATASTROPHIC"
                with m.Else():
                    m.next = "EVIDENCE"
            with m.State("EVIDENCE"):
                m.d.comb += self.evidence_ready.eq(1)
                with m.If(self.evidence_captured):
                    m.next = "CLEANUP"
            with m.State("CLEANUP"):
                m.d.comb += self.cleanup.eq(1)
                m.next = "ACTIVATE"
            with m.State("ACTIVATE"):
                m.d.comb += self.activate.eq(1)
                m.next = "ACTIVATING"
            with m.State("ACTIVATING"):
                with m.If(self.activation_fault):
                    m.next = "CATASTROPHIC"
                with m.Elif(self.activated):
                    m.next = "DONE"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
            with m.State("CATASTROPHIC"):
                m.d.comb += self.catastrophic.eq(1)
        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.release_source.eq(fsm.ongoing("CLEANUP") | fsm.ongoing("ACTIVATE") |
                                   fsm.ongoing("ACTIVATING") | fsm.ongoing("DONE")),
            self.freeze_source.eq(self.busy & ~self.release_source),
        ]
        # Loss of exclusive ownership never retries a partially written stash.
        # The final memory mux must suppress writes when safe is false.
        with m.If(~self.safe):
            m.d.comb += [self.write_en.eq(0), self.read_en.eq(0)]
        return m
