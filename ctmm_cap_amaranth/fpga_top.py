from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, NS_ENTRY_LAYOUT
from .core import CMCapCore


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

        imem_init = self.program + [0] * (IMEM_DEPTH - len(self.program))
        imem = Memory(width=32, depth=IMEM_DEPTH, init=imem_init[:IMEM_DEPTH])
        m.submodules.imem = imem
        imem_rd = imem.read_port()

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

        ns_width = 32 * 3
        ns_mem = Memory(width=ns_width, depth=NS_DEPTH, init=[0] * NS_DEPTH)
        m.submodules.ns_mem = ns_mem
        ns_rd = ns_mem.read_port()
        ns_wr = ns_mem.write_port()

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

        return m
