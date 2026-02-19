from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .core import ChurchCore
from .boot_rom import BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST
from .uart_tx import DebugPrinter


class ChurchTop(Elaboratable):
    """Top-level FPGA wrapper for the Pure Church Machine.

    Connects the ChurchCore processor to:
    - Boot ROM (instruction memory, 2KB)
    - Data memory (namespace + C-list, 4KB)
    - UART debug output (115200 baud)
    - LED status indicators
    - Boot sequencer with automatic start

    Memory map (data memory, unified 32-bit address space):
      0x0000..0x02FF  Namespace entries (16 entries x 12 bytes = 192 bytes)
      0x0300..0x03FF  C-list (64 x 4 bytes = 256 bytes)
      0x0400..0x0FFF  Reserved / scratch

    Target: iCE40UP5K (iCEBreaker) or Artix-7 (Arty A7).
    Clock: 12 MHz default (iCE40 HFOSC), configurable.
    """

    def __init__(self, clk_freq=12_000_000, baud=115200, sim_mode=False):
        self.clk_freq = clk_freq
        self.baud = baud
        self.sim_mode = sim_mode

        self.uart_tx = Signal(init=1)

        self.led_boot = Signal()
        self.led_run = Signal()
        self.led_fault = Signal()

        self.dbg_nia = Signal(32)
        self.dbg_fault = Signal(4)
        self.dbg_fault_valid = Signal()
        self.dbg_boot_state = Signal(3)
        self.dbg_boot_complete = Signal()

    def elaborate(self, platform):
        m = Module()

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug

        ns_init = []
        for i in range(0, len(DEMO_NAMESPACE), 3):
            if i + 2 < len(DEMO_NAMESPACE):
                ns_init.extend([DEMO_NAMESPACE[i], DEMO_NAMESPACE[i+1], DEMO_NAMESPACE[i+2]])
        while len(ns_init) < 256:
            ns_init.append(0)

        clist_init = list(DEMO_CLIST[:64])
        while len(clist_init) < 64:
            clist_init.append(0)

        dmem_init = ns_init + clist_init
        while len(dmem_init) < 1024:
            dmem_init.append(0)

        dmem = Memory(width=32, depth=1024, init=dmem_init)
        m.submodules.dmem = dmem
        dmem_rd = dmem.read_port(transparent=True)
        dmem_wr = dmem.write_port()

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:11]),
            core.imem_data.eq(boot_rom.data),
            core.imem_valid.eq(1),
        ]

        mem_addr = Signal(10)
        mem_rd_data = Signal(32)

        any_ns_access = Signal()
        any_clist_access = Signal()
        m.d.comb += [
            any_ns_access.eq(core.ns_rd_en | core.ns_wr_en),
            any_clist_access.eq(core.clist_rd_en | core.clist_wr_en),
        ]

        with m.If(any_ns_access):
            m.d.comb += mem_addr.eq(core.ns_addr[2:12])
        with m.Elif(any_clist_access):
            m.d.comb += mem_addr.eq(core.clist_addr[2:12])
        with m.Else():
            m.d.comb += mem_addr.eq(core.dmem_addr[2:12])

        m.d.comb += [
            dmem_rd.addr.eq(mem_addr),
            mem_rd_data.eq(dmem_rd.data),
        ]

        m.d.comb += core.dmem_rd_data.eq(mem_rd_data)

        m.d.comb += [
            core.ns_rd_data.eq(Cat(mem_rd_data, C(0, 64))),
            core.clist_rd_data.eq(mem_rd_data),
        ]

        wr_data = Signal(32)
        wr_en = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [
                wr_data.eq(core.ns_wr_data[:32]),
                wr_en.eq(1),
            ]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [
                wr_data.eq(core.clist_wr_data),
                wr_en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                wr_data.eq(core.dmem_wr_data),
                wr_en.eq(core.dmem_wr_en),
            ]

        m.d.comb += [
            dmem_wr.addr.eq(mem_addr),
            dmem_wr.data.eq(wr_data),
            dmem_wr.en.eq(wr_en),
        ]

        m.d.comb += self.uart_tx.eq(debug.tx)

        m.d.comb += [
            self.dbg_nia.eq(core.nia),
            self.dbg_fault.eq(core.fault),
            self.dbg_fault_valid.eq(core.fault_valid),
            self.dbg_boot_state.eq(core.boot_state),
            self.dbg_boot_complete.eq(core.boot_complete),
        ]

        m.d.comb += [
            self.led_boot.eq(~core.boot_complete),
            self.led_run.eq(core.boot_complete & ~core.fault_valid),
            self.led_fault.eq(core.fault_valid),
        ]

        boot_delay = Signal(4, init=0)
        boot_triggered = Signal()

        with m.If(~boot_triggered):
            m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.If(boot_delay == 0xF):
                m.d.sync += boot_triggered.eq(1)
                m.d.comb += core.boot_start.eq(1)
        with m.Else():
            m.d.comb += core.boot_start.eq(0)

        m.d.comb += core.gc_start.eq(0)

        BANNER = [ord(c) for c in "CHURCH MACHINE v1.0\r\n"]
        banner_rom = Memory(width=8, depth=len(BANNER), init=BANNER)
        m.submodules.banner_rom = banner_rom
        banner_rd = banner_rom.read_port(transparent=True)

        banner_idx = Signal(range(len(BANNER) + 1))
        dump_phase = Signal(4)

        prev_boot_complete = Signal()
        m.d.sync += prev_boot_complete.eq(core.boot_complete)
        boot_just_done = Signal()
        m.d.comb += boot_just_done.eq(core.boot_complete & ~prev_boot_complete)

        prev_fault_valid = Signal()
        m.d.sync += prev_fault_valid.eq(core.fault_valid)
        fault_just_fired = Signal()
        m.d.comb += fault_just_fired.eq(core.fault_valid & ~prev_fault_valid)

        with m.FSM(name="debug_fsm"):
            with m.State("WAIT_BOOT"):
                with m.If(boot_just_done):
                    m.d.sync += banner_idx.eq(0)
                    m.next = "SEND_BANNER"

            with m.State("SEND_BANNER"):
                m.d.comb += banner_rd.addr.eq(banner_idx)
                with m.If(~debug.busy):
                    with m.If(banner_idx < len(BANNER)):
                        m.d.comb += [
                            debug.byte_data.eq(banner_rd.data),
                            debug.send_byte.eq(1),
                        ]
                        m.d.sync += banner_idx.eq(banner_idx + 1)
                    with m.Else():
                        m.d.sync += dump_phase.eq(0)
                        m.next = "DUMP_NIA"

            with m.State("DUMP_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(core.nia),
                        debug.send.eq(1),
                    ]
                    m.next = "RUNNING"

            with m.State("RUNNING"):
                with m.If(fault_just_fired):
                    m.next = "DUMP_FAULT"

            with m.State("DUMP_FAULT"):
                with m.If(~debug.busy):
                    fault_word = Signal(32)
                    m.d.comb += [
                        fault_word.eq(Cat(core.fault, C(0, 28))),
                        debug.data.eq(fault_word),
                        debug.send.eq(1),
                    ]
                    m.next = "DUMP_FAULT_NIA"

            with m.State("DUMP_FAULT_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(core.nia),
                        debug.send.eq(1),
                    ]
                    m.next = "HALTED"

            with m.State("HALTED"):
                pass

        return m
