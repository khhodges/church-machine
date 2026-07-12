from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, NS_ENTRY_LAYOUT
from .core import CMCapCore
from hardware.irq_dispatch import ChurchIRQDispatch
from hardware.hw_types import SCHEDULER_IRQ_NS_SLOT, IRQ_REASON_LAZY_RESOLVE


class UARTTransmitter(Elaboratable):
    def __init__(self, divisor=868):
        self.divisor = divisor
        self.data = Signal(8)
        self.start = Signal()
        self.busy = Signal()
        self.tx = Signal(reset=1)

    def elaborate(self, platform):
        m = Module()

        counter = Signal(range(self.divisor))
        shift_reg = Signal(10)
        bit_count = Signal(4)

        with m.FSM(name="uart_tx"):
            with m.State("IDLE"):
                m.d.comb += self.busy.eq(0)
                with m.If(self.start):
                    m.d.sync += [
                        shift_reg.eq(Cat(Const(0, 1), self.data, Const(1, 1))),
                        bit_count.eq(0),
                        counter.eq(0),
                    ]
                    m.next = "SEND"

            with m.State("SEND"):
                m.d.comb += [self.busy.eq(1), self.tx.eq(shift_reg[0])]
                with m.If(counter == self.divisor - 1):
                    m.d.sync += [
                        counter.eq(0),
                        shift_reg.eq(Cat(Const(0, 1), shift_reg[1:])),
                        bit_count.eq(bit_count + 1),
                    ]
                    with m.If(bit_count == 9):
                        m.next = "IDLE"
                with m.Else():
                    m.d.sync += counter.eq(counter + 1)

        return m


class StatusReporter(Elaboratable):
    def __init__(self, divisor=868):
        self.divisor = divisor
        self.boot_complete = Signal()
        self.fault_valid = Signal()
        self.fault = Signal(4)
        self.nia = Signal(32)
        self.gc_busy = Signal()
        self.tx = Signal(reset=1)

    def elaborate(self, platform):
        m = Module()

        uart = UARTTransmitter(divisor=self.divisor)
        m.submodules.uart = uart
        m.d.comb += self.tx.eq(uart.tx)

        report_timer = Signal(24)
        byte_index = Signal(4)
        report_data = Signal(8)

        status_byte = Signal(8)
        m.d.comb += status_byte.eq(Cat(
            self.boot_complete,
            self.fault_valid,
            self.gc_busy,
            Const(0, 1),
            self.fault,
        ))

        nia_bytes = [self.nia[i*8:(i+1)*8] for i in range(4)]

        with m.FSM(name="reporter"):
            with m.State("WAIT"):
                m.d.sync += report_timer.eq(report_timer + 1)
                with m.If(report_timer == 0):
                    m.d.sync += byte_index.eq(0)
                    m.next = "SEND_HEADER"

            with m.State("SEND_HEADER"):
                with m.If(~uart.busy):
                    m.d.comb += [uart.data.eq(0xC7), uart.start.eq(1)]
                    m.next = "SEND_STATUS"

            with m.State("SEND_STATUS"):
                with m.If(~uart.busy):
                    m.d.comb += [uart.data.eq(status_byte), uart.start.eq(1)]
                    m.d.sync += byte_index.eq(0)
                    m.next = "SEND_NIA"

            with m.State("SEND_NIA"):
                with m.If(~uart.busy):
                    with m.Switch(byte_index):
                        for i in range(4):
                            with m.Case(i):
                                m.d.comb += report_data.eq(nia_bytes[i])
                    m.d.comb += [uart.data.eq(report_data), uart.start.eq(1)]
                    m.d.sync += byte_index.eq(byte_index + 1)
                    with m.If(byte_index == 3):
                        m.next = "WAIT"

        return m


IMEM_DEPTH = 1024
DMEM_DEPTH = 1024
NS_DEPTH = 256
CLIST_DEPTH = 256


