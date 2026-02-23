from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import NS_ENTRY_LAYOUT, NS_LIMIT_LAYOUT, SEALS_LAYOUT


# PP250 Design: Mark-Scan-Sweep with G-bit polarity.
#   Mark:  Sets G=1 on word1 (limit field) of all namespace entries.
#   Scan:  Implicit — mLoad resets G=0 on every valid access during
#          normal execution between Mark and Sweep.
#   Sweep: Entries still with G=1 are garbage — bump version in seals,
#          zero the entry, clear G.
#
# Uses the core's 96-bit namespace port (3 × 32-bit words per entry):
#   word0: location (32 bits)
#   word1: limit[16:0] | reserved[28:17] | G[29] | F[30] | B[31]
#   word2: seal[24:0] | version[31:25]
class RV32CapGCUnit(Elaboratable):
    def __init__(self):
        self.gc_start = Signal()
        self.gc_mark_en = Signal()
        self.gc_sweep_en = Signal()
        self.gc_busy = Signal()
        self.gc_done = Signal()

        self.ns_addr = Signal(32)
        self.ns_rd_en = Signal()
        self.ns_rd_data = Signal(32 * 3)
        self.ns_wr_data = Signal(32 * 3)
        self.ns_wr_en = Signal()

        self.ns_start_index = Signal(17)
        self.ns_end_index = Signal(17)

        self.marked_count = Signal(32)
        self.garbage_count = Signal(32)

        self.valid_key_access = Signal()
        self.access_index = Signal(17)
        self.g_bit_reset = Signal()

    def elaborate(self, platform):
        m = Module()

        current_index = Signal(17)
        mark_counter = Signal(32)
        garbage_counter = Signal(32)

        latched_entry = Signal(32 * 3)
        latched_w0 = latched_entry.word_select(0, 32)
        latched_w1 = latched_entry.word_select(1, 32)
        latched_w2 = latched_entry.word_select(2, 32)

        w1_view = View(NS_LIMIT_LAYOUT, latched_w1)
        w2_view = View(SEALS_LAYOUT, latched_w2)

        next_version = Signal(7)
        m.d.comb += next_version.eq(w2_view.version + 1)

        with m.FSM(name="gc") as fsm:
            with m.State("IDLE"):
                with m.If(self.gc_start & self.gc_mark_en):
                    m.d.sync += [
                        current_index.eq(self.ns_start_index),
                        mark_counter.eq(0),
                        garbage_counter.eq(0),
                    ]
                    m.next = "MARK_READ"
                with m.Elif(self.gc_start & self.gc_sweep_en):
                    m.d.sync += [
                        current_index.eq(self.ns_start_index),
                        mark_counter.eq(0),
                        garbage_counter.eq(0),
                    ]
                    m.next = "SWEEP_READ"

            with m.State("MARK_READ"):
                m.d.comb += [
                    self.ns_addr.eq(current_index),
                    self.ns_rd_en.eq(1),
                ]
                m.d.sync += latched_entry.eq(self.ns_rd_data)
                m.next = "MARK_WRITE"

            with m.State("MARK_WRITE"):
                wr_entry = Signal(32 * 3)
                wr_w1 = wr_entry.word_select(1, 32)
                wr_w1_view = View(NS_LIMIT_LAYOUT, wr_w1)
                m.d.comb += wr_entry.eq(latched_entry)
                m.d.comb += wr_w1_view.g_bit.eq(1)

                m.d.comb += [
                    self.ns_addr.eq(current_index),
                    self.ns_wr_data.eq(wr_entry),
                    self.ns_wr_en.eq(1),
                ]

                with m.If(~w1_view.g_bit):
                    m.d.sync += mark_counter.eq(mark_counter + 1)

                m.d.sync += current_index.eq(current_index + 1)

                with m.If(current_index >= self.ns_end_index):
                    with m.If(self.gc_sweep_en):
                        m.d.sync += current_index.eq(self.ns_start_index)
                        m.next = "SWEEP_READ"
                    with m.Else():
                        m.next = "COMPLETE"
                with m.Else():
                    m.next = "MARK_READ"

            with m.State("SWEEP_READ"):
                m.d.comb += [
                    self.ns_addr.eq(current_index),
                    self.ns_rd_en.eq(1),
                ]
                m.d.sync += latched_entry.eq(self.ns_rd_data)
                m.next = "SWEEP_CHECK"

            with m.State("SWEEP_CHECK"):
                with m.If(w1_view.g_bit):
                    m.d.sync += garbage_counter.eq(garbage_counter + 1)
                    m.next = "SWEEP_WRITE"
                with m.Else():
                    m.d.sync += current_index.eq(current_index + 1)
                    with m.If(current_index >= self.ns_end_index):
                        m.next = "COMPLETE"
                    with m.Else():
                        m.next = "SWEEP_READ"

            with m.State("SWEEP_WRITE"):
                swept_entry = Signal(32 * 3)
                swept_w2 = swept_entry.word_select(2, 32)
                swept_w2_view = View(SEALS_LAYOUT, swept_w2)
                m.d.comb += [
                    swept_entry.eq(0),
                    swept_w2_view.version.eq(next_version),
                    swept_w2_view.seal.eq(0),
                ]
                m.d.comb += [
                    self.ns_addr.eq(current_index),
                    self.ns_wr_data.eq(swept_entry),
                    self.ns_wr_en.eq(1),
                ]

                m.d.sync += current_index.eq(current_index + 1)
                with m.If(current_index >= self.ns_end_index):
                    m.next = "COMPLETE"
                with m.Else():
                    m.next = "SWEEP_READ"

            with m.State("COMPLETE"):
                m.next = "IDLE"

        m.d.comb += [
            self.gc_busy.eq(~fsm.ongoing("IDLE") & ~fsm.ongoing("COMPLETE")),
            self.gc_done.eq(fsm.ongoing("COMPLETE")),
            self.marked_count.eq(mark_counter),
            self.garbage_count.eq(garbage_counter),
        ]

        m.d.comb += self.g_bit_reset.eq(self.valid_key_access)

        return m
