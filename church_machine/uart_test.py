"""Diagnostic: Full ChurchCore with SPRAM init + boot + instruction execution.
Tests whether instruction execution crashes the RP2040.
"""

from amaranth import *
from .uart_tx import DebugPrinter
from .core import ChurchCore
from .boot_rom import BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST
from .pico_ice import ICE40SPRAM, ICE40RGBLED


class UartTestTop(Elaboratable):
    def __init__(self, clk_freq=12_000_000, baud=115200):
        self.clk_freq = clk_freq
        self.baud = baud
        self.uart_tx = Signal(init=1)
        self.led_r = Signal()
        self.led_g = Signal()
        self.led_b = Signal()
        self.push_button = Signal()
        self.uart_rx = Signal()

    def elaborate(self, platform):
        m = Module()

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug
        m.d.comb += self.uart_tx.eq(debug.tx)

        rgb = ICE40RGBLED()
        m.submodules.rgb = rgb

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        spram = ICE40SPRAM()
        m.submodules.spram = spram

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:11]),
            core.imem_data.eq(boot_rom.data),
        ]

        mem_addr = Signal(14)
        any_ns_access = Signal()
        any_clist_access = Signal()
        m.d.comb += [
            any_ns_access.eq(core.ns_rd_en | core.ns_wr_en),
            any_clist_access.eq(core.clist_rd_en | core.clist_wr_en),
        ]
        with m.If(any_ns_access):
            m.d.comb += mem_addr.eq(core.ns_addr[2:16])
        with m.Elif(any_clist_access):
            m.d.comb += mem_addr.eq(core.clist_addr[2:16])
        with m.Else():
            m.d.comb += mem_addr.eq(core.dmem_addr[2:16])

        m.d.comb += spram.addr.eq(mem_addr)
        m.d.comb += core.dmem_rd_data.eq(spram.rd_data)
        m.d.comb += [
            core.ns_rd_data.eq(Cat(spram.rd_data, C(0, 64))),
            core.clist_rd_data.eq(spram.rd_data),
        ]

        wr_data = Signal(32)
        wr_en = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [wr_data.eq(core.ns_wr_data[:32]), wr_en.eq(1)]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [wr_data.eq(core.clist_wr_data), wr_en.eq(1)]
        with m.Else():
            m.d.comb += [wr_data.eq(core.dmem_wr_data), wr_en.eq(core.dmem_wr_en)]
        m.d.comb += [
            spram.wr_data.eq(wr_data),
            spram.wr_en.eq(wr_en),
        ]

        ns_flat = []
        for i in range(0, len(DEMO_NAMESPACE), 3):
            if i + 2 < len(DEMO_NAMESPACE):
                ns_flat.extend([DEMO_NAMESPACE[i], DEMO_NAMESPACE[i+1], DEMO_NAMESPACE[i+2]])
        clist_flat = list(DEMO_CLIST[:64])
        init_data = ns_flat + [0] * (192 - len(ns_flat)) + clist_flat + [0] * (64 - len(clist_flat))
        init_total = len(init_data)

        init_idx = Signal(range(init_total + 1))
        init_done = Signal()
        init_word = Signal(32)

        with m.Switch(init_idx):
            for i, word in enumerate(init_data):
                if word != 0:
                    with m.Case(i):
                        m.d.comb += init_word.eq(word)
            with m.Default():
                m.d.comb += init_word.eq(0)

        with m.If(~init_done):
            m.d.comb += [
                spram.addr.eq(init_idx),
                spram.wr_data.eq(init_word),
                spram.wr_en.eq(1),
            ]
            with m.If(init_idx < init_total):
                m.d.sync += init_idx.eq(init_idx + 1)
            with m.Else():
                m.d.sync += init_done.eq(1)

        boot_delay = Signal(4)
        boot_triggered = Signal()
        with m.If(~boot_triggered & init_done):
            with m.If(boot_delay < 0xF):
                m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.Else():
                m.d.comb += core.boot_start.eq(1)
                m.d.sync += boot_triggered.eq(1)

        m.d.comb += core.imem_valid.eq(core.boot_complete)
        m.d.comb += core.gc_start.eq(0)

        counter = Signal(32, init=0)
        delay_ctr = Signal(24)
        heartbeat = Signal()

        report_phase = Signal()

        with m.FSM(name="diag_fsm"):
            with m.State("DELAY"):
                m.d.sync += delay_ctr.eq(delay_ctr + 1)
                with m.If(delay_ctr == (self.clk_freq // 4) - 1):
                    m.d.sync += [delay_ctr.eq(0), heartbeat.eq(~heartbeat)]
                    m.next = "SEND_STATUS"

            with m.State("SEND_STATUS"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(Cat(core.boot_state, core.fault_valid,
                                          core.fault, core.boot_complete,
                                          counter[:24])),
                        debug.send.eq(1),
                    ]
                    m.next = "WAIT_STATUS"

            with m.State("WAIT_STATUS"):
                with m.If(~debug.busy):
                    m.next = "SEND_NIA"

            with m.State("SEND_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(core.nia),
                        debug.send.eq(1),
                    ]
                    m.d.sync += counter.eq(counter + 1)
                    m.next = "WAIT_NIA"

            with m.State("WAIT_NIA"):
                with m.If(~debug.busy):
                    m.next = "DELAY"

        m.d.comb += [
            rgb.r.eq(core.fault_valid),
            rgb.g.eq(heartbeat & init_done),
            rgb.b.eq(~init_done),
        ]
        m.d.comb += [
            self.led_r.eq(core.fault_valid),
            self.led_g.eq(heartbeat & init_done),
            self.led_b.eq(~init_done),
        ]

        return m
