"""hardware/wukong_top.py — QMTECH Wukong XC7A100T minimal Church Machine top-level
======================================================================================

Minimal top-level for the QMTECH Wukong Board V3 (Artix-7 XC7A100T-2FGG676C).
LED blink only — no Ethernet, no UART bridge.

Pin assignments (xc7a100tfgg676-2 / LVCMOS33 — hardware-confirmed on real board):
  clk    M21  50 MHz oscillator (IO_L14P_T2_SRCC_34, bank 34 — confirmed by counter test)
  rst_n  M6   Active-low push button  — constrained but not wired to soft reset
  led[0] G21  User LED D1 (ACTIVE-LOW: FPGA drives LOW → LED ON)
  led[1] G20  User LED D2 (ACTIVE-LOW: FPGA drives LOW → LED ON)

Note: Do NOT use Instance("BUFG") explicitly — Vivado drops it during opt_design for
SRCC pins in this design.  Use a direct comb assignment so Vivado auto-infers IBUF→BUFG.

BRAM initialisation note:
  Vivado does not reliably apply Verilog `initial` blocks to inferred BRAM when the
  Verilog originates from Yosys (the blocks are treated as simulation-only).  To
  guarantee correct DMEM state before the CM boots, a hardware init sequencer writes
  every non-zero DMEM word via the write port in the first ~50 cycles after GSR, then
  pulses boot_start.  The `init=dmem_init` parameter on LibMemory is kept for
  simulation accuracy only.

ROM layout (WUKONG_ROM):
  ROM[0..2]    = BOOT_PROGRAM (3-instruction boot microcode)
  ROM[3..1023] = 0

Boot microcode M-elevation rule:
  During boot (boot_state_reg != BootState.COMPLETE), all LOAD instructions are
  M-elevated in core.py — boot microcode has full privilege.  This means
  BOOT_PROGRAM[0] = `LOAD CR15, CR15[0]` executes correctly: the L-perm gate is
  bypassed unconditionally during the boot phase, regardless of cr_src.  The old
  NUC_PROGRAM workaround (which used cr_src=CR6 to get m_elevated=1) is no longer
  needed.

What you will see:
  Booting  (16-cycle POR + ~50 cycle DMEM init):
    led[0] solid ON  (G21 LOW = active-LOW ON = booting indicator)
    led[1] 1 Hz heartbeat blink  (clock alive)
  Running  (boot entry abstraction via BOOT_PROGRAM + CALL):
    led[0] blinks at ~1 Hz via MMIO reg 0 writes (CM-controlled, active-LOW inverted)
    led[1] solid ON (no fault) or ON (fault latched — rare)
"""

from amaranth import *
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .core import ChurchCore
from .boot_rom import (BootRom, BOOT_PROGRAM, WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST)
from .uart_tx import UartTx
from .uart_rx import UartRx


# ── Wukong ROM: BOOT_PROGRAM at word 0 ────────────────────────────────────────
# BOOT_PROGRAM (3 words):
#   [0] LOAD   AL, CR15, CR15[0] — load NS capability (M-elevated during boot)
#   [1] CHANGE AL, CR12, CR15, #1 — switch to Boot.Thread
#   [2] CALL   AL, CR0, CR0       — enter boot entry abstraction
# [3..1023] = 0
_WUKONG_ROM = list(BOOT_PROGRAM)
while len(_WUKONG_ROM) < 1024:
    _WUKONG_ROM.append(0)


