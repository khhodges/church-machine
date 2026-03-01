from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .core import ChurchCore
from .boot_rom import BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST
from .uart_tx import DebugPrinter


class ICE40SPRAM(Elaboratable):
    """iCE40UP5K SPRAM wrapper — two SB_SPRAM256KA blocks for 32-bit width.

    Each SPRAM block: 16-bit wide x 16384 deep = 256Kbit.
    Two blocks side-by-side give 32-bit x 16384 = 64KB usable.
    Church Machine uses 4KB (1024 words) — fits easily.
    """

    def __init__(self):
        self.addr = Signal(14)
        self.wr_data = Signal(32)
        self.rd_data = Signal(32)
        self.wr_en = Signal()
        self.cs = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        maskwren = Signal(4)
        m.d.comb += maskwren.eq(Mux(self.wr_en, 0b1111, 0b0000))

        maskwren_hi = Signal(4)
        m.d.comb += maskwren_hi.eq(Mux(self.wr_en, 0b1111, 0b0000))

        m.submodules.spram_lo = Instance("SB_SPRAM256KA",
            i_ADDRESS=self.addr,
            i_DATAIN=self.wr_data[:16],
            i_MASKWREN=maskwren,
            i_WREN=self.wr_en,
            i_CHIPSELECT=self.cs,
            i_CLOCK=ClockSignal(),
            i_STANDBY=Const(0),
            i_SLEEP=Const(0),
            i_POWEROFF=Const(1),
            o_DATAOUT=self.rd_data[:16],
        )

        m.submodules.spram_hi = Instance("SB_SPRAM256KA",
            i_ADDRESS=self.addr,
            i_DATAIN=self.wr_data[16:32],
            i_MASKWREN=maskwren_hi,
            i_WREN=self.wr_en,
            i_CHIPSELECT=self.cs,
            i_CLOCK=ClockSignal(),
            i_STANDBY=Const(0),
            i_SLEEP=Const(0),
            i_POWEROFF=Const(1),
            o_DATAOUT=self.rd_data[16:32],
        )

        return m


class ICE40RGBLED(Elaboratable):
    """iCE40UP5K RGB LED driver using SB_RGBA_DRV primitive.

    The pico-ice RGB LED uses the dedicated LED driver block.
    Active-low: 0 = LED on, 1 = LED off.
    """

    def __init__(self):
        self.r = Signal()
        self.g = Signal()
        self.b = Signal()

    def elaborate(self, platform):
        m = Module()

        m.submodules.rgb_drv = Instance("SB_RGBA_DRV",
            p_CURRENT_MODE="0b1",
            p_RGB0_CURRENT="0b000001",
            p_RGB1_CURRENT="0b000001",
            p_RGB2_CURRENT="0b000001",
            i_CURREN=Const(1),
            i_RGBLEDEN=Const(1),
            i_RGB0PWM=self.g,
            i_RGB1PWM=self.b,
            i_RGB2PWM=self.r,
            o_RGB0=Signal(name="led_g_pin"),
            o_RGB1=Signal(name="led_b_pin"),
            o_RGB2=Signal(name="led_r_pin"),
        )

        return m


