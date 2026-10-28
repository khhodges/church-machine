"""One-GT programmatic Thread activation, independent of boot and scheduler.

All admission reads finish before the first context write. The namespace gate
never receives elevated authority; private Thread access is internal microcode,
not an L/S capability temporarily installed in an architectural register.
"""
from amaranth import *
from amaranth.lib.data import View

from .layouts import CAP_REG_LAYOUT, GT_LAYOUT, WORD2_LAYOUT
from .hw_types import FaultType, GT_TYPE_INFORM, GT_TYPE_ABSTRACT, PERM_L
from .perm_check import perm_bit
from .ns_gate import ChurchNSGate
from .mload import ChurchMLoad
from .thread_design import THREAD_MIN_N_MINUS_6, THREAD_MAX_N_MINUS_6
from .ascending_authority import cached_authority


class OrdinaryChange(Elaboratable):
    INPUTS = (
        "cr_src", "cr_dst", "index", "cr_rd_data", "cr12_thread",
        "cr15_namespace", "active_thread_base", "active_thread_owned",
        "mem_rd_data", "mem_rd_valid", "mem_wr_done", "dr_rd_data",
        "flags_in", "nia_current", "code_base",
        "namespace_handoff", "incoming_namespace", "cr6_m",
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

    def __init__(self, ports, *, resident_word_locations=False):
        self.resident_word_locations = resident_word_locations
        self.change_start = Signal()
        for name in self.INPUTS + self.OUTPUTS:
            setattr(self, name, Signal.like(getattr(ports, name), name="ordinary_" + name))

    def elaborate(self, platform):
        m = Module()
        m.submodules.gate = gate = ChurchNSGate(
            enable_seal_check=True,
            authority_version_shift=21)
        m.submodules.home_load = home_load = ChurchMLoad(
            enable_seal_check=True, resident_word_locations=self.resident_word_locations)
        resolved_base = Signal(32)
        resolved_authority = Signal(32)
        invalid_descriptor = Signal()
        if self.resident_word_locations:
            # Gate integrity/version checks apply to original stored words.
            # Ordinary CHANGE's direct resolutions must all be resident RAM.
            m.d.comb += [
                resolved_base.eq(gate.raw_base << 2),
                resolved_authority.eq(cached_authority(gate.raw_w2)),
                invalid_descriptor.eq((gate.raw_base >= 16384) |
                    (gate.raw_base + gate.raw_w2[:21] >= 16384)),
            ]
        else:
            m.d.comb += [resolved_base.eq(gate.raw_base),
                         resolved_authority.eq(gate.raw_w2)]
        namespace = Signal(96)
        home_namespace = Signal(CAP_REG_LAYOUT)
        hnv = View(CAP_REG_LAYOUT, home_namespace)
        hnw = View(WORD2_LAYOUT, hnv.word2_w2)
        thread = Signal(96)
        entry = Signal(96)
        homes = Array(Signal(96, name=f"incoming_cr{i}") for i in range(12))
        saved = Array(Signal(96, name=f"outgoing_cr{i}") for i in range(12))
        drs = Array(Signal(32, name=f"incoming_dr{i}") for i in range(16))
        saved_drs = Array(Signal(32, name=f"outgoing_dr{i}") for i in range(16))
        operand = Signal(4)
        lookup_source = Signal(CAP_REG_LAYOUT)
        lookup_row = Signal(15)
        lookup_m = Signal()
        lookup_pending = Signal()
        lookup_view = View(CAP_REG_LAYOUT, lookup_source)
        lookup_gt = View(GT_LAYOUT, lookup_view.word0_gt)
        lookup_w2 = View(WORD2_LAYOUT, lookup_view.word2_w2)
        lookup_address = Signal(33)
        indexed_form = (self.cr_dst == 12) & (self.cr_src == 6) & ~self.index[15]
        m.d.comb += lookup_address.eq(lookup_view.word1_location + (lookup_row << 2))
        gt = Signal(32)
        gv = View(GT_LAYOUT, gt)
        tv, ev = View(CAP_REG_LAYOUT, thread), View(CAP_REG_LAYOUT, entry)
        nw = View(WORD2_LAYOUT, View(CAP_REG_LAYOUT, namespace).word2_w2)
        tw, ew = View(WORD2_LAYOUT, tv.word2_w2), View(WORD2_LAYOUT, ev.word2_w2)
        rw = View(WORD2_LAYOUT, resolved_authority)
        header, out_header, entry_header = Signal(32), Signal(32), Signal(32)
        size, out_size, entry_size = Signal(16), Signal(16), Signal(16)
        caps, out_caps, stack_lo, out_lo = (Signal(16) for _ in range(4))
        indicator, frame, out_indicator = Signal(32), Signal(32), Signal(32)
        out_base, out_egt = Signal(32), Signal(32)
        owned, self_target = Signal(), Signal()
        handoff, root_entry = Signal(), Signal()
        flags, nia = Signal(4), Signal(15)
        row = Signal(8)
        phase = Signal(2)  # target Thread, incoming homes, frame E-GT, C-List
        code = Signal(5)
        armed, rd = Signal(), Signal()
        addr = Signal(32)
        heap_w2, code_w2, clist_w2 = (Signal(WORD2_LAYOUT) for _ in range(3))
        resolved = Cat(gt, resolved_base, resolved_authority)
        m.d.comb += [
            gate.gt_word0.eq(gt), gate.cr15_namespace.eq(namespace),
            gate.m_elevated.eq(0), gate.mem_rd_data.eq(self.mem_rd_data),
            gate.mem_rd_valid.eq(self.mem_rd_valid & gate.ns_gate_busy),
            self.mem_rd_en.eq(Mux(home_load.sub_busy, home_load.mem_rd_en,
                                 Mux(gate.ns_gate_busy, gate.mem_rd_en, rd))),
            self.mem_rd_addr.eq(Mux(home_load.sub_busy, home_load.mem_addr,
                                   Mux(gate.ns_gate_busy, gate.mem_addr, addr))),
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
            home_load.sub_direct.eq(1),
            home_load.sub_direct_gt.eq(gt),
            home_load.sub_validate_only.eq(1),
            home_load.sub_m_elevated.eq(0),
            home_namespace.eq(namespace),
            hnw.limit_offset.eq(nw.limit_offset if self.resident_word_locations else nw.limit_offset >> 2),
            home_load.cr15_namespace.eq(home_namespace),
            home_load.mem_rd_data.eq(self.mem_rd_data),
            home_load.mem_rd_valid.eq(self.mem_rd_valid & home_load.sub_busy),
        ]

        def fail(kind):
            # Context checks share the approved hard-fault category. Encoding
            # and the operand's permissions are checked separately at accept.
            m.d.sync += code.eq(FaultType.THREAD_CONTEXT)
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
                    m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                    m.d.sync += [
                        operand.eq(self.cr_src),
                        lookup_source.eq(self.cr_rd_data),
                        lookup_row.eq(self.index[:15]),
                        lookup_m.eq(self.cr6_m),
                        lookup_pending.eq(0),
                        namespace.eq(Mux(self.namespace_handoff,
                                         self.incoming_namespace, self.cr15_namespace)),
                        handoff.eq(self.namespace_handoff), root_entry.eq(0),
                        gt.eq(Mux(self.namespace_handoff, 0x02000002,
                                  self.cr_rd_data.as_value()[:32])),
                        owned.eq(self.active_thread_owned),
                        # CR12 is the architectural Thread identity. The
                        # scheduler's backing-address hint is not authority.
                        out_base.eq(View(CAP_REG_LAYOUT, self.cr12_thread).word1_location),
                        flags.eq(self.flags_in),
                        nia.eq(((self.nia_current - self.code_base) >> 2) + 1),
                        phase.eq(0), row.eq(0), armed.eq(0), code.eq(0),
                    ]
                    with m.If(~self.namespace_handoff &
                              (~indexed_form & ((self.cr_dst != 0) | (self.index != 0) |
                               (self.cr_src == 13)))):
                        m.d.sync += code.eq(FaultType.INVALID_OP)
                        m.next = "FAULT"
                    with m.Elif(~self.namespace_handoff & indexed_form):
                        m.next = "LOOKUP_CHECK"
                    with m.Else():
                        m.next = "CHECK"
            with m.State("LOOKUP_CHECK"):
                # This is a bounded C-list read, never elevated Namespace
                # authority and never a temporary architectural CR write.
                with m.If(lookup_gt.gt_type != GT_TYPE_INFORM):
                    m.d.sync += code.eq(FaultType.NULL_CAP)
                    m.next = "FAULT"
                with m.Elif(~perm_bit(lookup_view.word0_gt, PERM_L) & ~lookup_m):
                    m.d.sync += code.eq(FaultType.PERM_L)
                    m.next = "FAULT"
                with m.Elif((lookup_row > lookup_w2.limit_offset) |
                            lookup_address[32] | (lookup_address[:2] != 0) |
                            lookup_w2.f_flag | (lookup_gt.slot_id == 0) |
                            (((lookup_gt.slot_id << 2) + 3) > nw.limit_offset)):
                    m.d.sync += code.eq(FaultType.BOUNDS)
                    m.next = "FAULT"
                with m.Else():
                    # Validate the source identity too: a cached C-list view
                    # must not confer authority after its Namespace revocation.
                    m.d.sync += [gt.eq(lookup_view.word0_gt),
                                 lookup_pending.eq(1)]
                    m.next = "GATE"
            with m.State("LOOKUP_READ"):
                read(lookup_address[:32])
                with m.If(armed & self.mem_rd_valid):
                    m.d.sync += [gt.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "CHECK"
            with m.State("CHECK"):
                with m.If(gv.gt_type != GT_TYPE_INFORM):
                    fail(FaultType.NULL_CAP)
                with m.Elif((phase == 0) & (gv.perm != 0)):
                    m.d.sync += code.eq(FaultType.THREAD_PERMISSIONS)
                    m.next = "FAULT"
                with m.Elif((phase == 2) & (~gv.dom | (gv.perm != 4))):
                    fail(FaultType.PERM_E)
                with m.Elif((gv.slot_id == 0) |
                            (((gv.slot_id << 2) + 3) > nw.limit_offset) |
                            ((View(CAP_REG_LAYOUT, namespace).word1_location +
                              (gv.slot_id << 4) + 15) > 0xFFFFFFFF)):
                    fail(FaultType.BOUNDS)
                with m.Else():
                    with m.If(phase == 1):
                        m.next = "HOME_LOAD"
                    with m.Else():
                        m.next = "GATE"
            with m.State("HOME_LOAD"):
                m.d.comb += home_load.sub_start.eq(1)
                m.next = "HOME_WAIT"
            with m.State("HOME_WAIT"):
                with m.If(home_load.sub_fault):
                    fail(home_load.sub_fault_type)
                with m.Elif(home_load.sub_done):
                    restored = View(CAP_REG_LAYOUT, home_load.resolved_cap)
                    with m.If(View(WORD2_LAYOUT, restored.word2_w2).f_flag |
                              (restored.word1_location[:2] != 0)):
                        fail(FaultType.BOUNDS)
                    with m.Else():
                        m.d.sync += homes[row].eq(home_load.resolved_cap)
                        m.next = "HOME_NEXT"
            with m.State("GATE"):
                m.d.comb += gate.ns_gate_start.eq(1)
                m.next = "WAIT"
            with m.State("WAIT"):
                with m.If(gate.ns_gate_fault):
                    fail(gate.ns_gate_fault_type)
                with m.Elif(gate.ns_gate_done):
                    with m.If(invalid_descriptor | rw.f_flag | (resolved_base[:2] != 0)):
                        fail(FaultType.BOUNDS)
                    with m.Elif(lookup_pending):
                        with m.If((lookup_address < resolved_base) |
                                  (lookup_address > resolved_base + (rw.limit_offset << 2))):
                            m.d.sync += code.eq(FaultType.BOUNDS)
                            m.next = "FAULT"
                        with m.Else():
                            m.d.sync += lookup_pending.eq(0)
                            m.next = "LOOKUP_READ"
                    with m.Elif(phase == 0):
                        m.d.sync += [
                            thread.eq(resolved), armed.eq(0),
                            self_target.eq(~handoff & owned & (resolved_base == out_base)),
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
                with m.If(handoff & (frame == ((caps - 1) | 0x1000 |
                                               (0x7FFF << 13))) &
                          (indicator == ((caps - 3) | 0x1000))):
                    m.d.sync += root_entry.eq(1)
                    m.next = "EGT"
                with m.Elif(frame[13:28] == 0x7FFF):
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
                with m.If(~root_entry & (frame[13:28] == 0x7FFF)):
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
                          (~root_entry & (frame[13:28] >= entry_header[10:23]))):
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
                # Structure and executable SELF suffice. Other rows are
                # checked by mLoad when used, never eagerly scanned here.
                with m.If(row == 0):
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
                    with m.If((self.cr_rd_data.as_value()[25:27] == 0) |
                              (self.cr_rd_data.as_value()[25:27] == GT_TYPE_ABSTRACT)):
                        m.d.sync += homes[row].eq(Cat(
                            self.cr_rd_data.as_value()[:32], Const(0, 64)))
                        m.next = "HOME_NEXT"
                    with m.Else():
                        m.next = "CHECK"
                with m.Elif(armed & self.mem_rd_valid):
                    m.d.sync += [gt.eq(self.mem_rd_data), armed.eq(0)]
                    with m.If(root_entry & (row == 0) &
                              (self.mem_rd_data != ev.word0_gt.as_value())):
                        fail(FaultType.STACK_CORRUPT)
                    with m.Elif((self.mem_rd_data[25:27] == 0) |
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
                            m.next = "NAMESPACE"
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
                        m.next = "NAMESPACE"
                    with m.Else():
                        m.d.sync += row.eq(row + 1)
            with m.State("NAMESPACE"):
                # All destination admission and outgoing save has completed.
                # Keep the core busy across this architectural midpoint.
                with m.If(handoff):
                    m.d.comb += [self.cr_wr_en.eq(1), self.cr_wr_addr.eq(15),
                                 self.cr_wr_data.eq(namespace)]
                with m.If(root_entry):
                    m.next = "COMMIT_HOMES"
                with m.Else():
                    m.next = "POP"
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
                    self.nia_restore_en.eq(1),
                    self.nia_restore_val.eq(ev.word1_location + 4 +
                                           Mux(root_entry, 0, frame[13:28] << 2)),
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