class ChurchWukongXC7A100T(Elaboratable):
    """Minimal Church Machine top-level for QMTECH Wukong XC7A100T.

    Parameters
    ----------
    clk_freq : int
        Input clock frequency in Hz.  Default 50 000 000 (50 MHz oscillator at M21).
    baud : int
        UART baud rate.  Default 57 600 — matches CH340 callhome bridge (CLOCKDIV=53).
    sim_mode : bool
        Unused — kept for interface parity with gen_rtlil.py.
    build_sig : list[int] | None
        Optional 4-byte build signature (unused in this minimal build).

    Ports
    -----
    clk          in  50 MHz oscillator (M21, SRCC bank 34 — hardware confirmed)
    rst_n        in  Active-low push button (M6)  — reserved, not yet wired
    led          out [2] Physical LED outputs (G21, G20), ACTIVE-LOW
    uart_tx_pin  out UART TX (E3, bank 34, LVCMOS33) — idles HIGH; 8N1 at `baud`
    """

    def __init__(self, clk_freq=50_000_000, baud=57_600, sim_mode=False, build_sig=None):
        self.clk_freq = clk_freq
        self.baud     = baud
        self.sim_mode = sim_mode

        self.clk          = Signal()        # 50 MHz oscillator  (M21, SRCC bank 34)
        self.rst_n        = Signal(init=1)  # Active-low button   (M6) — constrained, reserved
        self.uart_tx_pin  = Signal(init=1)  # UART TX (E3) — idles HIGH
        self.uart_rx_pin  = Signal(init=1)  # UART RX (F3) — idles HIGH; step/run/halt/bp cmds

        self.led = [Signal(name=f"led{i}") for i in range(2)]

    def elaborate(self, platform):
        m = Module()

        # ── Sync clock domain ──────────────────────────────────────────────────
        # Direct assignment — Vivado auto-infers IBUF→BUFG for the M21 SRCC pin.
        # Do NOT use Instance("BUFG") explicitly: Vivado's opt_design drops the
        # explicit BUFG for SRCC-sourced clocks, leaving registers without a
        # global clock buffer.  The auto-inferred chain (clk_IBUF_BUFG) is kept.
        #
        # reset_less=True: Artix-7 GSR (Global Set/Reset) fires after bitstream
        # load and initialises all FFs/BRAMs to their init values before user
        # logic starts — no soft POR shift-register needed.  A soft rst_sr in
        # the sync domain that drives ResetSignal("sync") self-deadlocks: under
        # reset the register is reset to its init value (0xF) every cycle,
        # keeping reset asserted permanently → boot_triggered never fires →
        # both LEDs held LOW (active-LOW ON) → 4 solid red forever.
        m.domains += ClockDomain("sync", reset_less=True)
        m.d.comb += ClockSignal("sync").eq(self.clk)

        # ── ChurchCore ─────────────────────────────────────────────────────────
        core = m.submodules.core = ChurchCore()

        # ── Boot ROM (instruction fetch — read-only BRAM tile) ─────────────────
        boot_rom = m.submodules.boot_rom = BootRom(_WUKONG_ROM)
        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(boot_rom.data),
        ]

        # ── Data memory (BRAM, 16 384 × 32-bit = 64 KB) ───────────────────────
        # init= is used for simulation accuracy only.  On real FPGA hardware the
        # hw_init sequencer (below) writes every non-zero word via the write port
        # before boot_start fires.
        #
        # Boot FSM initialises:
        #   CR15.word1_location = 0      (NS at byte 0)
        #   CR6.word1_location  = 0x400  (c-list at byte 0x400 = word 256)
        #
        # WUKONG_NUC_PROGRAM[0] = LOAD CR3, CR6[5]  → LED_DEV into CR3
        #   clist_gt_addr  = 0x400 + 5*4 = 0x414 = word 261 = WUKONG_DEMO_CLIST[5] ✓
        #   ns_gate checks NS slot 3 at byte 0 + 3*16 = 48 = word 12 ✓
        # WUKONG_NUC_PROGRAM[1] = LOAD CR4, CR6[6]  → UART_DEV into CR4
        #   clist_gt_addr  = 0x400 + 6*4 = 0x418 = word 262 = WUKONG_DEMO_CLIST[6] ✓
        #   ns_gate checks NS slot 2 at byte 0 + 2*16 = 32 = word 8 ✓
        # ── DMEM initialisation data ──────────────────────────────────────────
        # Layout:
        #   words   0-31  : WUKONG_DEMO_NAMESPACE (8 NS slots × 4 words)
        #   words  32-255 : zeros
        #   words 256-319 : WUKONG_DEMO_CLIST     (64 c-list entries)
        #                   [5]=LED_DEV, [6]=UART_DEV, [7]=BTN_DEV, [8]=TIMER_DEV
        #                   [9]=0, [10]=0  (SlideRule/Constants absent in 8-slot NS)
        #   words 320+    : zeros
        #
        # WUKONG_DEMO_NAMESPACE vs DEMO_NAMESPACE:
        #   slot 0 location = 0 (Wukong NS at DMEM byte 0, not NS_TABLE_BASE=0x1FC00)
        #   integrity seal on slot 0 recomputed from new location
        #
        # WUKONG_NUC_PROGRAM uses both LED_DEV (c-list[5]) and UART_DEV (c-list[6]).
        dmem_init = list(WUKONG_DEMO_NAMESPACE)    # words 0-31
        while len(dmem_init) < 256:
            dmem_init.append(0)                    # words 32-255 = zero
        dmem_init += list(WUKONG_DEMO_CLIST)       # words 256-319: full c-list
        while len(dmem_init) < 16384:
            dmem_init.append(0)

        hw_init_pairs = [(addr, val)
                         for addr, val in enumerate(dmem_init) if val != 0]

        dmem = m.submodules.dmem = LibMemory(
            shape=unsigned(32), depth=16384, init=dmem_init)
        dmem_rd = dmem.read_port(domain="sync")
        dmem_wr = dmem.write_port()

        # ── Memory address mux ─────────────────────────────────────────────────
        mem_addr = Signal(14)
        with m.If(core.ns_rd_en | core.ns_wr_en):
            m.d.comb += mem_addr.eq(core.ns_addr[2:16])
        with m.Elif(core.clist_rd_en | core.clist_wr_en):
            m.d.comb += mem_addr.eq(core.clist_addr[2:16])
        with m.Else():
            m.d.comb += mem_addr.eq(core.dmem_addr[2:16])

        m.d.comb += [
            dmem_rd.addr.eq(mem_addr),
            core.ns_rd_data.eq(Cat(dmem_rd.data, C(0, 96))),
            core.clist_rd_data.eq(dmem_rd.data),
        ]

        # ── UART TX ────────────────────────────────────────────────────────────
        # UartTx(50 MHz, 57600 baud) — 8N1 active-high idle, matches CH340 bridge.
        # MMIO register 5 write = TX: one-cycle start pulse triggers byte transmit.
        # MMIO register 6 read  = STATUS: bit[0] = tx_busy (poll before next byte).
        # MMIO register 7 read  = RX: always 0 (unused; F3 RX handled by UartRx below).
        uart_tx = m.submodules.uart_tx = UartTx(clk_freq=self.clk_freq, baud=self.baud)
        m.d.comb += self.uart_tx_pin.eq(uart_tx.tx)

        # ── UART RX ────────────────────────────────────────────────────────────
        # Receives step/run/halt/breakpoint commands from wukong_bridge.py.
        # F3 = IO_L5N_T0_34, bank 34, LVCMOS33 — complementary to TX on E3.
        # Two-stage synchroniser is built into UartRx (rx_sync register).
        uart_rx = m.submodules.uart_rx = UartRx(clk_freq=self.clk_freq, baud=self.baud)
        m.d.comb += uart_rx.rx.eq(self.uart_rx_pin)

        # ── Trace TX arbitration signals ───────────────────────────────────────
        # trace_tx_req / trace_tx_byte are driven by the TraceUnit FSM below.
        # CM MMIO reg-5 writes always win over trace bytes.
        trace_tx_req  = Signal()   # TraceUnit wants to send a byte
        trace_tx_byte = Signal(8)  # byte from TraceUnit

        # ── MMIO decode ────────────────────────────────────────────────────────
        # MMIO range: bit[30]=1, bit[31]=0  →  addresses 0x40000000–0x7FFFFFFF
        # Registers (word-addressed, reg = addr[2:6] = bits[5:2]):
        #   0  LED0_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[0]  (G21, ACTIVE-LOW)
        #   1  LED1_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[1]  (G20, ACTIVE-LOW)
        #   2  LED2_RGB   (no physical pin on this minimal build)
        #   5  UART.TX    write: byte[7:0] → start UART TX (8N1, 57600 baud, E3)
        #   6  UART.STATUS read: bit[0]=tx_busy (poll before each TX write)
        #   7  UART.RX    read: 0 (RX not implemented in V2)
        #  11  TIMER.TICKS_LO   32-bit free-running counter, low word
        #  12  TIMER.TICKS_HI   32-bit free-running counter, high word
        #  13  TIMER.TOD_EPOCH  Unix seconds (R/W, set by IDE at boot)
        #  14  TIMER.ALARM_CMP  alarm compare vs TICKS_LO (R/W)
        #  15  TIMER.ALARM_CTL  [0]=arm [1]=fired; write 1→[1] to clear (R/W)
        is_mmio = Signal()
        m.d.comb += is_mmio.eq(core.dmem_addr[30] & ~core.dmem_addr[31])
        mmio_reg_sel = Signal(4)
        m.d.comb += mmio_reg_sel.eq(core.dmem_addr[2:6])

        mmio_led_reg = [Signal(3, name=f"mmio_led{i}") for i in range(3)]

        timer_lo    = Signal(32)
        timer_hi    = Signal(32)
        tod_epoch   = Signal(32)
        alarm_cmp   = Signal(32)
        alarm_armed = Signal()
        alarm_fired = Signal()

        m.d.sync += timer_lo.eq(timer_lo + 1)
        with m.If(timer_lo == 0xFFFFFFFF):
            m.d.sync += timer_hi.eq(timer_hi + 1)
        with m.If(alarm_armed & ~alarm_fired):
            with m.If(timer_lo == alarm_cmp):
                m.d.sync += alarm_fired.eq(1)

        is_mmio_write = Signal()
        m.d.comb += is_mmio_write.eq(is_mmio & core.dmem_wr_en)

        with m.If(is_mmio_write):
            with m.Switch(mmio_reg_sel):
                for i in range(3):
                    with m.Case(i):
                        m.d.sync += mmio_led_reg[i].eq(core.dmem_wr_data[:3])
                with m.Case(13):
                    m.d.sync += tod_epoch.eq(core.dmem_wr_data)
                with m.Case(14):
                    m.d.sync += alarm_cmp.eq(core.dmem_wr_data)
                with m.Case(15):
                    with m.If(core.dmem_wr_data[0]):
                        m.d.sync += alarm_armed.eq(1)
                    with m.If(core.dmem_wr_data[1]):
                        m.d.sync += alarm_fired.eq(0)

        # ── UART TX arbitrator ─────────────────────────────────────────────────
        # CM MMIO reg-5 write = TX byte (one-cycle start pulse).  CM wins; trace
        # bytes from the TraceUnit FSM fill idle TX cycles.
        # cm_tx_start is the raw CM write signal; used by the TraceUnit to avoid
        # colliding with in-flight CM bytes.
        cm_tx_start = Signal()
        m.d.comb += cm_tx_start.eq(is_mmio_write & (mmio_reg_sel == 5))

        trace_tx_ack = Signal()  # TraceUnit byte accepted (one-cycle ack)
        m.d.comb += [
            uart_tx.data.eq(Mux(cm_tx_start, core.dmem_wr_data[0:8], trace_tx_byte)),
            uart_tx.start.eq(cm_tx_start | (trace_tx_req & ~uart_tx.busy & ~cm_tx_start)),
            trace_tx_ack.eq(trace_tx_req & ~uart_tx.busy & ~cm_tx_start),
        ]

        is_mmio_read = Signal()
        m.d.comb += is_mmio_read.eq(is_mmio & core.dmem_rd_en)

        mmio_rd_data = Signal(32)
        with m.Switch(mmio_reg_sel):
            for i in range(3):
                with m.Case(i):
                    m.d.comb += mmio_rd_data.eq(mmio_led_reg[i])
            with m.Case(6):
                # UART STATUS: bit[0] = tx_busy  (poll before each TX write)
                m.d.comb += mmio_rd_data.eq(Cat(uart_tx.busy, C(0, 31)))
            with m.Case(7):
                # UART RX: not implemented in V2; always returns 0
                m.d.comb += mmio_rd_data.eq(0)
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

        m.d.comb += core.dmem_rd_data.eq(Mux(is_mmio_read, mmio_rd_data, dmem_rd.data))

        # ── dmem_rd_valid ──────────────────────────────────────────────────────
        # BRAM read has 1-cycle latency; MMIO reads are combinatorial.
        _dmem_rd_valid_r = Signal()
        m.d.sync += _dmem_rd_valid_r.eq(core.dmem_rd_en & ~is_mmio)
        m.d.comb += core.dmem_rd_valid.eq(_dmem_rd_valid_r | is_mmio_read)

        # ── hw_init sequencer write path ───────────────────────────────────────
        # Writes every non-zero DMEM word (one per cycle) before boot_start.
        # Takes priority over the CPU write path (CPU is idle until boot_complete).
        hw_init_wr_en   = Signal()
        hw_init_wr_addr = Signal(14)
        hw_init_wr_data = Signal(32)

        # ── Memory write path ──────────────────────────────────────────────────
        cpu_wr_data = Signal(32)
        cpu_wr_en   = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.ns_wr_data[:32]), cpu_wr_en.eq(1)]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.clist_wr_data), cpu_wr_en.eq(1)]
        with m.Elif(~is_mmio):
            m.d.comb += [cpu_wr_data.eq(core.dmem_wr_data), cpu_wr_en.eq(core.dmem_wr_en)]

        with m.If(hw_init_wr_en):
            m.d.comb += [
                dmem_wr.addr.eq(hw_init_wr_addr),
                dmem_wr.data.eq(hw_init_wr_data),
                dmem_wr.en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                dmem_wr.addr.eq(mem_addr),
                dmem_wr.data.eq(cpu_wr_data),
                dmem_wr.en.eq(cpu_wr_en),
            ]

        # ── Core control signals ───────────────────────────────────────────────
        fault_latched = Signal()
        m.d.sync += fault_latched.eq(fault_latched | core.fault_valid)

        # step_mode=1 (default): CM halts after each retired instruction and waits
        #   for an 's' command from the IDE before executing the next one.
        # step_mode=0: CM executes freely; 'h' or a breakpoint hit re-enters step mode.
        step_mode   = Signal(init=1)   # 1 = step mode
        step_halted = Signal()          # 1 = CM currently held between instructions
        step_grant  = Signal()          # 1-cycle pulse: step command received

        # ── Breakpoints: 4 NIA slots ──────────────────────────────────────────
        bp_nia   = [Signal(32, init=0xFFFFFFFF, name=f"bp_nia{i}") for i in range(4)]
        bp_armed = [Signal(name=f"bp_armed{i}") for i in range(4)]
        bp_wr_ptr = Signal(2)   # round-robin write pointer for arming slots

        bp_hit = Signal()
        m.d.comb += bp_hit.eq(
            core.retire_valid & (
                (bp_armed[0] & (core.retire_nia == bp_nia[0])) |
                (bp_armed[1] & (core.retire_nia == bp_nia[1])) |
                (bp_armed[2] & (core.retire_nia == bp_nia[2])) |
                (bp_armed[3] & (core.retire_nia == bp_nia[3]))
            )
        )

        # Breakpoint hit → force step_mode + halt; takes highest priority.
        with m.If(bp_hit):
            m.d.sync += [step_mode.eq(1), step_halted.eq(1)]
        with m.Elif(step_grant & step_mode):
            # step_grant clears halt for one retire (re-set on next retire_valid)
            m.d.sync += step_halted.eq(0)
        with m.Elif(core.retire_valid & step_mode & ~step_grant):
            m.d.sync += step_halted.eq(1)
        with m.Elif(~step_mode):
            m.d.sync += step_halted.eq(0)

        m.d.comb += [
            core.imem_valid.eq(~step_halted),
            core.halt_req.eq(step_halted),
            core.free_run_start.eq(0),
            core.free_run_nia.eq(0),
            core.gc_start.eq(0),
        ]

        # ── Command parser FSM ─────────────────────────────────────────────────
        # Reads one-byte commands from the UART RX FIFO:
        #   's' (0x73) — step: release CM for one retire (step_mode stays on)
        #   'r' (0x72) — run:  clear step_mode; CM runs freely
        #   'h' (0x68) — halt: assert step_mode + step_halted immediately
        #   'b' (0x62) — breakpoint: read 4 big-endian NIA bytes, then arm/disarm
        #
        # Breakpoint 'b' + NIA: arms slot bp_wr_ptr with the given NIA.
        # NIA==0xFFFFFFFF disarms the slot.  Pointer wraps 0→1→2→3→0.

        bp_recv_bytes = [Signal(8, name=f"bp_recv_b{i}") for i in range(4)]
        bp_recv_cnt   = Signal(2)

        with m.FSM(name="cmd_parser"):
            with m.State("IDLE"):
                with m.If(uart_rx.valid):
                    with m.Switch(uart_rx.data):
                        with m.Case(0x73):  # 's'
                            # Only grant a step if in step mode AND currently halted.
                            # The combinatorial step_grant feeds the step_halted updater above.
                            m.d.comb += step_grant.eq(step_mode & step_halted)
                        with m.Case(0x72):  # 'r'
                            m.d.sync += [step_mode.eq(0), step_halted.eq(0)]
                        with m.Case(0x68):  # 'h'
                            m.d.sync += [step_mode.eq(1), step_halted.eq(1)]
                        with m.Case(0x62):  # 'b'
                            m.d.sync += bp_recv_cnt.eq(0)
                            m.next = "BP_RECV"

            with m.State("BP_RECV"):
                with m.If(uart_rx.valid):
                    with m.Switch(bp_recv_cnt):
                        for i in range(4):
                            with m.Case(i):
                                m.d.sync += [bp_recv_bytes[i].eq(uart_rx.data),
                                             bp_recv_cnt.eq(i + 1)]
                    with m.If(bp_recv_cnt == 3):
                        m.next = "BP_COMMIT"

            with m.State("BP_COMMIT"):
                # Assemble big-endian NIA: byte[0]=MSB .. byte[3]=LSB
                bp_nia_val = Signal(32)
                m.d.comb += bp_nia_val.eq(
                    Cat(bp_recv_bytes[3], bp_recv_bytes[2],
                        bp_recv_bytes[1], bp_recv_bytes[0])
                )
                with m.Switch(bp_wr_ptr):
                    for slot in range(4):
                        with m.Case(slot):
                            with m.If(bp_nia_val == 0xFFFFFFFF):
                                m.d.sync += bp_armed[slot].eq(0)
                            with m.Else():
                                m.d.sync += [bp_nia[slot].eq(bp_nia_val),
                                             bp_armed[slot].eq(1)]
                m.d.sync += bp_wr_ptr.eq(bp_wr_ptr + 1)
                m.next = "IDLE"

        # ── TraceUnit FSM ──────────────────────────────────────────────────────
        # On every retire_valid pulse (when IDLE), captures an 11-byte packet:
        #   [0]    0xAA   magic
        #   [1..4] NIA    big-endian uint32
        #   [5..8] instr  big-endian uint32
        #   [9]    flags  bits[3:0]=NZCV  bits[7:4]=0
        #   [10]   fault  bits[4:0]=fault_code  bit[6]=fault_valid  bit[7]=bp_hit
        # Packets fill idle UART TX cycles (CM MMIO TX wins via the arbitrator).
        # If the TraceUnit is busy sending a previous packet when a new retire fires,
        # that retire is silently skipped (acceptable in run mode; step mode ensures
        # the TraceUnit is always idle before the next step fires).

        trace_buf = [Signal(8, name=f"tbuf{i}") for i in range(11)]
        trace_idx = Signal(4)

        # bp_hit is combinatorial; latch it at the moment retire_valid fires so
        # the TraceUnit FSM can include it in the fault byte one cycle later.
        bp_hit_lat = Signal()

        with m.FSM(name="trace_unit"):
            with m.State("IDLE"):
                m.d.comb += [trace_tx_req.eq(0), trace_tx_byte.eq(0)]
                with m.If(core.retire_valid):
                    m.d.sync += [
                        trace_buf[0].eq(0xAA),
                        trace_buf[1].eq(core.retire_nia[24:32]),
                        trace_buf[2].eq(core.retire_nia[16:24]),
                        trace_buf[3].eq(core.retire_nia[8:16]),
                        trace_buf[4].eq(core.retire_nia[0:8]),
                        trace_buf[5].eq(core.retire_instr[24:32]),
                        trace_buf[6].eq(core.retire_instr[16:24]),
                        trace_buf[7].eq(core.retire_instr[8:16]),
                        trace_buf[8].eq(core.retire_instr[0:8]),
                        trace_buf[9].eq(Cat(core.retire_flags.as_value()[:4], C(0, 4))),
                        trace_buf[10].eq(Cat(
                            core.retire_fault_code[:5],   # bits[4:0] fault_code
                            C(0, 1),                       # bit[5] reserved
                            core.retire_fault_valid,       # bit[6] fault_valid
                            bp_hit,                        # bit[7] bp_hit
                        )),
                        bp_hit_lat.eq(bp_hit),
                        trace_idx.eq(0),
                    ]
                    m.next = "SEND"

            with m.State("SEND"):
                # Drive trace_tx_req; arbitrator sends trace_tx_byte when TX is free.
                m.d.comb += trace_tx_req.eq(1)
                with m.Switch(trace_idx):
                    for i in range(11):
                        with m.Case(i):
                            m.d.comb += trace_tx_byte.eq(trace_buf[i])
                with m.If(trace_tx_ack):
                    m.d.sync += trace_idx.eq(trace_idx + 1)
                    with m.If(trace_idx == 10):
                        m.next = "IDLE"

        # ── Heartbeat (1 Hz blink on led[1] during boot) ──────────────────────
        hb_ctr   = Signal(range(self.clk_freq))
        hb_blink = Signal()
        m.d.sync += hb_ctr.eq(hb_ctr + 1)
        with m.If(hb_ctr == self.clk_freq - 1):
            m.d.sync += [hb_ctr.eq(0), hb_blink.eq(~hb_blink)]

        # ── Boot sequence: POR delay → hw_init writes → boot_start ────────────
        #
        # Phase 1 (16 cycles): boot_delay counts to 0xF — waits for GSR to
        #   complete and all FFs to settle at their init values.
        #
        # Phase 2 (~N cycles, one per hw_init_pair): hw_init_ctr counts through
        #   hw_init_pairs, writing each non-zero DMEM word via the write port.
        #   This bypasses the Vivado BRAM `initial`-block inference problem.
        #
        # Phase 3 (1 cycle): boot_start pulsed; boot_triggered latched.
        #   The LED mux switches to CM-controlled outputs.
        N_INIT = len(hw_init_pairs)
        boot_delay     = Signal(4, init=0)
        hw_init_ctr    = Signal(range(N_INIT + 1), init=0)
        boot_triggered = Signal()

        with m.If(~boot_triggered):
            # Phase 1: wait for boot_delay to reach 0xF
            with m.If(boot_delay < 0xF):
                m.d.sync += boot_delay.eq(boot_delay + 1)

            # Phase 2: write non-zero DMEM words one per cycle
            with m.Elif(hw_init_ctr < N_INIT):
                m.d.sync += hw_init_ctr.eq(hw_init_ctr + 1)
                m.d.comb += hw_init_wr_en.eq(1)
                with m.Switch(hw_init_ctr):
                    for idx, (addr, val) in enumerate(hw_init_pairs):
                        with m.Case(idx):
                            m.d.comb += [
                                hw_init_wr_addr.eq(addr),
                                hw_init_wr_data.eq(val),
                            ]

            # Phase 3: all writes done — pulse boot_start and latch boot_triggered
            with m.Else():
                m.d.comb += core.boot_start.eq(1)
                m.d.sync += boot_triggered.eq(1)

        with m.Else():
            m.d.comb += core.boot_start.eq(0)

        # ── LED output mux  (ACTIVE-LOW: output 0 = LED ON, output 1 = LED OFF) ──
        # Before boot_triggered: led0 solid ON (booting), led1 heartbeat blink.
        # After  boot_triggered: led0 CM-controlled via MMIO reg 0 (inverted for
        #   active-LOW), led1 solid ON (no fault) or OFF if fault latched.
        with m.If(~boot_triggered):
            m.d.comb += [
                self.led[0].eq(0),           # LOW → LED ON  (booting indicator)
                self.led[1].eq(hb_blink),    # blink: LOW=ON / HIGH=OFF at 1 Hz
            ]
        with m.Else():
            m.d.comb += [
                # CM writes 1-to-light: invert for active-LOW physical LEDs
                self.led[0].eq(~mmio_led_reg[0][0]),
                # fault_latched=0 → ~0=1 → HIGH → LED OFF (normal)
                # fault_latched=1 → ~1=0 → LOW  → LED ON  (fault visible)
                self.led[1].eq(~fault_latched),
            ]

        return m