class ChurchPicoIce(Elaboratable):
    """Pico-ice top-level wrapper for the Pure Church Machine.

    Adapts ChurchTop for the pico-ice board (iCE40UP5K + RP2040):
    - Clock from RP2040 via pin 35 (default 12 MHz)
    - UART TX on pin 25 -> RP2040 -> USB serial
    - UART RX on pin 27 <- RP2040 <- USB serial (future use)
    - RGB LED via SB_RGBA_DRV (boot=blue, run=green, fault=red)
    - Push button on pin 10 (active-low, active-low)
    - Boot ROM in EBR (2KB, 512 x 32-bit)
    - Data RAM in SPRAM (two SB_SPRAM256KA blocks, 32-bit x 16K)
    - Namespace + C-list preloaded into SPRAM during boot

    Memory map (SPRAM, 32-bit address space):
      0x0000..0x00BF  Namespace (16 entries x 12 bytes)
      0x00C0..0x00FF  C-list (64 x 4 bytes)
      0x0100..0x3FFF  Available (63.75KB)
    """

    def __init__(self, clk_freq=12_000_000, baud=115200, sim_mode=False):
        self.clk_freq = clk_freq
        self.baud = baud
        self.sim_mode = sim_mode

        self.uart_tx = Signal(init=1)
        self.uart_rx = Signal()
        self.push_button = Signal(init=1)

        self.led_r = Signal()
        self.led_g = Signal()
        self.led_b = Signal()

        self.dbg_nia = Signal(32)
        self.dbg_fault = Signal(4)
        self.dbg_fault_valid = Signal()
        self.dbg_boot_complete = Signal()

    def elaborate(self, platform):
        m = Module()

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug

        if not self.sim_mode:
            rgb = ICE40RGBLED()
            m.submodules.rgb = rgb

        if self.sim_mode:
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
                m.d.comb += [wr_data.eq(core.ns_wr_data[:32]), wr_en.eq(1)]
            with m.Elif(core.clist_wr_en):
                m.d.comb += [wr_data.eq(core.clist_wr_data), wr_en.eq(1)]
            with m.Else():
                m.d.comb += [wr_data.eq(core.dmem_wr_data), wr_en.eq(core.dmem_wr_en)]

            m.d.comb += [
                dmem_wr.addr.eq(mem_addr),
                dmem_wr.data.eq(wr_data),
                dmem_wr.en.eq(wr_en),
            ]
        else:
            spram = ICE40SPRAM()
            m.submodules.spram = spram

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

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:11]),
            core.imem_data.eq(boot_rom.data),
        ]

        halted = Signal(init=1)
        stepping = Signal()

        prev_nia = Signal(32)
        m.d.sync += prev_nia.eq(core.nia)
        nia_changed = Signal()
        m.d.comb += nia_changed.eq(core.nia != prev_nia)

        step_complete = Signal()
        m.d.comb += step_complete.eq(stepping & nia_changed)

        m.d.comb += core.imem_valid.eq(~halted | (stepping & ~step_complete))

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

        m.d.comb += self.uart_tx.eq(debug.tx)

        m.d.comb += [
            self.dbg_nia.eq(core.nia),
            self.dbg_fault.eq(core.fault),
            self.dbg_fault_valid.eq(core.fault_valid),
            self.dbg_boot_complete.eq(core.boot_complete),
        ]

        heartbeat_ctr = Signal(range(self.clk_freq))
        heartbeat_blink = Signal()
        m.d.sync += heartbeat_ctr.eq(heartbeat_ctr + 1)
        with m.If(heartbeat_ctr == self.clk_freq - 1):
            m.d.sync += [heartbeat_ctr.eq(0), heartbeat_blink.eq(~heartbeat_blink)]

        led_boot = ~core.boot_complete
        led_run = core.boot_complete & ~core.fault_valid & ~halted
        led_halted_blink = core.boot_complete & halted & ~core.fault_valid & heartbeat_blink
        led_fault = core.fault_valid

        m.d.comb += [
            self.led_b.eq(led_boot),
            self.led_g.eq(led_run | led_halted_blink),
            self.led_r.eq(led_fault),
        ]

        if not self.sim_mode:
            m.d.comb += [
                rgb.r.eq(led_fault),
                rgb.g.eq(led_run | led_halted_blink),
                rgb.b.eq(led_boot),
            ]

        if not self.sim_mode:
            boot_gate = Signal()
            m.d.comb += boot_gate.eq(init_done)
        else:
            boot_gate = Const(1)

        boot_delay = Signal(4, init=0)
        boot_triggered = Signal()

        with m.If(~boot_triggered & boot_gate):
            m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.If(boot_delay == 0xF):
                m.d.sync += boot_triggered.eq(1)
                m.d.comb += core.boot_start.eq(1)
        with m.Else():
            m.d.comb += core.boot_start.eq(0)

        m.d.comb += core.gc_start.eq(0)

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

        if self.sim_mode:
            startup_target = 4
        else:
            startup_target = (self.clk_freq * 3) - 1
        startup_ctr = Signal(26)

        with m.FSM(name="debug_fsm"):
            with m.State("STARTUP_DELAY"):
                m.d.sync += startup_ctr.eq(startup_ctr + 1)
                with m.If(startup_ctr == startup_target):
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

        return m
