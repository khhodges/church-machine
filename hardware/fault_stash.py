"""Direct Boot-home writer for the synchronous local-RAM fault-entry path.

This is a sequencer, not an event capture bank. The caller MUST hold the
issuer, CR12 and CR15 inputs from start through done/catastrophic, and own the
final memory port. This unit is not yet wired into ChurchCore.

Each write is offered for one edge. write_granted denotes actual final-port
selection at that edge; the following read request has a one-edge response.
No bus retry, timeout counter, address truncation or expected-data latch.
"""
from amaranth import Elaboratable, Module, Signal
from .thread_design import THREAD_SUPPORTED_BODY_WORDS


class FaultStash(Elaboratable):
    def __init__(self, *, thread_base, thread_words, handler_gt):
        if (thread_base < 0 or thread_base % 4 or
                thread_words not in THREAD_SUPPORTED_BODY_WORDS or
                thread_base + thread_words * 4 > 65536):
            raise ValueError("Boot.Thread must fit aligned local RAM without aliasing")
        if (not 0 <= handler_gt <= 0xffffffff or
                handler_gt & 0xfe000000 != 0x4a000000 or not handler_gt & 0xffff):
            raise ValueError("Expected E-only Inform handler GT")
        self.base, self.words, self.handler = thread_base, thread_words, handler_gt
        self.start = Signal()
        self.safe = Signal()  # exclusive ownership, validated binding and no overlap
        self.thread_gt = Signal(32)
        self.namespace_gt = Signal(32)
        self.fault_code = Signal(5)
        self.fault_address = Signal(32)
        self.fault_instruction = Signal(32)
        self.busy = Signal()
        self.done = Signal()
        self.catastrophic = Signal()
        self.write_en = Signal()
        self.write_granted = Signal()
        self.read_en = Signal()
        self.read_valid = Signal()
        self.address = Signal(32)
        self.write_data = Signal(32)
        self.read_data = Signal(32)

    def elaborate(self, platform):
        m = Module()
        index = Signal(range(31))
        offset = Signal(13)
        caps = self.words - 12
        # First stores are the original identities, then original fault facts.
        # Remaining homes and root frame are deterministic, not copied events.
        with m.Switch(index):
            with m.Case(0):
                m.d.comb += [offset.eq(caps + 1), self.write_data.eq(self.thread_gt)]
            with m.Case(1):
                m.d.comb += [offset.eq(caps + 2), self.write_data.eq(self.namespace_gt)]
            with m.Case(2):
                m.d.comb += [offset.eq(2), self.write_data.eq(self.fault_code)]
            with m.Case(3):
                m.d.comb += [offset.eq(3), self.write_data.eq(self.fault_address)]
            with m.Case(4):
                m.d.comb += [offset.eq(5), self.write_data.eq(self.fault_instruction)]
            with m.Case(5):
                m.d.comb += offset.eq(1)  # DR0
            with m.Case(6):
                m.d.comb += offset.eq(4)  # DR3, save not attempted
            with m.Case(7):
                m.d.comb += offset.eq(6)  # DR5
            with m.Case(*range(8, 18)):
                m.d.comb += offset.eq(index - 1)  # DR6..DR15
            with m.Case(18):
                m.d.comb += [offset.eq(caps), self.write_data.eq(self.handler)]
            with m.Case(*range(19, 28)):
                m.d.comb += offset.eq(caps + index - 16)  # CR3..CR11
            with m.Case(28):
                m.d.comb += [offset.eq(caps - 2), self.write_data.eq(self.handler)]
            with m.Case(29):
                m.d.comb += [offset.eq(caps - 1),
                             self.write_data.eq((caps - 1) | 0x1000 | (0x7fff << 13))]
            with m.Case(30):
                m.d.comb += [offset.eq(17), self.write_data.eq((caps - 3) | 0x1000)]
        m.d.comb += self.address.eq(self.base + (offset << 2))
        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += index.eq(0)
                    with m.If(self.safe):
                        m.next = "WRITE"
                    with m.Else():
                        m.next = "CATASTROPHIC"
            with m.State("WRITE"):
                m.d.comb += self.write_en.eq(self.safe)
                with m.If(self.safe & self.write_granted):
                    m.next = "READ"
                with m.Else():
                    m.next = "CATASTROPHIC"
            with m.State("READ"):
                m.d.comb += self.read_en.eq(self.safe)
                with m.If(self.safe):
                    m.next = "VERIFY"
                with m.Else():
                    m.next = "CATASTROPHIC"
            with m.State("VERIFY"):
                with m.If(~self.safe | ~self.read_valid |
                          (self.read_data != self.write_data)):
                    m.next = "CATASTROPHIC"
                with m.Elif(index == 30):
                    m.next = "DONE"
                with m.Else():
                    m.d.sync += index.eq(index + 1)
                    m.next = "WRITE"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                # The owning controller releases/reset this unit, not start.
            with m.State("CATASTROPHIC"):
                m.d.comb += self.catastrophic.eq(1)
        m.d.comb += self.busy.eq(~fsm.ongoing("IDLE") & ~fsm.ongoing("DONE"))
        return m
