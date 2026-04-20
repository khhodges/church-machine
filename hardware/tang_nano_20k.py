from amaranth import *
from amaranth.lib.data import View
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT
from .core import ChurchCore
from .boot_rom import (BootRom, BOOT_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST,
                        NUC_LUMP_HEADER, SLIDERULE_LUMP_HEADER)
from .uart_tx import DebugPrinter, UartTx
from .uart_rx import UartRx
from .crc16 import CRC16_CCITT


class GowinBSRAM(Elaboratable):
    def __init__(self, depth=2048):
        self.depth = depth
        self.addr = Signal(range(depth))
        self.wr_data = Signal(32)
        self.rd_data = Signal(32)
        self.wr_en = Signal()
        self.cs = Signal(init=1)

    def elaborate(self, platform):
        m = Module()

        mem = LibMemory(shape=unsigned(32), depth=self.depth, init=[0] * self.depth)
        m.submodules.mem = mem
        rd_port = mem.read_port(domain="comb")
        wr_port = mem.write_port()

        m.d.comb += [
            rd_port.addr.eq(self.addr),
            self.rd_data.eq(rd_port.data),
            wr_port.addr.eq(self.addr),
            wr_port.data.eq(self.wr_data),
            wr_port.en.eq(self.wr_en & self.cs),
        ]

        return m


