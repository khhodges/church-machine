from amaranth import *
from amaranth.lib.data import View

from .hw_types import SCHEDULER_IRQ_NS_SLOT, FaultType
from .layouts import CAP_REG_LAYOUT

# Method-table slot for the 'IRQ' entry inside the Scheduler abstraction.
# Index 5 matches the JS simulator definition in Task #1077.
SCHEDULER_IRQ_METHOD_IDX = 5


class ChurchIRQDispatch(Elaboratable):
    """Transparent IRQ dispatch to Scheduler.IRQ (NS slot 8, method 5).

    On start: reads NS[SCHEDULER_IRQ_NS_SLOT].word0_location (Scheduler lump
    base), reads the method-table entry at lump_base + method_idx * 4, writes
    DR0 = irq_reason and DR1 = irq_slot, then sets NIA to the handler entry.

    Three trigger conditions (Task #1523):
      IRQ_REASON_TIMER        — hardware timer alarm fired between instructions
      IRQ_REASON_LAZY_LOAD    — CALL pipeline detected cw=0 (CODE_NOT_RESIDENT)
      IRQ_REASON_LAZY_RESOLVE — NULL GT read from c-list slot

    Null-base guard:
      If FETCH_NS returns ns_base == 0 (Scheduler.IRQ not booted), the unit
      asserts null_base_fault for one cycle and returns to IDLE without touching
      NIA.  core.py maps this to FaultType.IRQ_NULL_BASE.

    One-deep pending register:
      If start arrives while the FSM is busy (not IDLE), the trigger is captured
      in pend_reason/pend_slot/pend_valid.  When the in-flight dispatch finishes
      and the FSM returns to IDLE, it immediately begins the pending dispatch
      without requiring an external re-pulse.  If a third trigger arrives before
      the pending one is consumed it overwrites the pending entry (last-wins).

    The unit contributes to any_unit_busy while active, preventing nested
    injection.  No stack frame is pushed; Scheduler.IRQ manages thread context
    via CHANGE (see Task #1077 transparent-suspension design).
    """

    def __init__(self):
        self.start      = Signal()
        self.irq_reason = Signal(2)
        self.irq_slot   = Signal(16)
        self.busy       = Signal()
        self.complete   = Signal()

        self.cr15_namespace = Signal(CAP_REG_LAYOUT)

        self.mem_rd_addr  = Signal(32)
        self.mem_rd_en    = Signal()
        self.mem_rd_data  = Signal(32)
        self.mem_rd_valid = Signal()

        # DR0 write (irq_reason) — one-cycle pulse in WRITE_DR0 state
        self.dr_wr_en   = Signal()
        self.dr_wr_addr = Signal(4)
        self.dr_wr_data = Signal(32)

        # DR1 write (irq_slot) — one-cycle pulse in WRITE_DR1 state
        self.dr1_wr_en   = Signal()
        self.dr1_wr_data = Signal(32)

        self.nia_set   = Signal()
        self.nia_value = Signal(32)

        # Fault output: asserted for one cycle when ns_base == 0 after FETCH_NS.
        # NIA is never updated when this fires — the caller must treat it as a
        # hard fault (FaultType.IRQ_NULL_BASE = 0x14).
        self.null_base_fault      = Signal()
        self.null_base_fault_type = Signal(5, init=int(FaultType.IRQ_NULL_BASE))

    def elaborate(self, platform):
        m = Module()

        reason_lat   = Signal(2)
        slot_lat     = Signal(16)
        ns_base      = Signal(32)
        method_entry = Signal(32)

        # One-deep pending-trigger register.
        pend_valid  = Signal()
        pend_reason = Signal(2)
        pend_slot   = Signal(16)

        cr15_view = View(CAP_REG_LAYOUT, self.cr15_namespace)

        # Byte address of NS[SCHEDULER_IRQ_NS_SLOT].word0_location.
        # Each NS entry occupies 16 bytes (stride = slot_id << 4).
        irq_ns_addr = Signal(32)
        m.d.comb += irq_ns_addr.eq(
            cr15_view.word1_location[:32] + (SCHEDULER_IRQ_NS_SLOT * 16)
        )

        m.d.comb += [
            self.dr_wr_addr.eq(0),              # DR0 carries irq_reason
            self.dr_wr_data.eq(reason_lat),
            self.dr1_wr_data.eq(slot_lat),
            self.nia_value.eq(ns_base + (method_entry << 2)),
        ]

        with m.FSM(name="irq_dispatch") as fsm:
            with m.State("IDLE"):
                with m.If(pend_valid):
                    # Replay the captured pending trigger immediately.
                    m.d.sync += [
                        reason_lat.eq(pend_reason),
                        slot_lat.eq(pend_slot),
                        pend_valid.eq(0),
                    ]
                    with m.If(self.start):
                        # A new trigger arrived in the same cycle — capture it as
                        # the replacement pending entry (overrides the .eq(0) above
                        # because later assignments win in Amaranth sync domain).
                        m.d.sync += [
                            pend_reason.eq(self.irq_reason),
                            pend_slot.eq(self.irq_slot),
                            pend_valid.eq(1),
                        ]
                    m.next = "FETCH_NS"
                with m.Elif(self.start):
                    m.d.sync += [
                        reason_lat.eq(self.irq_reason),
                        slot_lat.eq(self.irq_slot),
                    ]
                    m.next = "FETCH_NS"

            with m.State("FETCH_NS"):
                # Read NS[SCHEDULER_IRQ_NS_SLOT].word0_location = Scheduler lump base
                m.d.comb += [
                    self.mem_rd_addr.eq(irq_ns_addr),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += ns_base.eq(self.mem_rd_data)
                    with m.If(self.mem_rd_data == 0):
                        # NS slot 8 has not been populated — lump base is null.
                        # Abort: raise null_base_fault without touching NIA.
                        m.next = "NULL_BASE_FAULT"
                    with m.Else():
                        m.next = "FETCH_METHOD"

            with m.State("NULL_BASE_FAULT"):
                # One-cycle fault pulse.  NIA is never written.
                # core.py maps null_base_fault → FaultType.IRQ_NULL_BASE.
                m.next = "IDLE"

            with m.State("FETCH_METHOD"):
                # Read method-table entry: mem[ns_base + SCHEDULER_IRQ_METHOD_IDX * 4]
                # The word value is a lump-base-relative word offset; NIA = ns_base + entry*4.
                m.d.comb += [
                    self.mem_rd_addr.eq(ns_base + (SCHEDULER_IRQ_METHOD_IDX * 4)),
                    self.mem_rd_en.eq(1),
                ]
                with m.If(self.mem_rd_valid):
                    m.d.sync += method_entry.eq(self.mem_rd_data)
                    m.next = "WRITE_DR0"

            with m.State("WRITE_DR0"):
                # Pulse dr_wr_en to write DR0 = irq_reason
                m.d.comb += self.dr_wr_en.eq(1)
                m.next = "WRITE_DR1"

            with m.State("WRITE_DR1"):
                # Pulse dr1_wr_en to write DR1 = irq_slot
                m.d.comb += self.dr1_wr_en.eq(1)
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

        # Capture a trigger that arrives while the FSM is busy (non-IDLE).
        # Later m.d.sync assignments take priority over earlier ones in Amaranth,
        # so this overrides any same-cycle write from inside the FSM.
        # When multiple triggers arrive back-to-back, the last one wins (one-deep).
        with m.If(self.start & ~fsm.ongoing("IDLE")):
            m.d.sync += [
                pend_reason.eq(self.irq_reason),
                pend_slot.eq(self.irq_slot),
                pend_valid.eq(1),
            ]

        m.d.comb += [
            self.busy.eq(~fsm.ongoing("IDLE")),
            self.complete.eq(fsm.ongoing("COMPLETE")),
            self.nia_set.eq(fsm.ongoing("COMPLETE")),
            self.null_base_fault.eq(fsm.ongoing("NULL_BASE_FAULT")),
        ]

        return m
