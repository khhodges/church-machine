from amaranth import *
from amaranth.lib.data import View
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .core import ChurchCore
from .boot_rom import (BootRom, FULL_ROM, DEMO_NAMESPACE, DEMO_CLIST,
                        NUC_LUMP_HEADER, SLIDERULE_LUMP_HEADER,
                        SLIDERULE_SLOT, CONSTANTS_SLOT, NS_SLOT_COUNT)
from .uart_tx import DebugPrinter
from .uart_rx import UartRx
from .uart_crc16 import CRC16_CCITT


class ChurchZynqXC7Z010(Elaboratable):
    """Church Machine top-level for QMTECH ZYJZGW Xilinx Zynq XC7Z010 Board.

    Board:  QMTECH ZYJZGW Starter Kit (Xilinx Zynq XC7Z010CLG400-1)
    Clock:  50 MHz oscillator → MMCM → 100 MHz system clock
    UART:   PMOD connector pins (TX/RX, 3.3 V); no on-board USB-UART bridge.
            Connect an external USB-UART adapter.
    LEDs:   4 user LEDs (active-LOW), see zynq_xc7z010.xdc for pin assignments.
    Button: 1 user push button (active-LOW), see zynq_xc7z010.xdc.
    Memory: On-chip Zynq PL BRAM (Yosys infers RAMB36 tiles via init=).
            DDR3 (on PS side) is NOT connected in this release — PL only.

    Only the PL (programmable logic / Artix-7 fabric) is used.
    The Zynq PS (ARM Cortex-A9 cores) is held in reset and not used.

    Differences from Wukong XC7A100T:
      - Same 7-series Artix-7 PL fabric; identical clk_freq = 100 MHz target
      - BOARD_TYPE_ID = 0x05 (Zynq XC7Z010)
      - Pin assignments differ (CLG400 package vs FGG676)
      - Boot banner: "CHURCH Zynq XC7Z010 v1.0"
      - DEVICE_UID encodes "ZynqZ10" signature bytes
    """

    def __init__(self, clk_freq=100_000_000, baud=115200, sim_mode=False, build_sig=None):
        self.clk_freq = clk_freq
        self.baud = baud
        self.sim_mode = sim_mode
        self.build_sig = build_sig or [0x00, 0x00, 0x00, 0x00]

        self.clk_in   = Signal()   # 50 MHz board oscillator input
        self.uart_tx  = Signal(init=1)
        self.uart_rx  = Signal()
        self.push_button = Signal(init=1)  # active-LOW; 1 = released

        self.led = [Signal(name=f"led{i}") for i in range(4)]

        self.dbg_nia          = Signal(32)
        self.dbg_fault        = Signal(4)
        self.dbg_fault_valid  = Signal()
        self.dbg_boot_complete = Signal()

    def elaborate(self, platform):
        m = Module()

        m.domains += ClockDomain("sync", reset_less=True)

        # ── MMCM: 50 MHz clk_in → 1000 MHz VCO → 100 MHz system clock ────────
        # MMCME2_BASE is the Xilinx Series-7 / Zynq-7000 PL MMCM primitive.
        # Settings: CLKFBOUT_MULT_F=20 → VCO=1000 MHz; CLKOUT0_DIVIDE_F=10
        #           → CLKOUT0=100 MHz.  BUFG buffers the output onto a global
        #           clock network and drives the "sync" clock domain.
        # Vivado uses this instantiation to apply MMCM constraints automatically;
        # Yosys leaves it as a black-box stub for simulation or nextpnr flows.
        clk_fb     = Signal()
        clk_100mhz = Signal()
        m.submodules.mmcm = Instance(
            "MMCME2_BASE",
            p_CLKFBOUT_MULT_F=20.0,     # VCO = 50 MHz × 20 = 1000 MHz
            p_CLKIN1_PERIOD=20.0,       # 50 MHz → 20 ns period
            p_CLKOUT0_DIVIDE_F=10.0,    # 1000 MHz ÷ 10 = 100 MHz
            p_CLKOUT0_DUTY_CYCLE=0.5,
            p_CLKOUT0_PHASE=0.0,
            p_DIVCLK_DIVIDE=1,
            p_BANDWIDTH="OPTIMIZED",
            p_STARTUP_WAIT="FALSE",
            i_CLKIN1=self.clk_in,
            i_CLKFBIN=clk_fb,
            i_PWRDWN=Const(0),
            i_RST=Const(0),
            o_CLKFBOUT=clk_fb,
            o_CLKOUT0=clk_100mhz,
        )
        m.submodules.bufg = Instance(
            "BUFG",
            i_I=clk_100mhz,
            o_O=ClockSignal("sync"),
        )

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(FULL_ROM)
        m.submodules.boot_rom = boot_rom

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug

        uart_rx_mod = UartRx(self.clk_freq, self.baud)
        m.submodules.uart_rx_mod = uart_rx_mod
        m.d.comb += uart_rx_mod.rx.eq(self.uart_rx)
        rx_valid = uart_rx_mod.valid
        rx_data  = uart_rx_mod.data

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(boot_rom.data),
        ]

        # ── Data memory init (mirrors Wukong layout) ──────────────────────────
        ns_init = []
        for i in range(0, len(DEMO_NAMESPACE), 3):
            if i + 2 < len(DEMO_NAMESPACE):
                ns_init.extend([DEMO_NAMESPACE[i], DEMO_NAMESPACE[i+1], DEMO_NAMESPACE[i+2]])
        while len(ns_init) < 255:
            ns_init.append(0)
        ns_init.append(NUC_LUMP_HEADER)

        clist_init = list(DEMO_CLIST[:64])
        while len(clist_init) < 64:
            clist_init.append(0)

        dmem_init = ns_init + clist_init
        while len(dmem_init) < 2048:
            dmem_init.append(0)

        dmem_init[511] = SLIDERULE_LUMP_HEADER

        dmem = LibMemory(shape=unsigned(32), depth=2048, init=dmem_init)
        m.submodules.dmem = dmem
        dmem_rd = dmem.read_port(domain="comb")
        dmem_wr = dmem.write_port()

        mem_addr = Signal(11)

        any_ns_access    = Signal()
        any_clist_access = Signal()
        m.d.comb += [
            any_ns_access.eq(core.ns_rd_en | core.ns_wr_en),
            any_clist_access.eq(core.clist_rd_en | core.clist_wr_en),
        ]

        rb_rd_en    = Signal()
        rb_cur_addr = Signal(16)
        with m.If(rb_rd_en):
            m.d.comb += mem_addr.eq(rb_cur_addr[:11])
        with m.Elif(any_ns_access):
            m.d.comb += mem_addr.eq(core.ns_addr[2:13])
        with m.Elif(any_clist_access):
            m.d.comb += mem_addr.eq(core.clist_addr[2:13])
        with m.Else():
            m.d.comb += mem_addr.eq(core.dmem_addr[2:13])

        mem_rd_data = Signal(32)
        m.d.comb += [
            dmem_rd.addr.eq(mem_addr),
            mem_rd_data.eq(dmem_rd.data),
        ]

        # ── MMIO decode ──────────────────────────────────────────────────────
        # Identical register map to Wukong XC7A100T (ARM-convention 0x4xxxxxxx range).
        # Registers (word-addressed via bits[5:2], i.e. reg_sel = addr[2:6]):
        #   0x40000000  [ 0] LED[0]     — bit 0 drives led0 (active-LOW: 1=ON)
        #   0x40000004  [ 1] LED[1]
        #   0x40000008  [ 2] LED[2]
        #   0x4000000C  [ 3] LED[3]
        #   0x40000010  [ 4] LED[4]     — no physical pin on this board (4 LEDs)
        #   0x40000014  [ 5] UART_TX    — 8-bit write-only
        #   0x40000018  [ 6] UART_STATUS— {30'b0, rx_valid, tx_ready}
        #   0x4000001C  [ 7] UART_RX    — 8-bit read-only
        #   0x40000020  [ 8] (reserved)
        #   0x40000024  [ 9] (reserved)
        #   0x40000028  [10] BTN        — 1-bit read-only
        #   0x4000002C  [11] TIMER.TICKS_LO
        #   0x40000030  [12] TIMER.TICKS_HI
        #   0x40000034  [13] TIMER.TOD_EPOCH
        #   0x40000038  [14] TIMER.ALARM_CMP
        #   0x4000003C  [15] TIMER.ALARM_CTL
        is_mmio = Signal()
        m.d.comb += is_mmio.eq(core.dmem_addr[30] & ~core.dmem_addr[31])
        mmio_reg_sel = Signal(4)
        m.d.comb += mmio_reg_sel.eq(core.dmem_addr[2:6])

        mmio_led_reg = [Signal(3, name=f"mmio_led{i}") for i in range(5)]
        mmio_uart_tx_wr   = Signal()
        mmio_uart_tx_data = Signal(8)

        mmio_rx_data  = Signal(8)
        mmio_rx_valid = Signal()
        mmio_rx_read  = Signal()

        timer_lo    = Signal(32)
        timer_hi    = Signal(32)
        tod_epoch   = Signal(32)
        alarm_cmp   = Signal(32)
        alarm_armed = Signal()
        alarm_fired = Signal()

        with m.If(timer_lo == 0xFFFFFFFF):
            m.d.sync += timer_hi.eq(timer_hi + 1)
        m.d.sync += timer_lo.eq(timer_lo + 1)

        with m.If(alarm_armed & ~alarm_fired):
            with m.If(timer_lo == alarm_cmp):
                m.d.sync += alarm_fired.eq(1)

        is_mmio_write = Signal()
        m.d.comb += is_mmio_write.eq(is_mmio & core.dmem_wr_en)

        with m.If(is_mmio_write):
            with m.Switch(mmio_reg_sel):
                for i in range(5):
                    with m.Case(i):
                        m.d.sync += mmio_led_reg[i].eq(core.dmem_wr_data[:3])
                with m.Case(5):
                    m.d.comb += [
                        mmio_uart_tx_wr.eq(1),
                        mmio_uart_tx_data.eq(core.dmem_wr_data[:8]),
                    ]
                with m.Case(13):
                    m.d.sync += tod_epoch.eq(core.dmem_wr_data)
                with m.Case(14):
                    m.d.sync += alarm_cmp.eq(core.dmem_wr_data)
                with m.Case(15):
                    with m.If(core.dmem_wr_data[0]):
                        m.d.sync += alarm_armed.eq(1)
                    with m.If(core.dmem_wr_data[1]):
                        m.d.sync += alarm_fired.eq(0)

        is_mmio_read = Signal()
        m.d.comb += is_mmio_read.eq(is_mmio & core.dmem_rd_en)

        mmio_rd_data = Signal(32)
        with m.Switch(mmio_reg_sel):
            for i in range(5):
                with m.Case(i):
                    m.d.comb += mmio_rd_data.eq(mmio_led_reg[i])
            with m.Case(5):
                m.d.comb += mmio_rd_data.eq(0)
            with m.Case(6):
                m.d.comb += mmio_rd_data.eq(Cat(~debug.busy, mmio_rx_valid, C(0, 30)))
            with m.Case(7):
                m.d.comb += [
                    mmio_rd_data.eq(mmio_rx_data),
                    mmio_rx_read.eq(is_mmio_read),
                ]
            with m.Case(10):
                m.d.comb += mmio_rd_data.eq(Cat(self.push_button, C(0, 31)))
            with m.Case(11):
                m.d.comb += mmio_rd_data.eq(timer_lo)
            with m.Case(12):
                m.d.comb += mmio_rd_data.eq(timer_hi)
            with m.Case(13):
                m.d.comb += mmio_rd_data.eq(tod_epoch)
            with m.Case(14):
                m.d.comb += mmio_rd_data.eq(alarm_cmp)
            with m.Case(15):
                m.d.comb += mmio_rd_data.eq(Cat(alarm_armed, alarm_fired, C(0, 30)))
            with m.Default():
                m.d.comb += mmio_rd_data.eq(0)

        m.d.comb += core.dmem_rd_data.eq(Mux(is_mmio_read, mmio_rd_data, mem_rd_data))
        m.d.comb += [
            core.ns_rd_data.eq(Cat(mem_rd_data, C(0, 64))),
            core.clist_rd_data.eq(mem_rd_data),
        ]

        halted       = Signal(init=1)
        stepping     = Signal()
        fault_latched = Signal()

        # ── PATCH_LUMP protocol registers (0xBEEF opcode, UART) ──────────────
        pl_wr_en       = Signal()
        pl_wr_addr     = Signal(11)
        pl_wr_data     = Signal(32)
        pl_active      = Signal()
        pl_addr        = Signal(16)
        pl_total_count = Signal(16)
        pl_count       = Signal(16)
        pl_word        = Signal(32)
        pl_cur_addr    = Signal(16)
        pl_crc_hi_buf  = Signal(8)
        pl_crc_fail    = Signal()
        pl_ack         = Array([Signal(8, name=f"pl_ack{i}") for i in range(4)])
        pl_ack_idx     = Signal(3)

        crc_mod = CRC16_CCITT()
        m.submodules.crc_mod = crc_mod

        with m.If(rx_valid & ~pl_active):
            m.d.sync += [
                mmio_rx_data.eq(rx_data),
                mmio_rx_valid.eq(1),
            ]
        with m.Elif(mmio_rx_read):
            m.d.sync += mmio_rx_valid.eq(0)

        m.d.comb += [pl_wr_en.eq(0), pl_wr_addr.eq(0), pl_wr_data.eq(0)]

        # ── READ_BRAM protocol registers (0xBEAD opcode, UART) ───────────────
        rb_addr  = Signal(16)
        rb_count = Signal(16)
        rb_word  = Signal(32)

        cpu_wr_data = Signal(32)
        cpu_wr_en   = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.ns_wr_data[:32]), cpu_wr_en.eq(1)]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.clist_wr_data), cpu_wr_en.eq(1)]
        with m.Elif(~is_mmio):
            m.d.comb += [cpu_wr_data.eq(core.dmem_wr_data), cpu_wr_en.eq(core.dmem_wr_en)]

        with m.If(pl_wr_en):
            m.d.comb += [
                dmem_wr.addr.eq(pl_wr_addr),
                dmem_wr.data.eq(pl_wr_data),
                dmem_wr.en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                dmem_wr.addr.eq(mem_addr),
                dmem_wr.data.eq(cpu_wr_data),
                dmem_wr.en.eq(cpu_wr_en),
            ]

        prev_nia = Signal(32)
        m.d.sync += prev_nia.eq(core.nia)
        nia_changed = Signal()
        m.d.comb += nia_changed.eq(core.nia != prev_nia)

        step_complete = Signal()
        m.d.comb += step_complete.eq(stepping & nia_changed)

        m.d.comb += core.imem_valid.eq(~halted | (stepping & ~step_complete))

        # ── Button debounce (active-LOW) ─────────────────────────────────────
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

        BTN_HOLD_TARGET = self.clk_freq
        btn_hold_ctr  = Signal(range(BTN_HOLD_TARGET + 1))
        btn_hold_done = Signal()
        with m.If(~btn_sync[2]):
            with m.If(btn_hold_ctr < BTN_HOLD_TARGET):
                m.d.sync += btn_hold_ctr.eq(btn_hold_ctr + 1)
            with m.Else():
                m.d.sync += btn_hold_done.eq(1)
        with m.Else():
            m.d.sync += [btn_hold_ctr.eq(0), btn_hold_done.eq(0)]

        m.d.comb += [
            core.free_run_start.eq(0),
            core.free_run_nia.eq(0),
        ]

        m.d.comb += self.uart_tx.eq(debug.tx)

        # ── UART TX arbitration ───────────────────────────────────────────────
        mmio_uart_pending  = Signal()
        mmio_uart_byte_reg = Signal(8)
        fsm_send_byte      = Signal()
        fsm_byte_data      = Signal(8)

        with m.If(mmio_uart_tx_wr):
            m.d.sync += [mmio_uart_pending.eq(1),
                         mmio_uart_byte_reg.eq(mmio_uart_tx_data)]

        with m.If(fsm_send_byte):
            m.d.comb += [debug.send_byte.eq(1), debug.byte_data.eq(fsm_byte_data)]
        with m.Elif(mmio_uart_pending & ~debug.busy):
            m.d.comb += [debug.send_byte.eq(1),
                         debug.byte_data.eq(mmio_uart_byte_reg)]
            m.d.sync += mmio_uart_pending.eq(0)

        m.d.comb += [
            self.dbg_nia.eq(core.nia),
            self.dbg_fault.eq(core.fault),
            self.dbg_fault_valid.eq(core.fault_valid),
            self.dbg_boot_complete.eq(core.boot_complete),
        ]

        # ── Heartbeat + fault latch ───────────────────────────────────────────
        heartbeat_ctr   = Signal(range(self.clk_freq))
        heartbeat_blink = Signal()
        m.d.sync += heartbeat_ctr.eq(heartbeat_ctr + 1)
        with m.If(heartbeat_ctr == self.clk_freq - 1):
            m.d.sync += [heartbeat_ctr.eq(0), heartbeat_blink.eq(~heartbeat_blink)]

        m.d.sync += fault_latched.eq(fault_latched | core.fault_valid)

        led_boot         = ~core.boot_complete
        led_run          = core.boot_complete & ~fault_latched & ~halted
        led_halted_blink = halted & ~fault_latched & heartbeat_blink
        led_fault        = fault_latched

        # ── Post-boot LED demo (walking pattern, 0.5 s per LED) ──────────────
        demo_half_sec = self.clk_freq // 2
        demo_ctr   = Signal(range(demo_half_sec))
        demo_phase = Signal(3)
        demo_led   = [Signal(name=f"demo_led{i}") for i in range(4)]

        for i in range(4):
            m.d.comb += demo_led[i].eq(core.boot_complete & halted & (demo_phase == i))

        with m.If(core.boot_complete):
            with m.If(demo_ctr == demo_half_sec - 1):
                m.d.sync += demo_ctr.eq(0)
                with m.If(demo_phase == 4):
                    m.d.sync += demo_phase.eq(0)
                with m.Else():
                    m.d.sync += demo_phase.eq(demo_phase + 1)
            with m.Else():
                m.d.sync += demo_ctr.eq(demo_ctr + 1)

        # Zynq PL LEDs are active-LOW: output 0 to illuminate.
        # led[i] signal = logical 1 means ON → invert when driving pin (done in XDC).
        m.d.comb += [
            self.led[0].eq(Mux(core.boot_complete,
                               mmio_led_reg[0][0] | demo_led[0],
                               led_boot)),
            self.led[1].eq(Mux(core.boot_complete,
                               mmio_led_reg[1][0] | demo_led[1] | led_halted_blink,
                               led_run | led_halted_blink)),
            self.led[2].eq(Mux(core.boot_complete,
                               mmio_led_reg[2][0] | demo_led[2] | fault_latched,
                               led_fault)),
            self.led[3].eq(Mux(core.boot_complete,
                               mmio_led_reg[3][0] | demo_led[3],
                               core.boot_complete)),
        ]

        boot_delay     = Signal(4, init=0)
        boot_triggered = Signal()
        with m.If(~boot_triggered):
            m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.If(boot_delay == 0xF):
                m.d.sync += boot_triggered.eq(1)
                m.d.comb += core.boot_start.eq(1)
        with m.Else():
            m.d.comb += core.boot_start.eq(0)

        m.d.comb += core.gc_start.eq(0)

        BANNER = Array([C(ord(c), 8) for c in "CHURCH Zynq XC7Z010 v1.0\r\n"])
        banner_idx  = Signal(range(len(BANNER) + 1))
        banner_byte = Signal(8)
        m.d.comb += banner_byte.eq(BANNER[banner_idx])

        BOARD_TYPE_ID = 0x05
        FW_MAJOR = 1
        FW_MINOR = 0
        DEVICE_UID = [0x5A, 0x79, 0x6E, 0x71, 0x5A, 0x31, 0x30, 0x01]
        CALLHOME_PKT = Array([C(v, 8) for v in [
            0xCE, 0x11,
            BOARD_TYPE_ID,
            FW_MAJOR, FW_MINOR,
        ] + self.build_sig + DEVICE_UID])
        callhome_idx  = Signal(range(len(CALLHOME_PKT) + 1))
        callhome_byte = Signal(8)
        m.d.comb += callhome_byte.eq(CALLHOME_PKT[callhome_idx])

        HALT_MSG = Array([C(ord(c), 8) for c in "HALT\r\n"])
        halt_idx  = Signal(range(len(HALT_MSG) + 1))
        halt_byte = Signal(8)
        m.d.comb += halt_byte.eq(HALT_MSG[halt_idx])

        STEP_MSG = Array([C(ord(c), 8) for c in "S:"])
        step_idx  = Signal(range(len(STEP_MSG) + 1))
        step_byte = Signal(8)
        m.d.comb += step_byte.eq(STEP_MSG[step_idx])

        FAULT_MSG = Array([C(ord(c), 8) for c in "F:"])
        fault_msg_idx = Signal(range(len(FAULT_MSG) + 1))
        fault_byte    = Signal(8)
        m.d.comb += fault_byte.eq(FAULT_MSG[fault_msg_idx])

        boot_reason      = Signal(8, init=0x00)
        last_fault_code  = Signal(8, init=0x00)
        fault_nia        = Signal(32, init=0x00000000)
        fault_nia_idx    = Signal(range(4))

        step_nia       = Signal(32)
        step_fault     = Signal(4)
        step_had_fault = Signal()

        if self.sim_mode:
            startup_target = 4
        else:
            startup_target = (self.clk_freq * 3) - 1
        startup_ctr = Signal(28)

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
                            fsm_byte_data.eq(banner_byte),
                            fsm_send_byte.eq(1),
                        ]
                        m.d.sync += banner_idx.eq(banner_idx + 1)
                    with m.Else():
                        m.d.sync += callhome_idx.eq(0)
                        m.next = "CALL_HOME"

            with m.State("CALL_HOME"):
                with m.If(~debug.busy):
                    with m.If(callhome_idx < len(CALLHOME_PKT)):
                        m.d.comb += [
                            fsm_byte_data.eq(callhome_byte),
                            fsm_send_byte.eq(1),
                        ]
                        m.d.sync += callhome_idx.eq(callhome_idx + 1)
                    with m.Else():
                        m.next = "CALL_HOME_DYN0"

            with m.State("CALL_HOME_DYN0"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_byte_data.eq(boot_reason),
                        fsm_send_byte.eq(1),
                    ]
                    m.next = "CALL_HOME_DYN1"

            with m.State("CALL_HOME_DYN1"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_byte_data.eq(last_fault_code),
                        fsm_send_byte.eq(1),
                    ]
                    m.d.sync += fault_nia_idx.eq(0)
                    m.next = "CALL_HOME_FNIA"

            with m.State("CALL_HOME_FNIA"):
                with m.If(~debug.busy):
                    with m.Switch(fault_nia_idx):
                        with m.Case(0):
                            m.d.comb += fsm_byte_data.eq(fault_nia[24:32])
                        with m.Case(1):
                            m.d.comb += fsm_byte_data.eq(fault_nia[16:24])
                        with m.Case(2):
                            m.d.comb += fsm_byte_data.eq(fault_nia[8:16])
                        with m.Default():
                            m.d.comb += fsm_byte_data.eq(fault_nia[0:8])
                    m.d.comb += fsm_send_byte.eq(1)
                    with m.If(fault_nia_idx == 3):
                        m.next = "ENTER_FREE_RUN"
                    with m.Else():
                        m.d.sync += fault_nia_idx.eq(fault_nia_idx + 1)

            with m.State("DUMP_NIA"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        debug.data.eq(core.nia),
                        debug.send.eq(1),
                    ]
                    m.next = "SEND_HALT"

            with m.State("SEND_HALT"):
                with m.If(rx_valid & (rx_data == 0xBE)):
                    m.d.sync += [
                        pl_active.eq(1),
                        halt_idx.eq(0),
                    ]
                    m.d.comb += crc_mod.reset.eq(1)
                    m.next = "PL_WAIT_EF"
                with m.Elif(~debug.busy):
                    with m.If(halt_idx < len(HALT_MSG)):
                        m.d.comb += [
                            fsm_byte_data.eq(halt_byte),
                            fsm_send_byte.eq(1),
                        ]
                        m.d.sync += halt_idx.eq(halt_idx + 1)
                    with m.Else():
                        m.d.sync += halt_idx.eq(0)
                        m.next = "HALTED"

            with m.State("HALTED"):
                with m.If(btn_hold_done):
                    m.next = "ENTER_FREE_RUN"
                with m.Elif(rx_valid & (rx_data == 0xBE)):
                    m.d.sync += pl_active.eq(1)
                    m.d.comb += crc_mod.reset.eq(1)
                    m.next = "PL_WAIT_EF"
                with m.Elif(btn_press):
                    m.d.sync += stepping.eq(1)
                    m.next = "STEP_WAIT"

            with m.State("ENTER_FREE_RUN"):
                m.d.comb += [
                    core.free_run_start.eq(1),
                    core.free_run_nia.eq(0),
                ]
                m.d.sync += halted.eq(0)
                m.next = "FREE_RUN"

            with m.State("FREE_RUN"):
                m.d.sync += halted.eq(0)
                with m.If(core.fault_valid):
                    m.d.sync += [
                        last_fault_code.eq(core.fault),
                        boot_reason.eq(0x02),
                        fault_nia.eq(core.nia),
                    ]
                    m.next = "FAULT_HALT"
                with m.Elif(core.halt_valid):
                    m.d.sync += [halted.eq(1), halt_idx.eq(0)]
                    m.next = "USER_HALT"
                with m.Elif(rx_valid & (rx_data == 0xBE)):
                    m.d.sync += [halted.eq(1), pl_active.eq(1)]
                    m.d.comb += crc_mod.reset.eq(1)
                    m.next = "PL_WAIT_EF"
                with m.Elif(btn_press):
                    m.d.sync += halted.eq(1)
                    m.next = "HALTED"

            with m.State("FAULT_HALT"):
                m.d.sync += halted.eq(1)
                with m.If(rx_valid & (rx_data == 0xBE)):
                    m.d.sync += pl_active.eq(1)
                    m.d.comb += crc_mod.reset.eq(1)
                    m.next = "PL_WAIT_EF"
                with m.Elif(btn_press):
                    m.next = "HALTED"

            with m.State("STEP_WAIT"):
                with m.If(step_complete):
                    m.d.sync += [
                        stepping.eq(0),
                        step_nia.eq(core.nia),
                        step_fault.eq(core.fault),
                        step_had_fault.eq(core.fault_valid),
                        step_idx.eq(0),
                    ]
                    with m.If(core.fault_valid):
                        m.d.sync += [
                            last_fault_code.eq(core.fault),
                            boot_reason.eq(0x02),
                            fault_nia.eq(core.nia),
                        ]
                    m.next = "STEP_LABEL"

            with m.State("STEP_LABEL"):
                with m.If(~debug.busy):
                    with m.If(step_idx < len(STEP_MSG)):
                        m.d.comb += [
                            fsm_byte_data.eq(step_byte),
                            fsm_send_byte.eq(1),
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
                            fsm_byte_data.eq(fault_byte),
                            fsm_send_byte.eq(1),
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

            with m.State("USER_HALT"):
                with m.If(~debug.busy):
                    with m.If(halt_idx < len(HALT_MSG)):
                        m.d.comb += [
                            fsm_byte_data.eq(halt_byte),
                            fsm_send_byte.eq(1),
                        ]
                        m.d.sync += halt_idx.eq(halt_idx + 1)
                    with m.Else():
                        m.d.sync += halt_idx.eq(0)
                        m.next = "HALTED"

            # ── PATCH_LUMP protocol (0xBEEF) ─────────────────────────────────
            with m.State("PL_WAIT_EF"):
                with m.If(rx_valid):
                    with m.If(rx_data == 0xEF):
                        m.d.comb += [
                            crc_mod.data_in.eq(0xBE),
                            crc_mod.valid.eq(1),
                        ]
                        m.next = "PL_CRC_FEED_EF"
                    with m.Elif(rx_data == 0xAD):
                        m.next = "RB_RECV_ADDR_HI"
                    with m.Elif(rx_data == 0xAA):
                        m.d.sync += pl_active.eq(0)
                        m.d.comb += [
                            core.free_run_start.eq(1),
                            core.free_run_nia.eq(0),
                        ]
                        m.d.sync += halted.eq(0)
                        m.next = "FREE_RUN"
                    with m.Else():
                        m.d.sync += pl_active.eq(0)
                        m.next = "HALTED"

            with m.State("PL_CRC_FEED_EF"):
                m.d.comb += [
                    crc_mod.data_in.eq(0xEF),
                    crc_mod.valid.eq(1),
                ]
                m.next = "PL_RECV_ADDR_HI"

            with m.State("PL_RECV_ADDR_HI"):
                with m.If(rx_valid):
                    m.d.sync += pl_addr[8:16].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_ADDR_LO"

            with m.State("PL_RECV_ADDR_LO"):
                with m.If(rx_valid):
                    m.d.sync += pl_addr[0:8].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_CNT_HI"

            with m.State("PL_RECV_CNT_HI"):
                with m.If(rx_valid):
                    m.d.sync += [
                        pl_total_count[8:16].eq(rx_data),
                        pl_count[8:16].eq(rx_data),
                    ]
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_CNT_LO"

            with m.State("PL_RECV_CNT_LO"):
                with m.If(rx_valid):
                    m.d.sync += [
                        pl_total_count[0:8].eq(rx_data),
                        pl_count[0:8].eq(rx_data),
                        pl_cur_addr.eq(pl_addr),
                    ]
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_B0"

            with m.State("PL_RECV_B0"):
                with m.If(rx_valid):
                    m.d.sync += pl_word[0:8].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_B1"

            with m.State("PL_RECV_B1"):
                with m.If(rx_valid):
                    m.d.sync += pl_word[8:16].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_B2"

            with m.State("PL_RECV_B2"):
                with m.If(rx_valid):
                    m.d.sync += pl_word[16:24].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_RECV_B3"

            with m.State("PL_RECV_B3"):
                with m.If(rx_valid):
                    m.d.sync += pl_word[24:32].eq(rx_data)
                    m.d.comb += [crc_mod.data_in.eq(rx_data), crc_mod.valid.eq(1)]
                    m.next = "PL_WRITE_WORD"

            with m.State("PL_WRITE_WORD"):
                m.d.comb += [
                    pl_wr_en.eq(1),
                    pl_wr_addr.eq(pl_cur_addr[:11]),
                    pl_wr_data.eq(pl_word),
                ]
                m.d.sync += pl_cur_addr.eq(pl_cur_addr + 1)
                with m.If(pl_count == 1):
                    m.d.sync += pl_count.eq(0)
                    m.next = "PL_RECV_CRC_HI"
                with m.Else():
                    m.d.sync += pl_count.eq(pl_count - 1)
                    m.next = "PL_RECV_B0"

            with m.State("PL_RECV_CRC_HI"):
                with m.If(rx_valid):
                    m.d.sync += [
                        pl_crc_hi_buf.eq(rx_data),
                        pl_crc_fail.eq(rx_data != crc_mod.crc[8:16]),
                    ]
                    m.next = "PL_RECV_CRC_LO"

            with m.State("PL_RECV_CRC_LO"):
                with m.If(rx_valid):
                    with m.If(pl_crc_fail | (rx_data != crc_mod.crc[:8])):
                        m.d.sync += pl_active.eq(0)
                        m.next = "PL_NAK"
                    with m.Else():
                        m.d.sync += [
                            pl_ack[0].eq(pl_addr[8:16]),
                            pl_ack[1].eq(pl_addr[0:8]),
                            pl_ack[2].eq(pl_total_count[8:16]),
                            pl_ack[3].eq(pl_total_count[0:8]),
                            pl_ack_idx.eq(0),
                        ]
                        m.next = "PL_ACK"

            with m.State("PL_NAK"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(0x15),
                    ]
                    m.d.sync += [pl_active.eq(0), halt_idx.eq(0)]
                    m.next = "HALTED"

            with m.State("PL_ACK"):
                with m.If(~debug.busy):
                    with m.If(pl_ack_idx < 4):
                        m.d.comb += [
                            fsm_byte_data.eq(pl_ack[pl_ack_idx]),
                            fsm_send_byte.eq(1),
                        ]
                        m.d.sync += pl_ack_idx.eq(pl_ack_idx + 1)
                    with m.Else():
                        m.d.sync += pl_active.eq(0)
                        m.next = "HALTED"

            # ── READ_BRAM protocol (0xBEAD) ───────────────────────────────────
            with m.State("RB_RECV_ADDR_HI"):
                with m.If(rx_valid):
                    m.d.sync += rb_addr[8:16].eq(rx_data)
                    m.next = "RB_RECV_ADDR_LO"

            with m.State("RB_RECV_ADDR_LO"):
                with m.If(rx_valid):
                    m.d.sync += rb_addr[0:8].eq(rx_data)
                    m.next = "RB_RECV_CNT_HI"

            with m.State("RB_RECV_CNT_HI"):
                with m.If(rx_valid):
                    m.d.sync += rb_count[8:16].eq(rx_data)
                    m.next = "RB_RECV_CNT_LO"

            with m.State("RB_RECV_CNT_LO"):
                with m.If(rx_valid):
                    m.d.sync += [
                        rb_count[0:8].eq(rx_data),
                        rb_cur_addr.eq(rb_addr),
                    ]
                    m.next = "RB_READ"

            with m.State("RB_READ"):
                m.d.comb += rb_rd_en.eq(1)
                m.next = "RB_LATCH"

            with m.State("RB_LATCH"):
                m.d.comb += rb_rd_en.eq(1)
                m.d.sync += rb_word.eq(dmem_rd.data)
                m.next = "RB_SEND_B0"

            with m.State("RB_SEND_B0"):
                with m.If(~debug.busy):
                    m.d.comb += [fsm_byte_data.eq(rb_word[0:8]), fsm_send_byte.eq(1)]
                    m.next = "RB_SEND_B1"

            with m.State("RB_SEND_B1"):
                with m.If(~debug.busy):
                    m.d.comb += [fsm_byte_data.eq(rb_word[8:16]), fsm_send_byte.eq(1)]
                    m.next = "RB_SEND_B2"

            with m.State("RB_SEND_B2"):
                with m.If(~debug.busy):
                    m.d.comb += [fsm_byte_data.eq(rb_word[16:24]), fsm_send_byte.eq(1)]
                    m.next = "RB_SEND_B3"

            with m.State("RB_SEND_B3"):
                with m.If(~debug.busy):
                    m.d.comb += [fsm_byte_data.eq(rb_word[24:32]), fsm_send_byte.eq(1)]
                    m.d.sync += [
                        rb_count.eq(rb_count - 1),
                        rb_cur_addr.eq(rb_cur_addr + 1),
                    ]
                    with m.If(rb_count == 1):
                        m.d.sync += pl_active.eq(0)
                        m.next = "HALTED"
                    with m.Else():
                        m.next = "RB_READ"

        return m
