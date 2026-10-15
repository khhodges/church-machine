"""Boot-only back half of CHANGE; no outgoing save or architectural scratch.

The existing ROM encoding selects this internal operation. This is not an
implementation/approval of a new programmatic CHANGE instruction encoding.
"""
from amaranth import *
from amaranth.lib.data import View

from .hw_types import FaultType, GT_TYPE_INFORM, GT_TYPE_ABSTRACT
from .layouts import CAP_REG_LAYOUT, GT_LAYOUT, WORD2_LAYOUT
from .ns_gate import ChurchNSGate
from .thread_design import THREAD_MIN_N_MINUS_6, THREAD_MAX_N_MINUS_6


class BootChange(Elaboratable):
    def __init__(self):
        self.start = Signal()
        self.done = Signal()
        self.fault = Signal()
        self.fault_type = Signal(5)
        self.thread = Signal(CAP_REG_LAYOUT)
        self.namespace = Signal(CAP_REG_LAYOUT)
        self.mem_addr = Signal(32)
        self.mem_en = Signal()
        self.mem_data = Signal(32)
        self.mem_valid = Signal()
        self.cr_en = Signal()
        self.cr_addr = Signal(4)
        self.cr_data = Signal(CAP_REG_LAYOUT)
        self.header = Signal(32)
        self.thread_base = Signal(32)

    def elaborate(self, platform):
        m = Module()
        # Microcode access is not permission to bypass integrity/revocation.
        m.submodules.gate = gate = ChurchNSGate(enable_seal_check=True)
        namespace = Signal(CAP_REG_LAYOUT)
        thread = Signal(CAP_REG_LAYOUT)
        entry = Signal(CAP_REG_LAYOUT)
        gt = Signal(32)
        target = View(GT_LAYOUT, gt)
        tv = View(CAP_REG_LAYOUT, thread)
        ev = View(CAP_REG_LAYOUT, entry)
        nv = View(CAP_REG_LAYOUT, namespace)
        nw = View(WORD2_LAYOUT, nv.word2_w2)
        tw = View(WORD2_LAYOUT, tv.word2_w2)
        ew = View(WORD2_LAYOUT, ev.word2_w2)
        raw_w2 = View(WORD2_LAYOUT, gate.raw_w2)
        header = Signal(32)
        size = Signal(15)
        caps = Signal(15)
        stack_start = Signal(15)
        indicator = Signal(32)
        root_gt = Signal(32)
        row = Signal(8)
        entry_header = Signal(32)
        entry_size = Signal(15)
        entry_caps = Signal(15)
        phase = Signal(2)  # descriptor, Thread homes, executable C-list
        armed = Signal()
        rd = Signal()
        addr = Signal(32)
        code = Signal(5)
        m.d.comb += [
            gate.gt_word0.eq(gt), gate.cr15_namespace.eq(namespace),
            gate.m_elevated.eq(0),
            gate.mem_rd_data.eq(self.mem_data),
            gate.mem_rd_valid.eq(self.mem_valid & gate.ns_gate_busy),
            self.mem_en.eq(Mux(gate.ns_gate_busy, gate.mem_rd_en, rd)),
            self.mem_addr.eq(Mux(gate.ns_gate_busy, gate.mem_addr, addr)),
            size.eq(Const(1, 15) << (header[23:27] + 6)),
            caps.eq(size - 12), stack_start.eq(caps - header[10:23]),
            entry_size.eq(Const(1, 15) << (entry_header[23:27] + 6)),
            entry_caps.eq(entry_size - entry_header[:8]),
            self.header.eq(header), self.thread_base.eq(tv.word1_location),
            self.fault_type.eq(code),
        ]

        def fail(kind):
            m.d.sync += code.eq(kind)
            m.next = "FAULT"

        def read(address):
            m.d.comb += [rd.eq(1), addr.eq(address)]
            m.d.sync += armed.eq(1)

        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.start):
                    m.d.sync += [
                        namespace.eq(self.namespace),
                        gt.eq(View(CAP_REG_LAYOUT, self.thread).word0_gt),
                        phase.eq(0), row.eq(0), code.eq(0), armed.eq(0),
                    ]
                    m.next = "CHECK"
            with m.State("CHECK"):
                with m.If(target.gt_type != GT_TYPE_INFORM):
                    fail(FaultType.NULL_CAP)
                with m.Elif((phase == 0) & (target.perm != 0)):
                    fail(FaultType.PERM_S)
                with m.Elif(target.slot_id > nw.limit_offset):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "GATE"
            with m.State("GATE"):
                m.d.comb += gate.ns_gate_start.eq(1)
                m.next = "WAIT"
            with m.State("WAIT"):
                with m.If(gate.ns_gate_fault):
                    fail(gate.ns_gate_fault_type)
                with m.Elif(gate.ns_gate_done):
                    with m.If(raw_w2.f_flag | (gate.raw_base[:2] != 0)):
                        fail(FaultType.BOUNDS)
                    with m.Elif(phase == 0):
                        m.d.sync += [
                            tv.word0_gt.eq(gt), tv.word1_location.eq(gate.raw_base),
                            tv.word2_w2.eq(gate.raw_w2), armed.eq(0),
                        ]
                        m.next = "HEADER"
                    with m.Elif(phase == 1):
                        with m.If(row == 0):
                            with m.If(~target.dom | (target.perm != 4)):
                                fail(FaultType.PERM_E)
                            with m.Else():
                                m.d.sync += [
                                    ev.word0_gt.eq(gt),
                                    ev.word1_location.eq(gate.raw_base),
                                    ev.word2_w2.eq(gate.raw_w2),
                                ]
                                m.next = "HOME_NEXT"
                        with m.Else():
                            m.next = "HOME_NEXT"
                    with m.Else():
                        m.next = "CLIST_NEXT"
            with m.State("HEADER"):
                read(tv.word1_location)
                with m.If(armed & self.mem_valid):
                    m.d.sync += [header.eq(self.mem_data), armed.eq(0)]
                    m.next = "HEADER_CHECK"
            with m.State("HEADER_CHECK"):
                with m.If(
                    (header[27:32] != 31) | (header[8:10] != 2) |
                    (header[23:27] < THREAD_MIN_N_MINUS_6) |
                    (header[23:27] > THREAD_MAX_N_MINUS_6) |
                    (header[:8] != 12) | (header[10:23] == 0) |
                    (header[10:23] >= size - 30) |
                    (tw.limit_offset != size - 1) |
                    ((tv.word1_location + ((size - 1) << 2)) > 0xFFFFFFFF)
                ):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "INDICATOR"
            with m.State("INDICATOR"):
                read(tv.word1_location + 17 * 4)
                with m.If(armed & self.mem_valid):
                    m.d.sync += [indicator.eq(self.mem_data), armed.eq(0)]
                    m.next = "INDICATOR_CHECK"
            with m.State("INDICATOR_CHECK"):
                # Boot retains the poison root for the following explicit CALL.
                # It does not resume a programmatic continuation or invent one.
                with m.If(
                    (indicator != ((caps - 3) | 0x1000)) |
                    (caps - 3 < stack_start) | (caps - 1 > 0xFFF)
                ):
                    fail(FaultType.STACK_CORRUPT)
                with m.Else():
                    m.next = "ROOT_GT"
            with m.State("ROOT_GT"):
                read(tv.word1_location + ((caps - 2) << 2))
                with m.If(armed & self.mem_valid):
                    m.d.sync += [armed.eq(0), root_gt.eq(self.mem_data)]
                    with m.If((self.mem_data[25:27] != GT_TYPE_INFORM) |
                              ~self.mem_data[27] | (self.mem_data[28:31] != 4)):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Else():
                        m.next = "ROOT_FRAME"
            with m.State("ROOT_FRAME"):
                read(tv.word1_location + ((caps - 1) << 2))
                with m.If(armed & self.mem_valid):
                    m.d.sync += armed.eq(0)
                    with m.If(self.mem_data != ((caps - 1) | (0x7FFF << 13) | 0x1000)):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Else():
                        m.d.sync += [row.eq(0), phase.eq(1)]
                        m.next = "HOME"
            with m.State("HOME"):
                read(tv.word1_location + ((caps + row) << 2))
                with m.If(armed & self.mem_valid):
                    m.d.sync += [armed.eq(0), gt.eq(self.mem_data)]
                    with m.If((row == 0) & (self.mem_data != root_gt)):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Elif((row != 0) & ((self.mem_data == 0) |
                                (self.mem_data[25:27] == GT_TYPE_ABSTRACT))):
                        m.next = "HOME_NEXT"
                    with m.Else():
                        m.next = "CHECK"
            with m.State("HOME_NEXT"):
                m.d.sync += row.eq(row + 1)
                with m.If(row == 11):
                    m.next = "ENTRY_HEADER"
                with m.Else():
                    m.next = "HOME"
            with m.State("ENTRY_HEADER"):
                read(ev.word1_location)
                with m.If(armed & self.mem_valid):
                    m.d.sync += [entry_header.eq(self.mem_data), armed.eq(0)]
                    m.next = "ENTRY_CHECK"
            with m.State("ENTRY_CHECK"):
                with m.If(
                    (entry_header[27:32] != 31) | (entry_header[8:10] != 0) |
                    (entry_header[23:27] > 7) | (entry_header[:8] == 0) |
                    (entry_header[10:23] == 0) |
                    (entry_header[10:23] >= entry_caps) |
                    # Namespace executables may bound the public body before
                    # the protected C-List. CALL derives that private region
                    # from the authenticated header, not the public limit.
                    # Factory descriptors also use the full allocation.
                    # Accept only these two exact layouts, never arbitrary
                    # truncation, and preserve the supplied authority.
                    ((ew.limit_offset != entry_size - 1) &
                     (ew.limit_offset != entry_caps - 1)) |
                    ((ev.word1_location + ((entry_size - 1) << 2)) > 0xFFFFFFFF)
                ):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += [row.eq(0), phase.eq(2)]
                    m.next = "CLIST"
            with m.State("CLIST"):
                read(ev.word1_location + ((entry_caps + row) << 2))
                with m.If(armed & self.mem_valid):
                    m.d.sync += [armed.eq(0), gt.eq(self.mem_data)]
                    with m.If((row == 0) & (self.mem_data != ev.word0_gt.as_value())):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Elif((row != 0) &
                                ((self.mem_data == 0) |
                                 (self.mem_data[25:27] == GT_TYPE_ABSTRACT))):
                        m.next = "CLIST_NEXT"
                    with m.Else():
                        m.next = "CHECK"
            with m.State("CLIST_NEXT"):
                with m.If(row + 1 >= entry_header[:8]):
                    m.next = "COMMIT_THREAD"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
                    m.next = "CLIST"
            # All possible faults precede publication. Boot's CR0-only restore
            # policy is retained; no CR8 write, including transient writes.
            with m.State("COMMIT_THREAD"):
                m.d.comb += [self.cr_en.eq(1), self.cr_addr.eq(12), self.cr_data.eq(thread)]
                m.next = "COMMIT_ENTRY"
            with m.State("COMMIT_ENTRY"):
                m.d.comb += [self.cr_en.eq(1), self.cr_addr.eq(0), self.cr_data.eq(entry)]
                m.next = "COMMIT_HEAP"
            with m.State("COMMIT_HEAP"):
                heap = View(CAP_REG_LAYOUT, self.cr_data)
                m.d.comb += [
                    self.cr_en.eq(1), self.cr_addr.eq(5),
                    heap.word0_gt.eq(
                        (tv.word0_gt.as_value() & 0x87FFFFFF) | 0x30000000),
                    heap.word1_location.eq(tv.word1_location + 72),
                    heap.word2_w2.eq(size - header[10:23] - 31),
                ]
                m.next = "DONE"
            with m.State("DONE"):
                m.d.comb += self.done.eq(1)
                m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.fault.eq(1)
                m.next = "IDLE"
        return m