class ChurchTangNano20K(Elaboratable):
    def __init__(self, clk_freq=27_000_000, baud=115200, sim_mode=False,
                 iot_profile=False, build_sig=None, test_mode=False):
        self.clk_freq = clk_freq
        self.baud = baud
        self.sim_mode = sim_mode
        self.iot_profile = iot_profile
        self.test_mode = test_mode
        self.build_sig = build_sig or [0x00, 0x00, 0x00, 0x00]

        self.uart_tx = Signal(init=1)
        self.uart_rx = Signal()
        self.push_button = Signal(init=1)

        self.led = [Signal(name=f"led{i}") for i in range(4)]

        self.dbg_nia = Signal(32)
        self.dbg_fault = Signal(4)
        self.dbg_fault_valid = Signal()
        self.dbg_boot_complete = Signal()

        # Debug signals: expose core write buses so tests can observe writes
        # without accessing internal submodule signals.
        self.dbg_ns_wr_en      = Signal()
        self.dbg_ns_wr_addr    = Signal(32)
        self.dbg_ns_wr_data    = Signal(32)
        self.dbg_clist_wr_en   = Signal()
        self.dbg_clist_wr_addr = Signal(32)
        self.dbg_clist_wr_data = Signal(32)
        self.dbg_outform_busy  = Signal()

        # Test injection: available when test_mode=True and iot_profile=True.
        # Pulse test_outform_start for one cycle to fire the outform FSM.
        if test_mode and iot_profile:
            self.test_outform_start      = Signal()
            self.test_outform_slot_id    = Signal(16)
            self.test_outform_clist_addr = Signal(32)
            self.test_outform_gt_raw     = Signal(32)

    def elaborate(self, platform):
        m = Module()

        m.domains += ClockDomain("sync", reset_less=True)

        core = ChurchCore(iot_profile=self.iot_profile)
        m.submodules.core = core

        boot_rom = BootRom(BOOT_PROGRAM)
        m.submodules.boot_rom = boot_rom

        debug = DebugPrinter(self.clk_freq, self.baud)
        m.submodules.debug = debug

        uart_rx = UartRx(self.clk_freq, self.baud)
        m.submodules.uart_rx = uart_rx
        m.d.comb += uart_rx.rx.eq(self.uart_rx)

        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(boot_rom.data),
        ]

        # ── MMIO decode (shared across BRAM and GowinBSRAM paths) ────────────
        # MMIO range: address[31:30] == 0b01  →  bit-30 decode
        # Active-LOW LEDs: DWRITE writes 1 = LED ON → invert before driving pin
        # Registers (bits[5:2] = word index):
        #   0x40000000  [ 0] LED[0]     — bits[2:0]={B,G,R}; R drives led0 pin15
        #   0x40000004  [ 1] LED[1]     — bits[2:0]={B,G,R}; R drives led1 pin16
        #   0x40000008  [ 2] LED[2]     — bits[2:0]={B,G,R}; R drives led2 pin19
        #   0x4000000C  [ 3] LED[3]     — bits[2:0]={B,G,R}; R drives led3 pin20
        #   0x40000014  [ 5] UART_TX    — 8-bit write-only
        #   0x40000018  [ 6] UART_STATUS— 32-bit read-only {30'b0, rx_valid, tx_ready}
        #   0x4000001C  [ 7] UART_RX    — 8-bit read-only
        #   0x40000020  [ 8] (reserved)
        #   0x40000024  [ 9] (reserved)
        #   0x40000028  [10] BTN        — 1-bit read-only
        #   0x4000002C  [11] TIMER.TICKS_LO  — 32-bit free-running tick, low word
        #   0x40000030  [12] TIMER.TICKS_HI  — 32-bit free-running tick, high word
        #   0x40000034  [13] TIMER.TOD_EPOCH — Unix seconds (R/W, set by boot/IDE)
        #   0x40000038  [14] TIMER.ALARM_CMP — alarm compare vs TICKS_LO (R/W)
        #   0x4000003C  [15] TIMER.ALARM_CTL — [0]=armed [1]=fired; write 1→[1] to clear (R/W)
        is_mmio = Signal()
        m.d.comb += is_mmio.eq(core.dmem_addr[30] & ~core.dmem_addr[31])
        mmio_reg_sel = Signal(4)
        m.d.comb += mmio_reg_sel.eq(core.dmem_addr[2:6])

        mmio_led_reg = [Signal(3, name=f"mmio_led{i}") for i in range(4)]
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
        is_mmio_read  = Signal()
        m.d.comb += [
            is_mmio_write.eq(is_mmio & core.dmem_wr_en),
            is_mmio_read.eq(is_mmio & core.dmem_rd_en),
        ]

        with m.If(is_mmio_write):
            with m.Switch(mmio_reg_sel):
                for i in range(4):
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

        mmio_rd_data = Signal(32)
        with m.Switch(mmio_reg_sel):
            for i in range(4):
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
        # ── end MMIO decode ──────────────────────────────────────────────────

        patch_active = Signal()
        patch_bsram_addr = Signal(11)
        patch_bsram_data = Signal(32)
        patch_bsram_wr = Signal()

        crc_mod = CRC16_CCITT()
        m.submodules.crc_mod = crc_mod
        patch_crc_fail = Signal()

        with m.If(uart_rx.valid & ~patch_active):
            m.d.sync += [
                mmio_rx_data.eq(uart_rx.data),
                mmio_rx_valid.eq(1),
            ]
        with m.Elif(mmio_rx_read):
            m.d.sync += mmio_rx_valid.eq(0)

        if self.sim_mode:
            ns_init = []
            for i in range(0, len(DEMO_NAMESPACE), 3):
                if i + 2 < len(DEMO_NAMESPACE):
                    ns_init.extend([DEMO_NAMESPACE[i], DEMO_NAMESPACE[i+1], DEMO_NAMESPACE[i+2]])
            # Pad to 255 words, then place NUC_PROGRAM lump header at DMEM word 255 (byte 0x3FC).
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

            # Use LibMemory with domain='comb' for true async reads that
            # match the FPGA GowinBSRAM async-read behaviour and let the
            # Mint FSM read valid data in the same cycle it sets the address.
            dmem = LibMemory(shape=unsigned(32), depth=2048, init=dmem_init)
            m.submodules.dmem = dmem
            dmem_rd = dmem.read_port(domain="comb")
            dmem_wr = dmem.write_port()

            mem_addr = Signal(11)
            mem_rd_data = Signal(32)

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

            m.d.comb += [
                dmem_rd.addr.eq(mem_addr),
                mem_rd_data.eq(dmem_rd.data),
            ]

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
        else:
            bsram = GowinBSRAM(depth=2048)
            m.submodules.bsram = bsram

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

            with m.If(patch_active):
                m.d.comb += bsram.addr.eq(patch_bsram_addr)
            with m.Else():
                m.d.comb += bsram.addr.eq(mem_addr)

            m.d.comb += core.dmem_rd_data.eq(Mux(is_mmio_read, mmio_rd_data, bsram.rd_data))
            m.d.comb += [
                core.ns_rd_data.eq(Cat(bsram.rd_data, C(0, 64))),
                core.clist_rd_data.eq(bsram.rd_data),
            ]

            wr_data = Signal(32)
            wr_en = Signal()
            with m.If(patch_active):
                m.d.comb += [wr_data.eq(patch_bsram_data), wr_en.eq(patch_bsram_wr)]
            with m.Elif(core.ns_wr_en):
                m.d.comb += [wr_data.eq(core.ns_wr_data[:32]), wr_en.eq(1)]
            with m.Elif(core.clist_wr_en):
                m.d.comb += [wr_data.eq(core.clist_wr_data), wr_en.eq(1)]
            with m.Elif(~is_mmio):
                m.d.comb += [wr_data.eq(core.dmem_wr_data), wr_en.eq(core.dmem_wr_en)]

            m.d.comb += [
                bsram.wr_data.eq(wr_data),
                bsram.wr_en.eq(wr_en),
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
                    bsram.addr.eq(init_idx),
                    bsram.wr_data.eq(init_word),
                    bsram.wr_en.eq(1),
                ]
                with m.If(init_idx < init_total):
                    m.d.sync += init_idx.eq(init_idx + 1)
                with m.Else():
                    m.d.sync += init_done.eq(1)

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

        if self.iot_profile:
            outform_uart = UartTx(self.clk_freq, self.baud)
            m.submodules.outform_uart = outform_uart

            m.d.comb += [
                outform_uart.data.eq(core.outform_tx_data),
                outform_uart.start.eq(core.outform_tx_valid & ~outform_uart.busy),
                core.outform_tx_ack.eq(outform_uart.done),
                core.outform_rx_valid.eq(Mux(core.outform_busy, uart_rx.valid, 0)),
                core.outform_rx_data.eq(uart_rx.data),
            ]

            # Hold the mux on outform_uart until *both* the outform FSM is
            # done AND the UartTx has finished the current byte.  This
            # prevents a mid-byte mux switch from corrupting the debug UART
            # stream if outform_busy ever de-asserts while outform_uart is
            # still transmitting (e.g. future timing changes or a glitch).
            outform_uart_active = Signal(name="outform_uart_active")
            m.d.comb += outform_uart_active.eq(core.outform_busy | outform_uart.busy)
            with m.If(outform_uart_active):
                m.d.comb += self.uart_tx.eq(outform_uart.tx)
            with m.Else():
                m.d.comb += self.uart_tx.eq(debug.tx)
        else:
            m.d.comb += [
                core.outform_tx_ack.eq(0),
                core.outform_rx_valid.eq(0),
                core.outform_rx_data.eq(0),
                self.uart_tx.eq(debug.tx),
            ]

        # MMIO UART TX arbitration —————————————————————————————————————————
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

        # Pre-boot:  show hardware status display.
        # Post-boot: software controls LEDs via LED[0..3] MMIO registers.
        # Each LED word is bits[2:0]={B,G,R}; only R (bit 0) drives the physical pin.
        # Tang Nano 20K: active-LOW — invert R bit before driving pin.
        # 4 LEDs: pins 15,16,19,20 (pins 17,18 used by UART).
        #   led0 (pin15): boot/run  — ON during boot, then ON when running OK
        #   led1 (pin16): halt      — ON when halted (blinks), OFF when running
        #   led2 (pin19): fault     — ON on capability fault
        #   led3 (pin20): heartbeat — always blinks ~1Hz to show clock alive
        m.d.comb += [
            self.led[0].eq(Mux(core.boot_complete, ~(led_run | led_halted_blink), ~led_boot)),
            self.led[1].eq(Mux(core.boot_complete, ~halted, C(1, 1))),
            self.led[2].eq(Mux(core.boot_complete, ~led_fault, C(1, 1))),
            self.led[3].eq(~heartbeat_blink),
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

        banner_str = "CHURCH TN20K-IoT v1.0\r\n" if self.iot_profile else "CHURCH TN20K v1.0\r\n"
        BANNER = Array([C(ord(c), 8) for c in banner_str])
        banner_idx = Signal(range(len(BANNER) + 1))
        banner_byte = Signal(8)
        m.d.comb += banner_byte.eq(BANNER[banner_idx])

        BOARD_TYPE_ID = 0x01 if self.iot_profile else 0x02
        FW_MAJOR = 1
        FW_MINOR = 0
        DEVICE_UID = [0x54, 0x4E, 0x32, 0x30, 0x4B, 0x00, 0x00, 0x01]
        CALLHOME_PKT = Array([C(v, 8) for v in [
            0xCE, 0x11,
            BOARD_TYPE_ID,
            FW_MAJOR, FW_MINOR,
        ] + self.build_sig + DEVICE_UID])
        callhome_idx = Signal(range(len(CALLHOME_PKT) + 1))
        callhome_byte = Signal(8)
        m.d.comb += callhome_byte.eq(CALLHOME_PKT[callhome_idx])

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

        boot_reason = Signal(8, init=0x00)
        last_fault_code = Signal(8, init=0x00)
        fault_nia = Signal(32, init=0x00000000)
        fault_nia_idx = Signal(range(4))

        step_nia = Signal(32)
        step_fault = Signal(4)
        step_had_fault = Signal()

        patch_addr = Signal(16)
        patch_count = Signal(16)
        patch_idx = Signal(16)
        patch_byte_idx = Signal(2)
        patch_word_acc = Signal(32)
        patch_rx_phase = Signal(4)

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
                        m.next = "DUMP_NIA"
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
                with m.If(uart_rx.valid & (uart_rx.data == 0xBE)):
                    m.d.sync += [
                        patch_rx_phase.eq(0),
                        halt_idx.eq(0),
                    ]
                    m.d.comb += [
                        crc_mod.reset.eq(1),
                    ]
                    m.next = "CMD_MAGIC2"
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
                with m.If(uart_rx.valid & (uart_rx.data == 0xBE)):
                    m.d.sync += patch_rx_phase.eq(0)
                    m.d.comb += [
                        crc_mod.reset.eq(1),
                    ]
                    m.next = "CMD_MAGIC2"
                with m.Elif(btn_press):
                    m.d.sync += stepping.eq(1)
                    m.next = "STEP_WAIT"

            with m.State("CMD_MAGIC2"):
                with m.If(uart_rx.valid):
                    with m.If(uart_rx.data == 0xEF):
                        m.d.comb += [
                            crc_mod.data_in.eq(0xBE),
                            crc_mod.valid.eq(1),
                        ]
                        m.next = "PATCH_CRC_FEED_EF"
                    with m.Elif(uart_rx.data == 0xAA):
                        m.d.sync += halted.eq(0)
                        m.d.comb += [
                            core.free_run_start.eq(1),
                            core.free_run_nia.eq(0),
                        ]
                        m.next = "RUNNING"
                    with m.Else():
                        m.next = "HALTED"

            with m.State("PATCH_CRC_FEED_EF"):
                m.d.comb += [
                    crc_mod.data_in.eq(0xEF),
                    crc_mod.valid.eq(1),
                ]
                m.next = "PATCH_ADDR_HI"

            with m.State("RUNNING"):
                with m.If(core.fault_valid):
                    m.d.sync += [
                        halted.eq(1),
                        step_nia.eq(core.nia),
                        step_fault.eq(core.fault),
                        step_had_fault.eq(1),
                        fault_msg_idx.eq(0),
                        last_fault_code.eq(core.fault),
                        boot_reason.eq(0x02),
                        fault_nia.eq(core.nia),
                    ]
                    m.next = "STEP_FAULT_LABEL"

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

            # ── PATCH_LUMP protocol ────────────────────────────────────
            # Wire protocol (from webserial.js):
            #   TX: [0xBE][0xEF][addrHi][addrLo][countHi][countLo]
            #       [w0_b0][w0_b1][w0_b2][w0_b3]...[wN_b3]
            #       [crcHi][crcLo]
            #   RX echo: [addrHi][addrLo][countHi][countLo]
            # Words are little-endian (LSB first).
            # CRC-16/CCITT-FALSE verified by hardware — reject on mismatch.


            with m.State("PATCH_ADDR_HI"):
                with m.If(uart_rx.valid):
                    m.d.sync += patch_addr[8:16].eq(uart_rx.data)
                    m.d.comb += [crc_mod.data_in.eq(uart_rx.data), crc_mod.valid.eq(1)]
                    m.next = "PATCH_ADDR_LO"

            with m.State("PATCH_ADDR_LO"):
                with m.If(uart_rx.valid):
                    m.d.sync += patch_addr[:8].eq(uart_rx.data)
                    m.d.comb += [crc_mod.data_in.eq(uart_rx.data), crc_mod.valid.eq(1)]
                    m.next = "PATCH_COUNT_HI"

            with m.State("PATCH_COUNT_HI"):
                with m.If(uart_rx.valid):
                    m.d.sync += patch_count[8:16].eq(uart_rx.data)
                    m.d.comb += [crc_mod.data_in.eq(uart_rx.data), crc_mod.valid.eq(1)]
                    m.next = "PATCH_COUNT_LO"

            with m.State("PATCH_COUNT_LO"):
                with m.If(uart_rx.valid):
                    m.d.sync += [
                        patch_count[:8].eq(uart_rx.data),
                        patch_idx.eq(0),
                        patch_byte_idx.eq(0),
                        patch_word_acc.eq(0),
                    ]
                    m.d.sync += patch_active.eq(1)
                    m.d.comb += [crc_mod.data_in.eq(uart_rx.data), crc_mod.valid.eq(1)]
                    m.next = "PATCH_DATA"

            with m.State("PATCH_DATA"):
                with m.If(uart_rx.valid):
                    m.d.comb += [crc_mod.data_in.eq(uart_rx.data), crc_mod.valid.eq(1)]
                    with m.Switch(patch_byte_idx):
                        with m.Case(0):
                            m.d.sync += [
                                patch_word_acc[:8].eq(uart_rx.data),
                                patch_byte_idx.eq(1),
                            ]
                        with m.Case(1):
                            m.d.sync += [
                                patch_word_acc[8:16].eq(uart_rx.data),
                                patch_byte_idx.eq(2),
                            ]
                        with m.Case(2):
                            m.d.sync += [
                                patch_word_acc[16:24].eq(uart_rx.data),
                                patch_byte_idx.eq(3),
                            ]
                        with m.Case(3):
                            m.d.sync += [
                                patch_word_acc[24:32].eq(uart_rx.data),
                                patch_byte_idx.eq(0),
                            ]
                            m.next = "PATCH_WRITE"

            with m.State("PATCH_WRITE"):
                m.d.comb += [
                    patch_bsram_addr.eq(patch_addr + patch_idx),
                    patch_bsram_data.eq(patch_word_acc),
                    patch_bsram_wr.eq(1),
                ]
                m.d.sync += patch_idx.eq(patch_idx + 1)
                with m.If(patch_idx + 1 >= patch_count):
                    m.next = "PATCH_CRC_HI"
                with m.Else():
                    m.next = "PATCH_DATA"

            with m.State("PATCH_CRC_HI"):
                with m.If(uart_rx.valid):
                    m.d.sync += patch_crc_fail.eq(uart_rx.data != crc_mod.crc[8:16])
                    m.next = "PATCH_CRC_LO"

            with m.State("PATCH_CRC_LO"):
                with m.If(uart_rx.valid):
                    with m.If(patch_crc_fail | (uart_rx.data != crc_mod.crc[:8])):
                        m.d.sync += patch_active.eq(0)
                        m.next = "PATCH_NAK"
                    with m.Else():
                        m.d.sync += patch_active.eq(0)
                        m.next = "PATCH_ECHO0"

            with m.State("PATCH_NAK"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(0x15),
                    ]
                    m.d.sync += halt_idx.eq(0)
                    m.next = "SEND_HALT"

            with m.State("PATCH_ECHO0"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(patch_addr[8:16]),
                    ]
                    m.next = "PATCH_ECHO1"

            with m.State("PATCH_ECHO1"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(patch_addr[:8]),
                    ]
                    m.next = "PATCH_ECHO2"

            with m.State("PATCH_ECHO2"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(patch_count[8:16]),
                    ]
                    m.next = "PATCH_ECHO3"

            with m.State("PATCH_ECHO3"):
                with m.If(~debug.busy):
                    m.d.comb += [
                        fsm_send_byte.eq(1),
                        fsm_byte_data.eq(patch_count[:8]),
                    ]
                    m.d.sync += halt_idx.eq(0)
                    m.next = "SEND_HALT"

        # ── Debug signal outputs (always available) ───────────────────────
        m.d.comb += [
            self.dbg_ns_wr_en.eq(core.ns_wr_en),
            self.dbg_ns_wr_addr.eq(core.ns_addr),
            self.dbg_ns_wr_data.eq(core.ns_wr_data[:32]),
            self.dbg_clist_wr_en.eq(core.clist_wr_en),
            self.dbg_clist_wr_addr.eq(core.clist_addr),
            self.dbg_clist_wr_data.eq(core.clist_wr_data),
            self.dbg_outform_busy.eq(core.outform_busy),
        ]

        # ── Test injection (test_mode=True and iot_profile=True only) ─────
        if self.test_mode and self.iot_profile:
            m.d.comb += [
                core.outform_start_in.eq(self.test_outform_start),
                core.outform_slot_id_in.eq(self.test_outform_slot_id),
                core.outform_clist_addr_in.eq(self.test_outform_clist_addr),
                core.outform_gt_raw_in.eq(self.test_outform_gt_raw),
            ]

        return m
