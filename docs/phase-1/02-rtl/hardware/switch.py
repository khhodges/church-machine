"""Read-only SWITCH admission, followed by the shared checked Thread transition.

The Namespace candidate is never written here. ChurchChange saves the outgoing
Thread, publishes CR15 at the midpoint, and activates slot 2 while both units
keep the issuing instruction busy. Only the final completion consumes CR15.M.
"""
from amaranth import *
from amaranth.lib.data import View
from .hw_types import FaultType
from .layouts import CAP_REG_LAYOUT, WORD2_LAYOUT, COND_FLAGS_LAYOUT
from .mload import ChurchMLoad


class ChurchSwitch(Elaboratable):
    def __init__(self):
        self.switch_start = Signal()
        self.cr_src = Signal(4)
        self.target = Signal(4)  # required-zero encoding, NOT a CR selector
        self.index = Signal(32)
        self.target_m = Signal()  # CR15.M at acceptance
        self.switch_busy = Signal()
        self.switch_complete = Signal()
        self.switch_fault = Signal()
        self.fault_type = Signal(5)
        self.m_consume_en = Signal()
        self.m_consume_target = Signal(2)
        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)
        self.cr15_namespace = Signal(CAP_REG_LAYOUT)
        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()
        self.thread_wr_en = Signal()
        self.thread_wr_idx = Signal(4)
        self.thread_wr_data = Signal(32)
        self.mem_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()
        self.handoff_start = Signal()
        self.handoff_done = Signal()
        self.handoff_fault = Signal()
        self.handoff_fault_type = Signal(5)
        self.incoming_namespace = Signal(CAP_REG_LAYOUT)
        self.nia_current = Signal(32)
        self.flags_in = Signal(COND_FLAGS_LAYOUT)
        self.accepted_nia = Signal(32)
        self.accepted_flags = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()
        m.submodules.load = load = ChurchMLoad(enable_seal_check=True)
        src = Signal(CAP_REG_LAYOUT)
        namespace = Signal(CAP_REG_LAYOUT)
        row = Signal(32)
        code = Signal(5)
        armed = Signal()
        header = Signal(32)
        metadata_word = Signal(2)
        allocation_words = Signal(33)
        candidate = View(CAP_REG_LAYOUT, self.incoming_namespace)
        sw = View(WORD2_LAYOUT, View(CAP_REG_LAYOUT, src).word2_w2)
        cw = View(WORD2_LAYOUT, candidate.word2_w2)
        nw = View(WORD2_LAYOUT, View(CAP_REG_LAYOUT, namespace).word2_w2)
        # mLoad's historical interface expresses its NS bound in slots.
        # Adapt this internal input only; architectural CR15 stays word-based.
        lookup_namespace = Signal(CAP_REG_LAYOUT)
        lookup = View(CAP_REG_LAYOUT, lookup_namespace)
        lw = View(WORD2_LAYOUT, lookup.word2_w2)
        m.d.comb += [
            lookup_namespace.eq(namespace),
            lw.limit_offset.eq(nw.limit_offset >> 2),
            load.sub_index.eq(row), load.sub_validate_only.eq(1),
            load.cr_rd_data.eq(src), load.cr15_namespace.eq(lookup_namespace),
            load.mem_rd_data.eq(self.mem_rd_data),
            load.mem_rd_valid.eq(self.mem_rd_valid & load.sub_busy),
            self.mem_addr.eq(load.mem_addr), self.mem_rd_en.eq(load.mem_rd_en),
            self.m_consume_target.eq(3), self.fault_type.eq(code),
            allocation_words.eq(Const(1, 33) << (header[23:27] + 13)),
        ]

        def fail(kind):
            m.d.sync += code.eq(kind)
            m.next = "FAULT"

        with m.FSM() as fsm:
            with m.State("IDLE"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                with m.If(self.switch_start):
                    m.d.sync += [
                        src.eq(self.cr_rd_data), namespace.eq(self.cr15_namespace),
                        row.eq(self.index), armed.eq(0), code.eq(0),
                        self.accepted_nia.eq(self.nia_current),
                        self.accepted_flags.eq(self.flags_in),
                    ]
                    with m.If((self.target != 0) | (self.cr_src > 11)):
                        fail(FaultType.INVALID_OP)
                    with m.Elif(~self.target_m):
                        fail(FaultType.PERM_L)
                    with m.Else():
                        m.next = "SOURCE"
            with m.State("SOURCE"):
                # Reject before mLoad narrows the physical address.
                with m.If((row > sw.limit_offset) |
                          ((View(CAP_REG_LAYOUT, src).word1_location +
                            (row << 2) + 3) > 0xFFFFFFFF)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "LOAD"
            with m.State("LOAD"):
                m.d.comb += load.sub_start.eq(1)
                m.next = "WAIT"
            with m.State("WAIT"):
                with m.If(load.sub_fault):
                    fail(load.sub_fault_type)
                with m.Elif(load.sub_done):
                    m.d.sync += self.incoming_namespace.eq(load.resolved_cap)
                    m.next = "CANDIDATE"
            with m.State("CANDIDATE"):
                with m.If((candidate.word0_gt.gt_type != 1) |
                          (candidate.word0_gt.slot_id == 0) |
                          cw.f_flag | (candidate.word1_location[:2] != 0) |
                          (cw.limit_offset < 11) | (cw.limit_offset[:2] != 3) |
                          ((candidate.word1_location + (cw.limit_offset << 2) + 3) >
                           0xFFFFFFFF)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "HEADER"
            with m.State("HEADER"):
                m.d.comb += [self.mem_rd_en.eq(1),
                             self.mem_addr.eq(candidate.word1_location)]
                m.d.sync += armed.eq(1)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [armed.eq(0), header.eq(self.mem_rd_data)]
                    # Ascending slot-0 metadata: magic, Namespace type,
                    # table count N, zero cc, supported allocation exponent.
                    with m.If((self.mem_rd_data[27:32] != 31) |
                              (self.mem_rd_data[8:10] != 1) |
                              (self.mem_rd_data[:8] != 0) |
                              (self.mem_rd_data[23:27] > 9) |
                              ((self.mem_rd_data[10:23] << 2) != cw.limit_offset + 1)):
                        fail(FaultType.BOUNDS)
                    with m.Else():
                        m.next = "GEOMETRY"
            with m.State("GEOMETRY"):
                with m.If((cw.limit_offset >= allocation_words) |
                          ((candidate.word1_location + (allocation_words << 2)) >
                           0x100000000)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += metadata_word.eq(1)
                    m.next = "METADATA"
            with m.State("METADATA"):
                m.d.comb += [
                    self.mem_rd_en.eq(1),
                    self.mem_addr.eq(candidate.word1_location + (metadata_word << 2)),
                ]
                m.d.sync += armed.eq(1)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += armed.eq(0)
                    with m.If(((metadata_word == 1) &
                               (self.mem_rd_data != candidate.word1_location)) |
                              ((metadata_word == 2) &
                               (self.mem_rd_data >= header[10:23])) |
                              ((metadata_word == 3) & (self.mem_rd_data != 0))):
                        fail(FaultType.BOUNDS)
                    with m.Elif(metadata_word == 3):
                        m.next = "HANDOFF"
                    with m.Else():
                        m.d.sync += metadata_word.eq(metadata_word + 1)
            with m.State("HANDOFF"):
                m.d.comb += self.handoff_start.eq(1)
                m.next = "TRANSITION"
            with m.State("TRANSITION"):
                with m.If(self.handoff_fault):
                    # Shared CHANGE already reports the hard fault to core;
                    # do not manufacture a second retirement one cycle later.
                    m.next = "IDLE"
                with m.Elif(self.handoff_done):
                    m.d.comb += [self.switch_complete.eq(1), self.m_consume_en.eq(1)]
                    m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.switch_fault.eq(1)
                m.next = "IDLE"
        m.d.comb += self.switch_busy.eq(~fsm.ongoing("IDLE"))
        return m
