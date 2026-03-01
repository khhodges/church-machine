"""Proven pico-ice design: Full ChurchCore with SPRAM, boot, banner, halt, step.
This version works on hardware (verified via diagnostic testing) and adds
the full debug output: CHURCH v1.0 banner, NIA dump, HALT, button stepping.
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

        halted = Signal(init=1)
        stepping = Signal()

        prev_nia = Signal(32)
        m.d.sync += prev_nia.eq(core.nia)
        nia_changed = Signal()
        m.d.comb += nia_changed.eq(core.nia != prev_nia)
        step_complete = Signal()
        m.d.comb += step_complete.eq(stepping & nia_changed)

        m.d.comb += core.imem_valid.eq(~halted | (stepping & ~step_complete))
        m.d.comb += core.gc_start.eq(0)

        btn_sync = Signal(3)
        btn_prev = Signal()
        m.d.sync += [
            btn_sync[0].eq(self.push_button),
            btn_sync[1].eq(btn_sync[0]),
            btn_sync[2].eq(btn_sync[1]),
            btn_prev.eq(btn_sync[2]),
        ]
        btn_press = Signal()
        m.d.comb += btn_press.eq(btn_prev & ~btn_sync[2])

        heartbeat_ctr = Signal(23)
        m.d.sync += heartbeat_ctr.eq(heartbeat_ctr + 1)
        heartbeat_blink = Signal()
        m.d.comb += heartbeat_blink.eq(heartbeat_ctr[-1])

        led_boot = Signal()
        led_run = Signal()
        led_fault = Signal()
        led_halted_blink = Signal()
        m.d.comb += [
            led_boot.eq(~core.boot_complete),
            led_run.eq(core.boot_complete & ~core.fault_valid & ~halted),
            led_fault.eq(core.fault_valid),
            led_halted_blink.eq(core.boot_complete & halted & ~core.fault_valid & heartbeat_blink),
        ]

        BANNER = Array([C(ord(c), 8) for c in "CHURCH v1.0\r\n"])
        banner_idx = Signal(range(len(BANNER) + 1))
        banner_byte = Signal(8)
        m.d.comb += banner_byte.eq(BANNER[banner_idx])

        HALT_MSG = Array([C(ord(c), 8) for c in "HALT\r\n"])
        halt_idx = Signal(range(len(HALT_MSG) + 1))
        halt_byte = Signal(8)
        m.d.comb += halt_byte.eq(HALT_MSG[halt_idx])

        STEP_MSG = Array([C(ord(c), 8) for c in "S:"])
        step_idx = Signal(range(len(STEP_MSG) + 1))
        step_byte = Signal(8)
        m.d.comb += step_byte.eq(STEP_MSG[step_idx])

        FAULT_MSG = Array([C(ord(c), 8) for c in "F:"])
        fault_msg_idx = Signal(range(len(FAULT_MSG) + 1))
        fault_byte = Signal(8)
        m.d.comb += fault_byte.eq(FAULT_MSG[fault_msg_idx])

        step_nia = Signal(32)
        step_fault = Signal(4)
        step_had_fault = Signal()

        startup_ctr = Signal(26)

        with m.FSM(name="debug_fsm"):
            with m.State("STARTUP_DELAY"):
                m.d.sync += startup_ctr.eq(startup_ctr + 1)
                with m.If(startup_ctr == (self.clk_freq * 3) - 1):
                    m.next = "WAIT_BOOT"

            with m.State("WAIT_BOOT"):
                with m.If(core.boot_complete):
                    m.d.sync += [banner_idx.eq(0), halted.eq(1)]
                    m.next = "SEND_BANNER"

            with m.State("SEND_BANNER"):
                with m.If(~debug.busy):
                    with m.If(banner_idx < len(BANNER)):
                        m.d.comb += [
                            debug.byte_data.eq(banner_byte),
                            debug.send_byte.eq(1),
                        ]
                        m.d.sync += banner_idx.eq(banner_idx + 1)
                    with m.Else():
                        m.next = "DUMP_NIA"

            with m.State("DUMP_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(core.nia),
                        debug.send.eq(1),
                    ]
                    m.next = "SEND_HALT"

            with m.State("SEND_HALT"):
                with m.If(~debug.busy):
                    with m.If(halt_idx < len(HALT_MSG)):
                        m.d.comb += [
                            debug.byte_data.eq(halt_byte),
                            debug.send_byte.eq(1),
                        ]
                        m.d.sync += halt_idx.eq(halt_idx + 1)
                    with m.Else():
                        m.d.sync += halt_idx.eq(0)
                        m.next = "HALTED"

            with m.State("HALTED"):
                with m.If(btn_press):
                    m.d.sync += stepping.eq(1)
                    m.next = "STEP_WAIT"

            with m.State("STEP_WAIT"):
                with m.If(step_complete):
                    m.d.sync += [
                        stepping.eq(0),
                        step_nia.eq(core.nia),
                        step_fault.eq(core.fault),
                        step_had_fault.eq(core.fault_valid),
                        step_idx.eq(0),
                    ]
                    m.next = "STEP_LABEL"

            with m.State("STEP_LABEL"):
                with m.If(~debug.busy):
                    with m.If(step_idx < len(STEP_MSG)):
                        m.d.comb += [
                            debug.byte_data.eq(step_byte),
                            debug.send_byte.eq(1),
                        ]
                        m.d.sync += step_idx.eq(step_idx + 1)
                    with m.Else():
                        m.d.sync += step_idx.eq(0)
                        m.next = "STEP_DUMP_NIA"

            with m.State("STEP_DUMP_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(step_nia),
                        debug.send.eq(1),
                    ]
                    with m.If(step_had_fault):
                        m.d.sync += fault_msg_idx.eq(0)
                        m.next = "STEP_FAULT_LABEL"
                    with m.Else():
                        m.d.sync += halt_idx.eq(0)
                        m.next = "SEND_HALT"

            with m.State("STEP_FAULT_LABEL"):
                with m.If(~debug.busy):
                    with m.If(fault_msg_idx < len(FAULT_MSG)):
                        m.d.comb += [
                            debug.byte_data.eq(fault_byte),
                            debug.send_byte.eq(1),
                        ]
                        m.d.sync += fault_msg_idx.eq(fault_msg_idx + 1)
                    with m.Else():
                        m.d.sync += fault_msg_idx.eq(0)
                        m.next = "STEP_DUMP_FAULT"

            with m.State("STEP_DUMP_FAULT"):
                with m.If(~debug.busy):
                    fault_word = Signal(32)
                    m.d.comb += [
                        fault_word.eq(Cat(step_fault, C(0, 28))),
                        debug.data.eq(fault_word),
                        debug.send.eq(1),
                    ]
                    m.d.sync += halt_idx.eq(0)
                    m.next = "SEND_HALT"

        m.d.comb += [
            rgb.r.eq(led_fault),
            rgb.g.eq(led_run | led_halted_blink),
            rgb.b.eq(led_boot),
        ]
        m.d.comb += [
            self.led_r.eq(led_fault),
            self.led_g.eq(led_run | led_halted_blink),
            self.led_b.eq(led_boot),
        ]

        return m
