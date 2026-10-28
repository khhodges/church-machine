"""Boot metadata reader for the ascending Namespace contract.

Consumes the original twelve words at address zero: metadata, self, Thread.
Namespace-only admission consumes just the first eight, deferring Thread checks.
Memory bus addresses are bytes; stored resident locations remain word addresses.
This validates metadata geometry and seals, not version-pair admission,
Thread type/frame validity, whole-image validity, or upload authorization.
"""
from amaranth import *
from .integrity32 import integrity32_amaranth


class AscendingNamespaceBootstrap(Elaboratable):
    def __init__(self, capacity_words=16384, *, namespace_only=False):
        if (capacity_words < 8192 or capacity_words > 4194304
                or capacity_words & (capacity_words - 1)):
            raise ValueError("Namespace capacity must be a power of two, 8K–4M words")
        self.capacity_words = capacity_words
        # Core admission reads only metadata + self, so a bad Thread cannot
        # replace a Namespace-stage failure. Full inspection remains useful
        # for offline geometry tests; it is not Thread admission.
        self.namespace_only = namespace_only
        self.start = Signal()
        self.busy = Signal()
        self.done = Signal()
        self.fault = Signal()
        # Errors: 1 metadata; 2 self identity; 3 self seal; 4 Thread geometry;
        # 5 Thread seal. Latched until the next explicit start.
        self.error = Signal(3)
        self.mem_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_data = Signal(32)
        self.mem_valid = Signal()
        self.slots = Signal(13)
        self.thread_base_byte = Signal(32)
        self.thread_limit = Signal(21)
        self.namespace_version = Signal(9)
        self.namespace_authority = Signal(32)
        self.thread_version = Signal(9)

    def elaborate(self, platform):
        m = Module()
        words = Array(Signal(32, name=f"metadata_word_{i}") for i in range(12))
        index = Signal(range(12))
        armed = Signal()
        self_seal = Signal(32)
        thread_seal = Signal(32)
        integrity32_amaranth(m, words[4], words[5], self_seal)
        integrity32_amaranth(m, words[8], words[9], thread_seal)
        slots = words[0][10:23]
        table_words = Signal(15)
        m.d.comb += table_words.eq(slots << 2)
        expected_n = self.capacity_words.bit_length() - 1 - 13

        def fail(code):
            m.d.sync += self.error.eq(code)
            m.next = "FAULT"

        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        index.eq(0), armed.eq(0), self.error.eq(0),
                        self.slots.eq(0), self.thread_base_byte.eq(0),
                        self.thread_limit.eq(0),
                        self.namespace_version.eq(0), self.thread_version.eq(0),
                        self.namespace_authority.eq(0),
                    ]
                    m.next = "READ"
            with m.State("READ"):
                m.d.comb += [self.mem_rd_en.eq(1), self.mem_addr.eq(index << 2)]
                m.d.sync += armed.eq(1)
                # Ignore a stale shared-bus response on the first request cycle.
                with m.If(armed & self.mem_valid):
                    m.d.sync += [words[index].eq(self.mem_data), armed.eq(0)]
                    with m.If(index == (7 if self.namespace_only else 11)):
                        m.next = "CHECK"
                    with m.Else():
                        m.d.sync += index.eq(index + 1)
            with m.State("CHECK"):
                with m.If(
                    (words[0][27:32] != 31) |
                    (words[0][23:27] != expected_n) |
                    (words[0][8:10] != 1) | (words[0][:8] != 0) |
                    (slots < 3) | (table_words > self.capacity_words) |
                    (words[1] != 0) | (words[3] != 0) |
                    (words[2] > slots - 2)
                ):
                    fail(1)
                # Geometry is independent of the approved boot-pair versions.
                # Admission compares those versions against retained constants
                # separately; never infer expected versions from live memory.
                with m.Elif((words[4] != 0) |
                            ((words[5] & 0x801fffff) != table_words - 1) |
                            (words[7] != 0)):
                    fail(2)
                with m.Elif(words[6] != self_seal):
                    fail(3)
                # The entry Thread starts at slot 2, never a legacy alias.
                # Validate the complete declared allocation before converting
                # the original word location into an internal bus byte address.
                with m.Elif(Const(not self.namespace_only) & (
                    (words[8] < table_words) |
                    (words[8] >= self.capacity_words) |
                    words[9][31] |
                    (words[9][:21] >= self.capacity_words) |
                    (words[8] + words[9][:21] >= self.capacity_words)
                )):
                    fail(4)
                with m.Elif(Const(not self.namespace_only) & (words[10] != thread_seal)):
                    fail(5)
                with m.Else():
                    m.d.sync += [
                        self.slots.eq(slots),
                        self.thread_base_byte.eq(words[8] << 2),
                        self.thread_limit.eq(words[9][:21]),
                        self.namespace_version.eq(words[5][21:30]),
                        self.namespace_authority.eq(words[5]),
                        self.thread_version.eq(words[9][21:30]),
                    ]
                    m.next = "DONE"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.fault.eq(1)
                m.next = "IDLE"
            m.d.comb += self.busy.eq(~fsm.ongoing("IDLE"))
        return m
