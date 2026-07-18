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

What you will see:
  Booting  (16-cycle POR + boot_start pulse):
    led[0] solid ON  (G21 LOW = active-LOW ON = booting indicator)
    led[1] 1 Hz heartbeat blink  (clock alive)
  Running  (NUC_PROGRAM MMIO LED demo):
    led[0] blinks at ~1 Hz via MMIO reg 0 writes (CM-controlled, active-LOW inverted)
    led[1] solid ON (no fault) or briefly OFF (fault latched — rare)
"""

from amaranth import *
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .core import ChurchCore
from .boot_rom import (BootRom, FULL_ROM, DEMO_NAMESPACE, DEMO_CLIST,
                       NUC_LUMP_HEADER, NUC_LUMP_BASE, SLIDERULE_LUMP_HEADER, SLIDERULE_SLOT,
                       SELFTEST_NS_SLOT, _make_ns_entry, _abstract_gt_word)


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
        boot_rom = m.submodules.boot_rom = BootRom(FULL_ROM)
        m.d.comb += [
            boot_rom.addr.eq(core.imem_addr[2:12]),
            core.imem_data.eq(boot_rom.data),
        ]

        # ── Data memory (BRAM, 16 384 × 32-bit = 64 KB) ───────────────────────
        # Pre-loaded with the boot namespace table + demo c-list, same as Ti60.
        ns_init = list(DEMO_NAMESPACE)
        while len(ns_init) < 255:
            ns_init.append(0)
        ns_init.append(NUC_LUMP_HEADER)

        clist_init = list(DEMO_CLIST[:64])
        while len(clist_init) < 64:
            clist_init.append(0)

        dmem_init = ns_init + clist_init
        while len(dmem_init) < 16384:
            dmem_init.append(0)

        dmem_init[511] = SLIDERULE_LUMP_HEADER

        # Thread.caps[0] → SelfTest E-GT (slot 6).
        # Encoded as make_gt(Inform, E, slot=6): dom=1, perm3=4, gt_type=1 → 0x4A000006.
        dmem_init[125] = 0x4A000006

        # Fix NS slot 6 (SelfTest) location.
        # DEMO_NAMESPACE generates location = SELFTEST_NS_SLOT * 0x100 = 0x600, which
        # points to a cw=0 lazy stub → BOUNDS fault on first CALL.
        # For Wukong standalone (no IDE/SoC loading lumps at runtime), slot 6 must
        # point to NUC_LUMP_BASE (0x3FC) so CALL reads NUC_LUMP_HEADER (cw=17) at
        # DMEM word 255 and jumps to NUC_PROGRAM[0] at ROM index 256 (byte 0x400).
        _selftest_ns = _make_ns_entry(
            GT_TYPE_INFORM, PERM_MASK_E, SELFTEST_NS_SLOT, 0,
            NUC_LUMP_BASE, 64,
            abstract_gt=_abstract_gt_word(PERM_MASK_E))
        for _w, _val in enumerate(_selftest_ns):
            dmem_init[SELFTEST_NS_SLOT * 4 + _w] = _val

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
            core.ns_rd_data.eq(Cat(dmem_rd.data, C(0, 64))),
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

        # ── Memory write path ──────────────────────────────────────────────────
        cpu_wr_data = Signal(32)
        cpu_wr_en   = Signal()
        with m.If(core.ns_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.ns_wr_data[:32]), cpu_wr_en.eq(1)]
        with m.Elif(core.clist_wr_en):
            m.d.comb += [cpu_wr_data.eq(core.clist_wr_data), cpu_wr_en.eq(1)]
        with m.Elif(~is_mmio):
            m.d.comb += [cpu_wr_data.eq(core.dmem_wr_data), cpu_wr_en.eq(core.dmem_wr_en)]

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

        # ── Boot trigger (16-cycle POR delay then pulse boot_start) ───────────
        boot_delay     = Signal(4, init=0)
        boot_triggered = Signal()
        with m.If(~boot_triggered):
            m.d.sync += boot_delay.eq(boot_delay + 1)
            with m.If(boot_delay == 0xF):
                m.d.sync += boot_triggered.eq(1)
                m.d.comb += core.boot_start.eq(1)
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