class CMCapFPGATop(Elaboratable):
    def __init__(self, uart_divisor=868, program=None):
        self.uart_divisor = uart_divisor
        self.program = program or []

        self.uart_tx = Signal(reset=1)
        self.leds = Signal(4)

    def elaborate(self, platform):
        m = Module()

        core = CMCapCore()
        m.submodules.core = core

        reporter = StatusReporter(divisor=self.uart_divisor)
        m.submodules.reporter = reporter

        dispatch = ChurchIRQDispatch()
        m.submodules.dispatch = dispatch

        imem_init = self.program + [0] * (IMEM_DEPTH - len(self.program))
        imem = Memory(width=32, depth=IMEM_DEPTH, init=imem_init[:IMEM_DEPTH])
        m.submodules.imem = imem
        imem_rd = imem.read_port()
        imem_rd2 = imem.read_port()

        m.d.comb += [
            imem_rd.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(imem_rd.data),
        ]

        dmem = Memory(width=32, depth=DMEM_DEPTH, init=[0] * DMEM_DEPTH)
        m.submodules.dmem = dmem
        dmem_rd = dmem.read_port()
        dmem_wr = dmem.write_port()

        m.d.comb += [
            dmem_rd.addr.eq(core.dmem_addr[2:12]),
            core.dmem_rd_data.eq(dmem_rd.data),
            dmem_wr.addr.eq(core.dmem_addr[2:12]),
            dmem_wr.data.eq(core.dmem_wr_data),
            dmem_wr.en.eq(core.dmem_wr_en),
        ]

        ns_width = 32 * 4  # NS_ENTRY_WORDS=4 (stride-4, 16 bytes/slot); matches boot_image.py
        ns_mem = Memory(width=ns_width, depth=NS_DEPTH, init=[0] * NS_DEPTH)
        m.submodules.ns_mem = ns_mem
        ns_rd = ns_mem.read_port()
        ns_wr = ns_mem.write_port()
        ns_rd2 = ns_mem.read_port()

        m.d.comb += [
            ns_rd.addr.eq(core.ns_addr[:8]),
            core.ns_rd_data.eq(ns_rd.data),
            ns_wr.addr.eq(core.ns_addr[:8]),
            ns_wr.data.eq(core.ns_wr_data),
            ns_wr.en.eq(core.ns_wr_en),
        ]

        gt_width = 32
        clist_mem = Memory(width=gt_width, depth=CLIST_DEPTH, init=[0] * CLIST_DEPTH)
        m.submodules.clist_mem = clist_mem
        clist_rd = clist_mem.read_port()
        clist_wr = clist_mem.write_port()

        m.d.comb += [
            clist_rd.addr.eq(core.clist_addr[:8]),
            core.clist_rd_data.eq(clist_rd.data),
            clist_wr.addr.eq(core.clist_addr[:8]),
            clist_wr.data.eq(core.clist_wr_data),
            clist_wr.en.eq(core.clist_wr_en),
        ]

        boot_delay = Signal(4, init=0)
        boot_pulsed = Signal()

        with m.If(~boot_pulsed):
            m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.If(boot_delay == 15):
                m.d.sync += boot_pulsed.eq(1)

        m.d.comb += [
            core.boot_start.eq((boot_delay == 15) & ~boot_pulsed),
            core.imem_valid.eq(core.boot_complete),
            core.gc_start.eq(0),
        ]

        m.d.comb += [
            reporter.boot_complete.eq(core.boot_complete),
            reporter.fault_valid.eq(core.fault_valid),
            reporter.fault.eq(core.fault),
            reporter.nia.eq(core.nia),
            reporter.gc_busy.eq(core.gc_busy),
            self.uart_tx.eq(reporter.tx),
        ]

        m.d.comb += [
            self.leds[0].eq(core.boot_complete),
            self.leds[1].eq(core.fault_valid),
            self.leds[2].eq(core.gc_busy),
            self.leds[3].eq(core.nia[0]),
        ]

        # -----------------------------------------------------------------------
        # IRQ dispatch — connect core ELOADCALL outputs to ChurchIRQDispatch.
        #
        # The dispatch FSM performs two sequential memory reads:
        #   FETCH_NS:     reads ns_mem slot SCHEDULER_IRQ_NS_SLOT (always slot 8)
        #                 to obtain the Scheduler lump base address (word0_location).
        #   FETCH_METHOD: reads imem at (ns_base + SCHEDULER_IRQ_METHOD_IDX * 4)
        #                 to obtain the handler method-table entry.
        #
        # A 1-bit phase tracker (irq_fetch_phase) distinguishes the two reads:
        #   0 = FETCH_NS (first read in any dispatch sequence)
        #   1 = FETCH_METHOD (second read)
        # The phase resets to 0 whenever the dispatch unit is idle.
        #
        # Memory responses are provided with 1-cycle synchronous latency via a
        # registered valid signal (dispatch_mem_valid_r), matching the Amaranth
        # synchronous read-port model used for all other on-chip memories.
        # -----------------------------------------------------------------------

        # ns_rd2: dedicated second read port — permanently addressed to
        # SCHEDULER_IRQ_NS_SLOT so word0_location is always ready on ns_rd2.data[:32].
        m.d.comb += ns_rd2.addr.eq(SCHEDULER_IRQ_NS_SLOT)

        # imem_rd2: second read port for method-table lookup during FETCH_METHOD.
        # Address is driven by the dispatch's mem_rd_addr (byte → word conversion).
        m.d.comb += imem_rd2.addr.eq(dispatch.mem_rd_addr[2:12])

        # Phase tracker: 0=FETCH_NS, 1=FETCH_METHOD.
        # Advances only when the dispatch actually consumes a valid response
        # (mem_rd_en & mem_rd_valid), so it lags the FSM transition by 0 cycles.
        irq_fetch_phase = Signal()

        # phase_settled: suppresses the stale dispatch_mem_valid_r that arrives
        # in the FIRST cycle of each new fetch phase.  When the phase transitions
        # (IDLE→FETCH_NS or FETCH_NS→FETCH_METHOD), settled resets to 0 for
        # one cycle so the dispatch sees no valid until the address has been
        # presented for a full clock cycle and the new memory data is ready.
        phase_settled = Signal()

        # 1-cycle registered valid — mirrors Amaranth synchronous read-port latency.
        dispatch_mem_valid_r = Signal()
        m.d.sync += dispatch_mem_valid_r.eq(dispatch.mem_rd_en)

        with m.If(~dispatch.busy):
            m.d.sync += [irq_fetch_phase.eq(0), phase_settled.eq(0)]
        with m.Elif(dispatch.mem_rd_en & dispatch.mem_rd_valid):
            m.d.sync += [irq_fetch_phase.eq(1), phase_settled.eq(0)]
        with m.Else():
            with m.If(~phase_settled):
                m.d.sync += phase_settled.eq(1)

        m.d.comb += [
            dispatch.mem_rd_valid.eq(dispatch_mem_valid_r & phase_settled),
            # FETCH_NS (phase=0): ns_mem slot SCHEDULER_IRQ_NS_SLOT word0_location.
            # FETCH_METHOD (phase=1): imem word at ns_base + SCHEDULER_IRQ_METHOD_IDX*4.
            dispatch.mem_rd_data.eq(
                Mux(irq_fetch_phase == 0,
                    ns_rd2.data[:32],
                    imem_rd2.data)
            ),
        ]

        # -----------------------------------------------------------------------
        # Wire core IRQ outputs → dispatch inputs.
        #
        # Two instructions share IRQ_REASON_LAZY_RESOLVE and route through the
        # same ChurchIRQDispatch FSM:
        #
        #   ELOADCALL  (core.irq_valid):
        #     Fires when an ELOADCALL passes the E-perm check on CR_CLIST.
        #     dispatch.irq_slot = core.irq_dr1 (c-list row of the NULL GT).
        #     DR2 receives irq_method_index (advisory: which method was stalled).
        #
        #   XLOADLAMBDA (core.xloadlambda_valid):
        #     Fires when an XLOADLAMBDA passes the X-perm check on CR_CLOOMC.
        #     A NULL lambda body silently stalls without this dispatch path.
        #     dispatch.irq_slot = core.xloadlambda_index (lambda body cap_index).
        #     DR2 = 0 (no method index — XLOADLAMBDA is not a method call).
        #
        # Both signals are one-cycle pulses that cannot overlap (they fire from
        # mutually exclusive opcodes on a single-issue pipeline).
        # dispatch.irq_slot receives the recovery context Scheduler.IRQ needs to
        # resolve the stall; it is written to DR1 by the dispatch FSM.
        # -----------------------------------------------------------------------
        m.d.comb += [
            dispatch.start.eq(core.irq_valid | core.xloadlambda_valid),
            dispatch.irq_reason.eq(core.irq_reason[:2]),
            dispatch.irq_slot.eq(
                Mux(core.xloadlambda_valid, core.xloadlambda_index, core.irq_dr1)
            ),
            dispatch.cr15_namespace.eq(core.cr15_namespace_out),
        ]

        # -----------------------------------------------------------------------
        # irq_method_index — advisory context for the handler.
        # Latched from core.irq_method_index on the irq_valid (ELOADCALL) pulse,
        # then written to DR2 via core.irq_dispatch_dr2_wr_en when dispatch.complete
        # fires.  DR2 tells Scheduler.IRQ which method was stalled so it can retry
        # the call after resolving the NULL c-list GT.
        # For XLOADLAMBDA, DR2 is latched as 0 — XLOADLAMBDA carries a cap_index
        # (already in DR1 via irq_slot), not a method index.
        # -----------------------------------------------------------------------
        irq_method_index_lat = Signal(7)
        with m.If(core.irq_valid):
            m.d.sync += irq_method_index_lat.eq(core.irq_method_index)
        with m.Elif(core.xloadlambda_valid):
            m.d.sync += irq_method_index_lat.eq(0)

        m.d.comb += [
            core.irq_dispatch_dr2_wr_en.eq(dispatch.complete),
            core.irq_dispatch_dr2_wr_data.eq(irq_method_index_lat),
        ]

        # -----------------------------------------------------------------------
        # Wire dispatch write-back outputs → core write-back input ports.
        # dispatch.busy stalls core instruction execution while the FSM runs.
        # -----------------------------------------------------------------------
        m.d.comb += [
            core.irq_dispatch_busy.eq(dispatch.busy),
            core.irq_dispatch_nia_set.eq(dispatch.nia_set),
            core.irq_dispatch_nia_value.eq(dispatch.nia_value),
            core.irq_dispatch_dr_wr_en.eq(dispatch.dr_wr_en),
            core.irq_dispatch_dr_wr_addr.eq(dispatch.dr_wr_addr),
            core.irq_dispatch_dr_wr_data.eq(dispatch.dr_wr_data),
            core.irq_dispatch_dr1_wr_en.eq(dispatch.dr1_wr_en),
            core.irq_dispatch_dr1_wr_data.eq(dispatch.dr1_wr_data),
        ]

        return m
