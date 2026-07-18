"""hardware/wukong_top.py — QMTECH Wukong XC7A100T minimal Church Machine top-level
======================================================================================

Minimal top-level for the QMTECH Wukong Board V3 (Artix-7 XC7A100T-2FGG676C).
LED blink only — no Ethernet, no UART bridge.  First-flash "is the board alive?" build.

Pin assignments (xc7a100tfgg676-2 / LVCMOS33 — verified from QMTECH Wukong Board V3 schematic):
  clk    E3   50 MHz oscillator
  rst_n  T2   Active-low push button (Switch 0)  — input only, not yet wired to soft reset
  led[0] J19  User LED D1 (active HIGH)
  led[1] H19  User LED D2 (active HIGH)

What you will see:
  Booting  (~microseconds): led[0] solid ON (booting indicator)
                             led[1] 1 Hz heartbeat blink (clock alive)
  Running  (NUC_PROGRAM):   led[0] blinks at ~1 Hz (boot ROM LED demo, calibrated for 50 MHz)
                             led[1] solid OFF unless a fault fires (lit = fault latched)
"""

from amaranth import *
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .core import ChurchCore
from .boot_rom import (BootRom, FULL_ROM, DEMO_NAMESPACE, DEMO_CLIST,
                       NUC_LUMP_HEADER, SLIDERULE_LUMP_HEADER, SLIDERULE_SLOT)


class ChurchWukongXC7A100T(Elaboratable):
    """Minimal Church Machine top-level for QMTECH Wukong XC7A100T.

    Parameters
    ----------
    clk_freq : int
        Input clock frequency in Hz.  Default 50 000 000 (50 MHz oscillator at E3).
    baud : int
        Unused — kept for interface parity with gen_rtlil.py.
    sim_mode : bool
        Unused — kept for interface parity with gen_rtlil.py.
    build_sig : list[int] | None
        Optional 4-byte build signature (unused in this minimal build).

    Ports
    -----
    clk    in  50 MHz oscillator (E3)
    rst_n  in  Active-low push button (T2)  — reserved, not yet wired
    led    out [2] Physical LED outputs (J19, H19), active HIGH
    """

    def __init__(self, clk_freq=50_000_000, baud=115200, sim_mode=False, build_sig=None):
        self.clk_freq = clk_freq
        self.baud     = baud
        self.sim_mode = sim_mode

        self.clk   = Signal()        # 50 MHz oscillator  (E3)
        self.rst_n = Signal(init=1)  # Active-low button   (T2) — constrained, reserved

        self.led = [Signal(name=f"led{i}") for i in range(2)]

    def elaborate(self, platform):
        m = Module()

        # ── Sync clock domain ──────────────────────────────────────────────────
        # Route the 50 MHz oscillator through a Xilinx BUFG so it lands on a
        # global clock network.  No PLL/MMCM needed at 50 MHz.
        m.domains += ClockDomain("sync")

        m.submodules.bufg = Instance(
            "BUFG",
            i_I=self.clk,
            o_O=ClockSignal("sync"),
        )

        # Synchronous reset: deassert after 16 cycles so BRAM init settles.
        rst_sr = Signal(4, init=0xF)
        m.d.sync += rst_sr.eq(Cat(C(0, 1), rst_sr[:-1]))
        m.d.comb += ResetSignal("sync").eq(rst_sr.any())

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

        # Thread.caps[0] → SelfTest E-GT (slot 6); without this the CM faults
        # immediately on first CALL SelfTest and rapid-boot-loops.
        dmem_init[125] = 0x4A000006
        # SelfTest lazy stub at DMEM byte 0x0600 (word 384); NS slot 6 location
        # points here.  Without this the CM reads 0x00000000 as the lump header,
        # takes a fault, and loops back to boot indefinitely.
        dmem_init[384] = 0xF8000000

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
        #   0  LED0_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[0]  (J19)
        #   1  LED1_RGB   bits[2:0]={B,G,R}; bit 0 = R → led[1]  (H19)
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

        # ── LED output mux ─────────────────────────────────────────────────────
        # DIAG BUILD: raw counter MSBs — no comparison needed, just free-running.
        # At 50 MHz: bit25 toggles at ~0.75 Hz, bit24 at ~1.49 Hz.
        # Both off → clock dead (M21 wrong pin).  Both blinking → clock alive.
        m.d.comb += [
            self.led[0].eq(hb_ctr[25]),
            self.led[1].eq(hb_ctr[24]),
        ]

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

        return m
