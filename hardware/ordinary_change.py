"""One-GT programmatic Thread activation, independent of boot and scheduler.

All admission reads finish before the first context write. The namespace gate
never receives elevated authority; private Thread access is internal microcode,
not an L/S capability temporarily installed in an architectural register.
"""
from amaranth import *
from amaranth.lib.data import View

from .layouts import CAP_REG_LAYOUT, GT_LAYOUT, WORD2_LAYOUT
from .hw_types import FaultType, GT_TYPE_INFORM, GT_TYPE_ABSTRACT
from .ns_gate import ChurchNSGate
from .thread_design import THREAD_MIN_N_MINUS_6, THREAD_MAX_N_MINUS_6


class OrdinaryChange(Elaboratable):
    INPUTS = (
        "cr_src", "cr_dst", "index", "cr_rd_data", "cr12_thread",
        "cr15_namespace", "active_thread_base", "active_thread_owned",
        "mem_rd_data", "mem_rd_valid", "mem_wr_done", "dr_rd_data",
        "flags_in", "nia_current",
    )
    OUTPUTS = (
        "change_busy", "change_complete", "change_fault", "fault_type",
        "cr_rd_addr", "cr_wr_en", "cr_wr_addr", "cr_wr_data",
        "mem_rd_addr", "mem_rd_en", "mem_wr_addr", "mem_wr_data", "mem_wr_en",
        "thread_wr_en", "thread_wr_idx", "thread_wr_data", "thread_hdr_out",
        "thread_base_restore_en", "thread_base_restore_val",
        "dr_rd_addr", "dr_wr_en", "dr_wr_addr", "dr_wr_data",
        "nia_restore_en", "nia_restore_val", "flags_restore_en", "flags_restore_data",
    )

    def __init__(self, ports):
        self.change_start = Signal()
        for name in self.INPUTS + self.OUTPUTS:
            setattr(self, name, Signal.like(getattr(ports, name), name="ordinary_" + name))

    def elaborate(self, platform):
        m = Module()
        m.submodules.gate = gate = ChurchNSGate(enable_seal_check=True)
        namespace = Signal(96)
        thread = Signal(96)
        entry = Signal(96)
        homes = Array(Signal(96, name=f"incoming_cr{i}") for i in range(12))
        saved = Array(Signal(96, name=f"outgoing_cr{i}") for i in range(12))
        drs = Array(Signal(32, name=f"incoming_dr{i}") for i in range(16))
        saved_drs = Array(Signal(32, name=f"outgoing_dr{i}") for i in range(16))
        operand = Signal(4)
        gt = Signal(32)
        gv = View(GT_LAYOUT, gt)
        tv, ev = View(CAP_REG_LAYOUT, thread), View(CAP_REG_LAYOUT, entry)
        nw = View(WORD2_LAYOUT, View(CAP_REG_LAYOUT, namespace).word2_w2)
        tw, ew = View(WORD2_LAYOUT, tv.word2_w2), View(WORD2_LAYOUT, ev.word2_w2)
        rw = View(WORD2_LAYOUT, gate.raw_w2)
        header, out_header, entry_header = Signal(32), Signal(32), Signal(32)
        size, out_size, entry_size = Signal(16), Signal(16), Signal(16)
        caps, out_caps, stack_lo, out_lo = (Signal(16) for _ in range(4))
        indicator, frame, out_indicator = Signal(32), Signal(32), Signal(32)
        out_base, out_egt = Signal(32), Signal(32)
        owned, self_target = Signal(), Signal()
        flags, nia = Signal(4), Signal(15)
        row = Signal(8)
        phase = Signal(2)  # target Thread, incoming homes, frame E-GT, C-List
        code = Signal(5)
        armed, rd = Signal(), Signal()
        addr = Signal(32)
        heap_w2, code_w2, clist_w2 = (Signal(WORD2_LAYOUT) for _ in range(3))
        resolved = Cat(gt, gate.raw_base, gate.raw_w2)
        m.d.comb += [
            gate.gt_word0.eq(gt), gate.cr15_namespace.eq(namespace),
            gate.m_elevated.eq(0), gate.mem_rd_data.eq(self.mem_rd_data),
            gate.mem_rd_valid.eq(self.mem_rd_valid & gate.ns_gate_busy),
            self.mem_rd_en.eq(Mux(gate.ns_gate_busy, gate.mem_rd_en, rd)),
            self.mem_rd_addr.eq(Mux(gate.ns_gate_busy, gate.mem_addr, addr)),
            size.eq(Const(1, 16) << (header[23:27] + 6)),
            out_size.eq(Const(1, 16) << (out_header[23:27] + 6)),
            entry_size.eq(Const(1, 16) << (entry_header[23:27] + 6)),
            caps.eq(size - 12), out_caps.eq(out_size - 12),
            stack_lo.eq(caps - header[10:23]),
            out_lo.eq(out_caps - out_header[10:23]),
            self.thread_hdr_out.eq(header),
            self.thread_base_restore_val.eq(tv.word1_location),
            self.fault_type.eq(code),
            heap_w2.limit_offset.eq(size - header[10:23] - 31),
            heap_w2.gt_seq.eq(tw.gt_seq),
            code_w2.limit_offset.eq(entry_header[10:23] - 1),
            code_w2.gt_seq.eq(ew.gt_seq),
            clist_w2.limit_offset.eq(entry_header[:8] - 1),
            clist_w2.gt_seq.eq(ew.gt_seq),
        ]

        def fail(kind):
            m.d.sync += code.eq(kind)
            m.next = "FAULT"

        def read(address):
            m.d.comb += [rd.eq(1), addr.eq(address)]
            m.d.sync += armed.eq(1)

        def write(address, data):
            m.d.comb += [
                self.mem_wr_en.eq(1), self.mem_wr_addr.eq(address),
                self.mem_wr_data.eq(data),
            ]

        def valid_header(h, allocation):
            return ((h[27:32] == 31) & (h[8:10] == 2) &
                    (h[23:27] >= THREAD_MIN_N_MINUS_6) &
                    (h[23:27] <= THREAD_MAX_N_MINUS_6) &
                    (h[:8] == 12) & (h[10:23] > 0) &
                    (h[10:23] < allocation - 30))

        with m.FSM() as fsm:
            with m.State("IDLE"):
                with m.If(self.change_start):
                    m.d.sync += [
                        operand.eq(self.cr_src), namespace.eq(self.cr15_namespace),
                        owned.eq(self.active_thread_owned),
                        out_base.eq(self.active_thread_base),
                        flags.eq(self.flags_in), nia.eq(self.nia_current[2:17] + 1),
                        phase.eq(0), row.eq(0), armed.eq(0), code.eq(0),
                    ]
                    # Existing one-operand assembler word repeats CRn; indexed
                    # legacy words must not silently acquire new semantics.
                    with m.If((self.cr_src != self.cr_dst) | (self.index != 0)):
                        fail(FaultType.INVALID_OP)
                    with m.Else():
                        m.next = "OPERAND"
            with m.State("OPERAND"):
                m.d.comb += self.cr_rd_addr.eq(operand)
                m.d.sync += gt.eq(self.cr_rd_data.as_value()[:32])
                m.next = "CHECK"
            with m.State("CHECK"):
                with m.If(gv.gt_type != GT_TYPE_INFORM):
                    fail(FaultType.NULL_CAP)
                with m.Elif((phase == 0) & (gv.perm != 0)):
                    fail(FaultType.PERM_S)
                with m.Elif((phase == 2) & (~gv.dom | (gv.perm != 4))):
                    fail(FaultType.PERM_E)
                with m.Elif(gv.slot_id > nw.limit_offset):
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
                    with m.If(rw.f_flag | (gate.raw_base[:2] != 0)):
                        fail(FaultType.BOUNDS)
                    with m.Elif(phase == 0):
                        m.d.sync += [
                            thread.eq(resolved), armed.eq(0),
                            self_target.eq(owned & (gate.raw_base == out_base)),
                        ]
                        m.next = "HEADER"
                    with m.Elif(phase == 1):
                        m.d.sync += homes[row].eq(resolved)
                        m.next = "HOME_NEXT"
                    with m.Elif(phase == 2):
                        m.d.sync += entry.eq(resolved)
                        m.next = "ENTRY_HEADER"
                    with m.Else():
                        m.next = "CLIST_NEXT"
            with m.State("HEADER"):
                read(tv.word1_location)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [header.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "HEADER_CHECK"
            with m.State("HEADER_CHECK"):
                with m.If(~valid_header(header, size) |
                          (tw.limit_offset != size - 1) |
                          ((tv.word1_location + ((size - 1) << 2)) > 0xFFFFFFFF)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "INDICATOR"
            with m.State("INDICATOR"):
                read(tv.word1_location + 68)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [indicator.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "INDICATOR_CHECK"
            with m.State("INDICATOR_CHECK"):
                with m.If((indicator[13:28] != 0) |
                          (indicator[:12] < stack_lo) |
                          (indicator[:12] > caps - 1)):
                    fail(FaultType.STACK_CORRUPT)
                with m.Elif(self_target):
                    # Validate the newly captured continuation, never the old
                    # frame below the running Thread's protected indicator.
                    m.d.comb += self.cr_rd_addr.eq(6)
                    m.d.sync += [
                        gt.eq((self.cr_rd_data.as_value()[:32] & 0x87FFFFFF) | 0x48000000),
                        frame.eq(Cat(indicator[:13], nia, flags)),
                        phase.eq(2),
                    ]
                    m.next = "CHECK"
                with m.Elif(~indicator[12] | (indicator[:12] + 2 > caps - 1)):
                    fail(FaultType.STACK_CORRUPT)
                with m.Else():
                    m.next = "FRAME"
            with m.State("FRAME"):
                read(tv.word1_location + ((indicator[:12] + 2) << 2))
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [frame.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "FRAME_CHECK"
            with m.State("FRAME_CHECK"):
                with m.If(frame[13:28] == 0x7FFF):
                    fail(FaultType.STACK_UNDERFLOW)
                with m.Elif(frame[:12] != indicator[:12] + 2):
                    fail(FaultType.STACK_CORRUPT)
                with m.Else():
                    m.next = "EGT"
            with m.State("EGT"):
                read(tv.word1_location + ((indicator[:12] + 1) << 2))
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [gt.eq(self.mem_rd_data), phase.eq(2), armed.eq(0)]
                    m.next = "CHECK"
            with m.State("ENTRY_HEADER"):
                read(ev.word1_location)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [entry_header.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "ENTRY_CHECK"
            with m.State("ENTRY_CHECK"):
                with m.If(frame[13:28] == 0x7FFF):
                    fail(FaultType.STACK_UNDERFLOW)
                with m.Elif((entry_header[27:32] != 31) |
                          (entry_header[8:10] != 0) |
                          (entry_header[23:27] > 8) |
                          (entry_header[:8] == 0) |
                          (entry_header[10:23] == 0) |
                          (entry_header[:8] >= entry_size) |
                          (entry_header[10:23] >= entry_size - entry_header[:8]) |
                          (ew.limit_offset != entry_size - 1) |
                          ((ev.word1_location + ((entry_size - 1) << 2)) > 0xFFFFFFFF) |
                          ((frame[13:28] << 2) < ev.word1_location + 4) |
                          ((frame[13:28] << 2) >=
                           ev.word1_location + 4 + (entry_header[10:23] << 2))):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.d.sync += [row.eq(0), phase.eq(3)]
                    m.next = "CLIST"
            with m.State("CLIST"):
                read(ev.word1_location + ((entry_size - entry_header[:8] + row) << 2))
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [gt.eq(self.mem_rd_data), armed.eq(0)]
                    with m.If((row == 0) & (self.mem_rd_data != ev.word0_gt.as_value())):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Elif((row != 0) & ((self.mem_rd_data == 0) |
                                (self.mem_rd_data[25:27] == GT_TYPE_ABSTRACT))):
                        m.next = "CLIST_NEXT"
                    with m.Else():
                        m.next = "CHECK"
            with m.State("CLIST_NEXT"):
                with m.If(row + 1 >= entry_header[:8]):
                    m.d.sync += [row.eq(0), phase.eq(1)]
                    m.next = "HOME"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
                    m.next = "CLIST"
            with m.State("HOME"):
                read(tv.word1_location + ((caps + row) << 2))
                m.d.comb += self.cr_rd_addr.eq(row)
                with m.If(self_target):
                    m.d.sync += [gt.eq(self.cr_rd_data.as_value()[:32]), armed.eq(0)]
                    with m.If((self.cr_rd_data.as_value()[:32] == 0) |
                              (self.cr_rd_data.as_value()[25:27] == GT_TYPE_ABSTRACT)):
                        m.d.sync += homes[row].eq(Cat(
                            self.cr_rd_data.as_value()[:32], Const(0, 64)))
                        m.next = "HOME_NEXT"
                    with m.Else():
                        m.next = "CHECK"
                with m.Elif(armed & self.mem_rd_valid):
                    m.d.sync += [gt.eq(self.mem_rd_data), armed.eq(0)]
                    with m.If((self.mem_rd_data == 0) |
                              (self.mem_rd_data[25:27] == GT_TYPE_ABSTRACT)):
                        m.d.sync += homes[row].eq(Cat(self.mem_rd_data, Const(0, 64)))
                        m.next = "HOME_NEXT"
                    with m.Else():
                        m.next = "CHECK"
            with m.State("HOME_NEXT"):
                with m.If(row == 11):
                    m.d.sync += row.eq(0)
                    m.next = "DR"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
                    m.next = "HOME"
            with m.State("DR"):
                read(tv.word1_location + ((row + 1) << 2))
                m.d.comb += self.dr_rd_addr.eq(row)
                with m.If(self_target | (armed & self.mem_rd_valid)):
                    m.d.sync += [
                        drs[row].eq(Mux(self_target, self.dr_rd_data, self.mem_rd_data)),
                        armed.eq(0),
                    ]
                    with m.If(row == 15):
                        m.d.sync += row.eq(0)
                        with m.If(owned):
                            m.next = "OUT_HEADER"
                        with m.Else():
                            m.next = "POP"
                    with m.Else():
                        m.d.sync += row.eq(row + 1)
            with m.State("OUT_HEADER"):
                read(out_base)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [out_header.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "OUT_HEADER_CHECK"
            with m.State("OUT_HEADER_CHECK"):
                with m.If(~valid_header(out_header, out_size)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    m.next = "OUT_INDICATOR"
            with m.State("OUT_INDICATOR"):
                read(out_base + 68)
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [out_indicator.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "OUT_CHECK"
            with m.State("OUT_CHECK"):
                with m.If((out_indicator[13:28] != 0) |
                          (out_indicator[:12] > out_caps - 1)):
                    fail(FaultType.STACK_CORRUPT)
                with m.Elif(out_indicator[:12] < out_lo + 2):
                    fail(FaultType.STACK_OVERFLOW)
                with m.Else():
                    m.next = "SNAPSHOT"
            with m.State("SNAPSHOT"):
                m.d.comb += [self.cr_rd_addr.eq(row), self.dr_rd_addr.eq(row)]
                m.d.sync += saved_drs[row].eq(self.dr_rd_data)
                with m.If(row < 12):
                    m.d.sync += saved[row].eq(self.cr_rd_data)
                with m.If(row == 6):
                    m.d.sync += out_egt.eq(
                        (self.cr_rd_data.as_value()[:32] & 0x87FFFFFF) | 0x48000000)
                with m.If(row == 15):
                    m.d.sync += row.eq(0)
                    m.next = "SAVE_HOMES"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("SAVE_HOMES"):
                write(out_base + ((out_caps + row) << 2), saved[row][:32])
                with m.If(self.mem_wr_done):
                    with m.If(row == 11):
                        m.d.sync += row.eq(0)
                        m.next = "SAVE_EGT"
                    with m.Else():
                        m.d.sync += row.eq(row + 1)
            with m.State("SAVE_EGT"):
                write(out_base + ((out_indicator[:12] - 1) << 2), out_egt)
                with m.If(self.mem_wr_done):
                    m.next = "SAVE_FRAME"
            with m.State("SAVE_FRAME"):
                write(out_base + (out_indicator[:12] << 2),
                      Cat(out_indicator[:13], nia, flags))
                with m.If(self.mem_wr_done):
                    m.next = "SAVE_INDICATOR"
            with m.State("SAVE_INDICATOR"):
                write(out_base + 68,
                      Cat((out_indicator[:12] - 2)[:12], Const(1, 1), Const(0, 15), flags))
                with m.If(self.mem_wr_done):
                    m.next = "SAVE_DR"
            with m.State("SAVE_DR"):
                write(out_base + ((row + 1) << 2), saved_drs[row])
                with m.If(self.mem_wr_done):
                    with m.If(row == 15):
                        m.d.sync += row.eq(0)
                        m.next = "POP"
                    with m.Else():
                        m.d.sync += row.eq(row + 1)
            with m.State("POP"):
                write(tv.word1_location + 68, Cat(frame[:13], Const(0, 15), frame[28:32]))
                with m.If(self.mem_wr_done):
                    m.next = "COMMIT_HOMES"
            with m.State("COMMIT_HOMES"):
                m.d.comb += [self.cr_wr_en.eq(1), self.cr_wr_addr.eq(row),
                             self.cr_wr_data.eq(homes[row])]
                with m.If(row == 11):
                    m.d.sync += row.eq(0)
                    m.next = "COMMIT_DR"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("COMMIT_DR"):
                m.d.comb += [self.dr_wr_en.eq(1), self.dr_wr_addr.eq(row),
                             self.dr_wr_data.eq(drs[row])]
                with m.If(row == 15):
                    m.next = "COMMIT_THREAD"
                with m.Else():
                    m.d.sync += row.eq(row + 1)
            with m.State("COMMIT_THREAD"):
                m.d.comb += [self.cr_wr_en.eq(1), self.cr_wr_addr.eq(12),
                             self.cr_wr_data.eq(thread)]
                m.next = "COMMIT_HEAP"
            with m.State("COMMIT_HEAP"):
                m.d.comb += [
                    self.cr_wr_en.eq(1), self.cr_wr_addr.eq(5),
                    self.cr_wr_data.eq(Cat(
                        (tv.word0_gt.as_value() & 0x87FFFFFF) | 0x30000000,
                        (tv.word1_location + 72)[:32],
                        heap_w2)),
                ]
                m.next = "COMMIT_CODE"
            with m.State("COMMIT_CODE"):
                m.d.comb += [
                    self.cr_wr_en.eq(1), self.cr_wr_addr.eq(14),
                    self.cr_wr_data.eq(Cat(
                        (ev.word0_gt.as_value() & 0x87FFFFFF) | 0x50000000,
                        (ev.word1_location + 4)[:32],
                        code_w2)),
                ]
                m.next = "COMMIT_CLIST"
            with m.State("COMMIT_CLIST"):
                m.d.comb += [
                    self.cr_wr_en.eq(1), self.cr_wr_addr.eq(6),
                    self.cr_wr_data.eq(Cat(
                        (ev.word0_gt.as_value() & 0x87FFFFFF) | 0x18000000,
                        (ev.word1_location + ((entry_size - entry_header[:8]) << 2))[:32],
                        clist_w2)),
                    self.nia_restore_en.eq(1), self.nia_restore_val.eq(frame[13:28] << 2),
                    self.flags_restore_en.eq(1), self.flags_restore_data.eq(frame[28:32]),
                ]
                m.next = "DONE"
            with m.State("DONE"):
                m.d.comb += [self.change_complete.eq(1), self.thread_base_restore_en.eq(1)]
                m.next = "IDLE"
            with m.State("FAULT"):
                m.d.comb += self.change_fault.eq(1)
                m.next = "IDLE"
        m.d.comb += self.change_busy.eq(~fsm.ongoing("IDLE"))
        return m
