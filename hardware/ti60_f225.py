from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .core import ChurchCore
from .boot_rom import BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST
from .uart_tx import DebugPrinter
from .uart_rx import UartRx


class ChurchTi60F225(Elaboratable):
    """Church Machine top-level for Efinix Titanium Ti60 F225 Development Board.

    Differences from Tang Nano 20K:
      - clk_freq = 50 MHz (on-board crystal, pin B8)
      - 4 LEDs, active-HIGH (USER_LED[3:0]; logic 1 = LED on)
      - Push button active-low (USER_PB, with external pull-up)
      - Memory uses plain Amaranth Memory (Yosys infers Efinix EBR tiles)
      - No BSRAM init FSM — Memory init= handles pre-loading directly
      - UART via FTDI FT232H USB-UART bridge at 115200 baud
    """

    def __init__(self, clk_freq=50_000_000, baud=115200, sim_mode=False):
        self.clk_freq = clk_freq
        self.baud = baud
        self.sim_mode = sim_mode

        self.uart_tx = Signal(init=1)
        self.uart_rx = Signal()
        self.push_button = Signal(init=1)

        self.led = [Signal(name=f"led{i}") for i in range(4)]

        self.dbg_nia = Signal(32)
        self.dbg_fault = Signal(4)
        self.dbg_fault_valid = Signal()
        self.dbg_boot_complete = Signal()

    def elaborate(self, platform):
        m = Module()

        m.domains += ClockDomain("sync", reset_less=True)

        core = ChurchCore()
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:11]),
            core.imem_data.eq(boot_rom.data),
        ]

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
        while len(dmem_init) < 2048:
            dmem_init.append(0)

        dmem = Memory(width=32, depth=2048, init=dmem_init)
        m.submodules.dmem = dmem
        dmem_rd = dmem.read_port(transparent=True)
        dmem_wr = dmem.write_port()

        mem_addr = Signal(11)

        any_ns_access = Signal()
        any_clist_access = Signal()
        m.d.comb += [
            any_ns_access.eq(core.ns_rd_en | core.ns_wr_en),
            any_clist_access.eq(core.clist_rd_en | core.clist_wr_en),
        ]

        with m.If(any_ns_access):
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

        # ── MMIO decode ─────────────────────────────────────────────────────
        # MMIO range: address[31:30] == 0b01  →  bit-30 decode (ARM convention)
        # Registers (word-addressed via bits[5:2], i.e. reg_sel = addr[2:7]):
        #   0x40000000  [ 0] LED[0]     — bits[2:0]={B,G,R}; R drives led0 (active-HIGH)
        #   0x40000004  [ 1] LED[1]     — bits[2:0]={B,G,R}; R drives led1
        #   0x40000008  [ 2] LED[2]     — bits[2:0]={B,G,R}; R drives led2
        #   0x4000000C  [ 3] LED[3]     — bits[2:0]={B,G,R}; R drives led3
        #   0x40000010  [ 4] LED[4]     — bits[2:0]={B,G,R}; no physical pin on Ti60
        #   0x40000014  [ 5] UART_TX    — 8-bit write-only  (115200 baud)
        #   0x40000018  [ 6] UART_STATUS— 32-bit read-only  {30'b0, rx_valid, tx_ready}
        #   0x4000001C  [ 7] UART_RX    — 8-bit read-only
        #   0x40000020  [ 8] (reserved)
        #   0x40000024  [ 9] (reserved)
        #   0x40000028  [10] BTN        — 1-bit read-only   (push button)
        #   0x4000002C  [11] TIMER.TICKS_LO  — 32-bit free-running tick, low word
        #   0x40000030  [12] TIMER.TICKS_HI  — 32-bit free-running tick, high word
        #   0x40000034  [13] TIMER.TOD_EPOCH — Unix seconds (R/W, set by boot/IDE)
        #   0x40000038  [14] TIMER.ALARM_CMP — alarm compare vs TICKS_LO (R/W)
        #   0x4000003C  [15] TIMER.ALARM_CTL — [0]=armed [1]=fired; write 1→[1] to clear (R/W)
        is_mmio = Signal()
        m.d.comb += is_mmio.eq(core.dmem_addr[30] & ~core.dmem_addr[31])
        mmio_reg_sel = Signal(4)
        m.d.comb += mmio_reg_sel.eq(core.dmem_addr[2:6])

        # 5 RGB LED registers — bits[2:0]={B,G,R}; only R (bit 0) drives physical pin
        mmio_led_reg = [Signal(3, name=f"mmio_led{i}") for i in range(5)]
        mmio_uart_tx_wr   = Signal()
        mmio_uart_tx_data = Signal(8)

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
                m.d.comb += mmio_rd_data.eq(Cat(~debug.busy, C(0, 31)))
            with m.Case(7):
                m.d.comb += mmio_rd_data.eq(0)
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
        # ── end MMIO decode ──────────────────────────────────────────────────

        m.d.comb += core.dmem_rd_data.eq(Mux(is_mmio_read, mmio_rd_data, mem_rd_data))
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
        with m.Elif(~is_mmio):
            m.d.comb += [wr_data.eq(core.dmem_wr_data), wr_en.eq(core.dmem_wr_en)]

        m.d.comb += [
            dmem_wr.addr.eq(mem_addr),
            dmem_wr.data.eq(wr_data),
            dmem_wr.en.eq(wr_en),
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

        # MMIO UART TX arbitration —————————————————————————————————————————
        # mmio_uart_tx_wr fires for one cycle on DWRITE to 0x40000014.
        # We latch the byte and send it when the debug module is free and the
        # debug FSM is not itself sending a byte (fsm_send_byte tracks that).
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
        # ——————————————————————————————————————————————————————————————————

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

        # Pre-boot:  show hardware status (boot, run, fault, heartbeat).
        # Post-boot: software controls LEDs via DWRITE to LED[0..3] MMIO registers.
        # Each LED word is bits[2:0]={B,G,R}; only bit 0 (R) drives the physical pin.
        # Ti60 has 4 physical LEDs (led0–led3); LED[4] register exists but has no pin.
        m.d.comb += [
            self.led[0].eq(Mux(core.boot_complete, mmio_led_reg[0][0], led_boot)),
            self.led[1].eq(Mux(core.boot_complete, mmio_led_reg[1][0], led_run | led_halted_blink)),
            self.led[2].eq(Mux(core.boot_complete, mmio_led_reg[2][0], led_fault)),
            self.led[3].eq(Mux(core.boot_complete, mmio_led_reg[3][0], core.boot_complete)),
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

        BANNER = Array([C(ord(c), 8) for c in "CHURCH Ti60 v1.0\r\n"])
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
                            fsm_byte_data.eq(halt_byte),
                            fsm_send_byte.eq(1),
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

        return m
