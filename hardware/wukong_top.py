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
  ROM[0..16]   = NUC_PROGRAM (17 words of LED-blink CLOOMC)
  ROM[17..1023] = 0

Why NUC_PROGRAM at offset 0?
  After boot_complete, nia_reg=0 and boot_rom.data=ROM[0].  BOOT_PROGRAM[0] is
  `LOAD CR15, CR15[0]` which ALWAYS faults with PERM_L on standalone hardware:
    - mload_m_elevated is only set when cr_src == CR_CLIST (CR6); here cr_src=15
    - CR15.word0_gt = 0x02000000 has perm[30:28]=0 → has_l_perm=0
    - ~has_l_perm & ~m_elevated → PERM_L fault
  Starting with NUC_PROGRAM[0] = LOAD CR3, CR6[5] (cr_src=6=CR_CLIST) grants
  m_elevated=1, bypassing the PERM_L gate entirely.
  Code bounds are (0,0) = inactive at boot_complete (only set by CALL/CLOAD),
  so any nia in [0, ROM_TOP) executes without fetch_bounds_fault.

What you will see:
  Booting  (16-cycle POR + ~50 cycle DMEM init):
    led[0] solid ON  (G21 LOW = active-LOW ON = booting indicator)
    led[1] 1 Hz heartbeat blink  (clock alive)
  Running  (NUC_PROGRAM MMIO LED demo):
    led[0] blinks at ~1 Hz via MMIO reg 0 writes (CM-controlled, active-LOW inverted)
    led[1] solid ON (no fault) or ON (fault latched — rare)
"""

from amaranth import *
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .core import ChurchCore
from .boot_rom import (BootRom, NUC_PROGRAM, DEMO_NAMESPACE, DEMO_CLIST)


# ── Wukong ROM: NUC_PROGRAM starting at word 0 ────────────────────────────────
# NUC_PROGRAM is the LED-blink CLOOMC sequence (17 words).  Pad to 1024 words.
# BOOT_PROGRAM is deliberately omitted — see module docstring for the PERM_L
# fault root cause.
_WUKONG_ROM = list(NUC_PROGRAM)
while len(_WUKONG_ROM) < 1024:
    _WUKONG_ROM.append(0)


class ChurchWukongXC7A100T(Elaboratable):
    """Minimal Church Machine top-level for QMTECH Wukong XC7A100T.

    Parameters
    ----------
    clk_freq : int
        Input clock frequency in Hz.  Default 50 000 000 (50 MHz oscillator at M21).
    baud : int
        Unused — kept for interface parity with gen_rtlil.py.
    sim_mode : bool
        Unused — kept for interface parity with gen_rtlil.py.
    build_sig : list[int] | None
        Optional 4-byte build signature (unused in this minimal build).

    Ports
    -----
    clk    in  50 MHz oscillator (M21, SRCC bank 34 — hardware confirmed)
    rst_n  in  Active-low push button (M6)  — reserved, not yet wired
    led    out [2] Physical LED outputs (G21, G20), ACTIVE-LOW
    """

    def __init__(self, clk_freq=50_000_000, baud=115200, sim_mode=False, build_sig=None):
        self.clk_freq = clk_freq
        self.baud     = baud
        self.sim_mode = sim_mode

        self.clk   = Signal()        # 50 MHz oscillator  (M21, SRCC bank 34)
        self.rst_n = Signal(init=1)  # Active-low button   (M6) — constrained, reserved

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
        # Layout:
        #   words   0-31  : DEMO_NAMESPACE  (8 NS slots × 4 words)
        #                   NS slot 3 (LED_DEV MMIO) is at words 12-15
        #   words  32-255 : zeros
        #   words 256-319 : DEMO_CLIST      (64 c-list entries)
        #                   c-list slot 5 (LED_DEV GT 0xb2000003) at word 261
        #   words 320+    : zeros
        #
        # Boot FSM initialises:
        #   CR15.word1_location = 0    (NS at byte 0)
        #   CR6.word1_location  = 0x400 (c-list at byte 0x400 = word 256)
        #
        # NUC_PROGRAM[0] = LOAD CR3, CR6[5]:
        #   clist_gt_addr = 0x400 + 5*4 = 0x414 = word 261 = DEMO_CLIST[5] ✓
        #   ns_gate reads NS slot 3 at byte 0 + 3*16 = 48 = word 12 ✓
        #   NS slot 3 integrity verified (0xdead3ecf matches) ✓
        # ── Minimal one-GT c-list ─────────────────────────────────────────────
        # Church Machine least-authority principle: the boot c-list starts with
        # AT MOST ONE capability — the single GT this abstraction actually needs.
        # NUC_PROGRAM only uses LED_DEV (LOAD CR3, CR6[5]).  All other slots
        # (UART_DEV, BTN_DEV, TIMER_DEV, SelfTest, etc.) are null: the program
        # has no authority over devices it does not use.
        _clist_one_gt = [0] * 64
        _clist_one_gt[5] = DEMO_CLIST[5]           # LED_DEV GT — the only one

        dmem_init = list(DEMO_NAMESPACE)           # words 0-31
        while len(dmem_init) < 256:
            dmem_init.append(0)                    # words 32-255 = zero
        dmem_init += _clist_one_gt                 # words 256-319: one GT only
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

        # ── MMIO decode ────────────────────────────────────────────────────────
        # MMIO range: bit[30]=1, bit[31]=0  →  addresses 0x40000000–0x7FFFFFFF
        # Registers (word-addressed, reg = addr[2:6] = bits[5:2]):
        #   0  LED0_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[0]  (G21, ACTIVE-LOW)
        #   1  LED1_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[1]  (G20, ACTIVE-LOW)
        #   2  LED2_RGB   (no physical pin on this minimal build)
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

        is_mmio_read = Signal()
        m.d.comb += is_mmio_read.eq(is_mmio & core.dmem_rd_en)

        mmio_rd_data = Signal(32)
        with m.Switch(mmio_reg_sel):
            for i in range(3):
                with m.Case(i):
                    m.d.comb += mmio_rd_data.eq(mmio_led_reg[i])
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

        halted = Signal()
        m.d.comb += [
            core.imem_valid.eq(~halted),
            core.free_run_start.eq(0),
            core.free_run_nia.eq(0),
            core.gc_start.eq(0),
        ]

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
