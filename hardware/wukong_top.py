"""hardware/wukong_top.py — QMTECH Wukong XC7A100T minimal Church Machine top-level
## ==================================================================================

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
    led[1] OFF (normal / no fault); blinks ON only if fault_latched is set
"""

from amaranth import *
from amaranth.lib.memory import Memory as LibMemory

from .hw_types import *
from .core import ChurchCore
from .boot_rom import (BootRom, BOOT_PROGRAM, WUKONG_NUC_PROGRAM,
                       WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST,
                       WUKONG_WCH_CLIST, WUKONG_WCH_CLIST_WORD,
                       WUKONG_THREAD_BASE_WORD, WUKONG_THREAD_HEADER,
                       WUKONG_THREAD_STO_WORD, WUKONG_THREAD_STO_INIT,
                       WUKONG_THREAD_CAPS0_WORD, WUKONG_THREAD_CAPS12_WORD,
                       wukong_wch_header)
from .uart_tx import UartTx
from .uart_rx import UartRx

# ── Bitstream build version ────────────────────────────────────────────────────
# Baked into the 4th byte of the boot sentinel (0xBC N_INIT TU_VERSION BUILD_VERSION).
# Increment this by 1 every time a new bitstream is synthesised and flashed.
# The bridge reports it to the IDE so the FPGA status page can confirm exactly
# which build is running — no need to reprogram just to check.
WUKONG_BUILD_VERSION = 8   # ← bump this before each new synthesis run

# ── Wukong ROM: 3-instruction BOOT_PROGRAM ────────────────────────────────────
# Architecture doc:             docs/wukong-boot.md
# BOOT_PROGRAM (3 words) — minimal boot microcode that calls into DMEM:
#   [0] LOAD CR15, CR15[0]  → load NS root into CR15  (M-elevated during boot)
#   [1] CHANGE              → load Thread lump; CR6 ← boot c-list at byte 0x400
#   [2] CALL CR0, CR0[0]    → Thread.caps[0] = IDE-configured ⚡ boot entry E-GT
#                              (set by the IDE boot-image upload; WUKONG_DEMO_CLIST[0]
#                               is zeroed in boot_rom.py so standalone power-on
#                               without an IDE upload faults cleanly instead of
#                               silently entering WukongCallHome)
# [3..1023] = 0
#
# WukongCallHome remains in the namespace at slot 7 as a selectable abstraction
# but is no longer the hardwired default CALL target.
# The WukongCallHome LUMP body is placed in dmem_init below at byte 0x0700.
_WUKONG_ROM = list(BOOT_PROGRAM[:3]) + [0] * (1024 - 3)

# ── Synthesis-time LUMP overflow guard ────────────────────────────────────────
# WukongCallHome LUMP alloc = 128 words (n_minus_6=1 → 2^7).
# header (1 word) + code (WUKONG_NUC_PROGRAM) must fit.
assert len(WUKONG_NUC_PROGRAM) <= 127, (
    f"WUKONG_NUC_PROGRAM has grown to {len(WUKONG_NUC_PROGRAM)} instructions; "
    f"header + code = {1 + len(WUKONG_NUC_PROGRAM)} words exceeds 128-word alloc. "
    "Bump n_minus_6 to 2 (alloc=256) and update WUKONG_DEMO_NAMESPACE slot 7 lim17."
)


class ChurchWukongXC7A100T(Elaboratable):
    """Minimal Church Machine top-level for QMTECH Wukong XC7A100T.

    Parameters
    ----------
    clk_freq : int
        Input clock frequency in Hz.  Default 50 000 000 (50 MHz oscillator at M21).
    baud : int
        UART baud rate.  Default 57 600 — matches CH340 callhome bridge.
        UartTx computes divisor = clk_freq // baud = 50_000_000 // 57_600 = 868 (0.006% error).
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

        # ── ILA / debug observation ports ─────────────────────────────────────
        # These are top-level output ports (no physical pin — ILA probes them
        # internally over JTAG).  The Vivado TCL connects them to the ILA core
        # so Vivado Hardware Manager can display Church Machine state in real-time.
        #
        #   dbg_boot_complete  — CM has exited the boot phase and is executing user code
        #   dbg_fault_valid    — live CM fault signal (any fault type, any cycle)
        #   dbg_nia[31:0]      — NIA of the most-recently retired instruction
        #   dbg_fault[31:0]    — packed fault telemetry:
        #                          bits[4:0]  = 0 (reserved)
        #                          bit[5]     = retire_fault_valid (fault on this retire)
        #                          bits[10:6] = retire_fault_code (5-bit fault type)
        #                          bits[31:11] = fault_gt[20:0] (GT word0 upper 21 bits)
        self.dbg_boot_complete = Signal()      # out — CM boot done
        self.dbg_fault_valid   = Signal()      # out — live fault
        self.dbg_nia           = Signal(32)    # out — retired NIA
        self.dbg_fault         = Signal(32)    # out — packed fault telemetry

        # ── Halt-state signals — exposed for testability ───────────────────────
        # Declared here so simulation testbenches can read them as top-level
        # ports without needing a probe submodule.  Both are driven by elaborate().
        self.step_mode   = Signal(init=0)  # 0 = free-run; 1 = step/halt mode
        self.step_halted = Signal()        # 1 = CM currently held between retires

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
        #
        # sim_mode=True: skip the port-driven comb assignment so sim.add_clock()
        # can drive ClockSignal("sync") directly without a DriverConflict.
        # self.clk is left undriven (unused) in simulation.
        m.domains += ClockDomain("sync", reset_less=True)
        if not self.sim_mode:
            m.d.comb += ClockSignal("sync").eq(self.clk)

        # ── ChurchCore ─────────────────────────────────────────────────────────
        core = m.submodules.core = ChurchCore()

        # ── Boot ROM (instruction fetch — read-only BRAM tile) ─────────────────
        boot_rom = m.submodules.boot_rom = BootRom(_WUKONG_ROM)
        m.d.comb += boot_rom.addr.eq(core.imem_addr[2:12])
        # imem source mux: NIA 0x0-0xB fetches BOOT_PROGRAM from the 3-word ROM;
        # everything else fetches from DMEM via a dedicated read port (below),
        # so the WukongCallHome LUMP body at word 448 — and any IDE-uploaded
        # code — actually executes.  Both sources have 1-cycle latency, so the
        # select is registered to stay aligned with the data.
        imem_from_dmem = Signal()
        m.d.sync += imem_from_dmem.eq(core.imem_addr >= 0xC)

        # ── Data memory (BRAM, 16 384 × 32-bit = 64 KB) ───────────────────────
        # init= is used for simulation accuracy only.  On real FPGA hardware the
        # hw_init sequencer (below) writes every non-zero word via the write port
        # before boot_start fires.
        #
        # Boot FSM initialises:
        #   CR15.word1_location = 0      (NS at byte 0)
        #   CR6.word1_location  = 0x400  (c-list at byte 0x400 = word 256)
        #
        # BOOT_PROGRAM[2] = CALL CR0,CR0[0] → Thread.caps[0] (WUKONG_DEMO_CLIST[0])
        # WUKONG_DEMO_CLIST[0] is NULL (zero) in the factory image; the IDE boot-image
        # upload overwrites it with the E-GT for the ⚡ configured boot abstraction.
        #
        # WukongCallHome LUMP (cc=0): uses CR6 to reach the boot c-list directly.
        #   WUKONG_NUC_PROGRAM[0] = LOAD CR3, CR6[5]  → LED_DEV (clist[5])
        #   WUKONG_NUC_PROGRAM[1] = LOAD CR4, CR6[6]  → UART_DEV (clist[6])
        #   clist_gt_addr LED  = 0x400 + 5*4 = 0x414 = word 261 = WUKONG_DEMO_CLIST[5] ✓
        #   clist_gt_addr UART = 0x400 + 6*4 = 0x418 = word 262 = WUKONG_DEMO_CLIST[6] ✓
        # ── DMEM initialisation data ──────────────────────────────────────────
        # Layout:
        #   words   0-31  : WUKONG_DEMO_NAMESPACE (8 NS slots × 4 words)
        #                   slot 7 lim17=127 (alloc=128 for WukongCallHome LUMP)
        #   words  32-255 : zeros
        #   words 256-319 : WUKONG_DEMO_CLIST (64 c-list entries)
        #                   [0]=NULL (IDE upload sets this to ⚡ boot entry E-GT)
        #                   [5]=LED_DEV, [6]=UART_DEV, [7]=BTN_DEV, [8]=TIMER_DEV
        #                   [9]=0, [10]=0  (SlideRule/Constants absent in 8-slot NS)
        #   words 320-447 : zeros
        #   words 448-521 : WukongCallHome LUMP body
        #                   [448] header (magic=0x1F, n_minus_6=1, cw=73, cc=0)
        #                   [449..521] WUKONG_NUC_PROGRAM[0..72]
        #   words 522-575 : zeros (padding to end of 128-word alloc at word 575)
        #   words 576+    : zeros
        #
        # The LUMP body is derived from WUKONG_NUC_PROGRAM at module-load time, so
        # any future change to WUKONG_NUC_PROGRAM propagates automatically.
        # The overflow guard at the top of this file catches length growth.
        dmem_init = list(WUKONG_DEMO_NAMESPACE)    # words 0-31
        while len(dmem_init) < 256:
            dmem_init.append(0)                    # words 32-255 = zero
        dmem_init += list(WUKONG_DEMO_CLIST)       # words 256-319: full c-list
        while len(dmem_init) < 16384:
            dmem_init.append(0)

        # WukongCallHome LUMP body at DMEM byte 0x0700 = word 0x1C0 = 448.
        # cc=7 → c-list tail at lump words 121-127 ([5]=LED, [6]=UART); the
        # hardware CALL derives CR6 from the called lump's own header, so a
        # cc=0 lump gets a NULL CR6 and its first LOAD faults NULL_CAP.
        _wch_cw = len(WUKONG_NUC_PROGRAM)               # 73 — auto-tracks changes
        for _i, _v in enumerate([wukong_wch_header(_wch_cw)] + list(WUKONG_NUC_PROGRAM)):
            dmem_init[0x1C0 + _i] = _v
        for _i, _v in enumerate(WUKONG_WCH_CLIST):
            dmem_init[WUKONG_WCH_CLIST_WORD + _i] = _v

        # Boot.Thread lump at byte 0x900 (word 576) — see boot_rom.py for the
        # relocation rationale (a base-0 Thread lump collides with the NS
        # table: Heap[0]/STO is NS slot 4 word1).
        #   header  : valid lump header (size=256, sw=32, cc=12)
        #   STO     : 243 (sp_max) so the boot CALL's stack push succeeds
        #   caps[0] : WukongCallHome E-GT (NS slot 7) — the ⚡ boot entry.
        #             BOOT_PROGRAM[2] = CALL CR0,CR0[0] resolves THIS word.
        #   caps[12]: S-perm Boot.Thread GT so RESTORE_CALL[12] gives CR12 a
        #             non-null cap (FETCH_THREAD_HDR faults otherwise).
        dmem_init[WUKONG_THREAD_BASE_WORD]   = WUKONG_THREAD_HEADER
        dmem_init[WUKONG_THREAD_STO_WORD]    = WUKONG_THREAD_STO_INIT
        dmem_init[WUKONG_THREAD_CAPS0_WORD]  = 0x4A000007  # WukongCallHome E-GT
        dmem_init[WUKONG_THREAD_CAPS12_WORD] = make_gt(GT_TYPE_INFORM, PERM_MASK_S, 1, 0)
        # Words 0x1EA..0x23F remain zero (padding to 128-word alloc boundary).

        hw_init_pairs = [(addr, val)
                         for addr, val in enumerate(dmem_init) if val != 0]

        # N_INIT is computed here (before the UART mux) so C(N_INIT & 0xFF, 8)
        # is available when the boot sentinel mux is elaborated.  The boot FSM
        # below also uses N_INIT for Signal(range(N_INIT+1)) and the done-latch.
        N_INIT = len(hw_init_pairs)

        dmem = m.submodules.dmem = LibMemory(
            shape=unsigned(32), depth=16384, init=dmem_init)
        dmem_rd = dmem.read_port(domain="sync")
        dmem_wr = dmem.write_port()

        # Dedicated instruction-fetch read port (BRAM port; Vivado duplicates
        # the BRAM to satisfy 3 ports — both copies share the write port, so
        # IDE uploads stay coherent with executed code).
        imem_rd = dmem.read_port(domain="sync")
        m.d.comb += [
            imem_rd.addr.eq(core.imem_addr[2:16]),
            core.imem_data.eq(Mux(imem_from_dmem, imem_rd.data, boot_rom.data)),
        ]

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
        # trace_stall: asserted by TraceUnit while events are pending.
        # OR-ed into halt_req/imem_valid so the CM cannot retire the next
        # instruction until the TraceUnit drains all queued event packets.
        trace_stall   = Signal()   # backpressure: stall CM while events pending

        # ── Upload FSM signals (declared early — used in UART TX mux and dmem_wr) ──
        # These are driven by the upload FSM states (UPLOAD_LEN / UPLOAD_DATA /
        # UPLOAD_ACK) added to the cmd_parser FSM below.  They must be declared
        # before the UART TX arbitrator and the dmem_wr write-port selector, both
        # of which reference them as Python variables.
        up_len_bytes    = [Signal(8,  name=f"up_len_b{i}") for i in range(4)]
        up_len_cnt      = Signal(2)   # length-header bytes received so far (0-3)
        up_byte_cnt     = Signal(17)  # payload bytes still to receive (max 65536)
        up_word_buf     = [Signal(8,  name=f"up_wb{i}") for i in range(3)]
        # up_word_buf[0..2] buffer bytes 0-2 (MSB first); byte 3 comes from uart_rx.data
        up_byte_in_word = Signal(2)   # position within current 4-byte word (0=MSB, 3=LSB)
        upload_wr_addr_r = Signal(14) # registered DMEM word address for next write
        upload_wr_en    = Signal()    # combinatorial: write one word to DMEM this cycle
        upload_wr_addr  = Signal(14)  # combinatorial: target DMEM word address
        upload_wr_data  = Signal(32)  # combinatorial: 32-bit word to write (big-endian)
        upload_ack_req  = Signal()    # asserted in UPLOAD_ACK; drives 0x06 onto TX
        # Watchdog: aborts UPLOAD_LEN/UPLOAD_DATA if no byte arrives for
        # _UPLOAD_WATCHDOG_LIMIT cycles.  Protects against stuck states when the
        # UART drops bytes mid-frame (so the RTL does not remain in UPLOAD_DATA
        # indefinitely, treating any future command bytes as DMEM payload).
        # Threshold = 20 × one-byte period; safe floor of 1000 cycles.
        # 20 complete 8N1 byte periods (= 20 × 10 bit-periods each).
        # At 57 600 baud / 50 MHz: 1 byte = 10 × 868 = 8 680 cycles;
        # 20 bytes = 173 600 cycles ≈ 3.5 ms.  This is comfortably wider than
        # any normal inter-byte gap on a local USB-serial link, while still
        # allowing the board to recover quickly after a truncated upload.
        _UPLOAD_WATCHDOG_LIMIT = max(self.clk_freq // self.baud * 10 * 20, 1000)
        upload_watchdog = Signal(range(_UPLOAD_WATCHDOG_LIMIT + 1))

        # ── Boot-triggered / sentinel signals (declared early for arbitrator) ──
        # boot_triggered is driven by the boot FSM below; sentinel_sent latches
        # after all sentinel bytes have been accepted by the UART TX.
        #
        # Four-byte boot sentinel: 0xBC  N_INIT&0xFF  TU_VERSION  BUILD_VERSION
        #   0xBC          — magic: new-format sentinel (old bitstreams emit 0xBB 2-byte sentinel)
        #   N_INIT&0xFF   — count of non-zero DMEM words written by hw_init sequencer
        #   TU_VERSION    — TraceUnit FSM capability version (see _TU_VERSION_* below)
        #   BUILD_VERSION — monotonically increasing build identifier baked in at
        #                   synthesis time; lets the IDE/bridge confirm exactly which
        #                   bitstream is running without reprogramming.  Increment
        #                   WUKONG_BUILD_VERSION in wukong_top.py for every new build.
        #
        # TU_VERSION constants (must match wukong_bridge.py TU_VERSION_* constants):
        #   0x02 = TraceUnit emits 3-packet CALL sequence (CALL_CR6/CALL_CR14/CALL_PUSH)
        #          for ELOADCALL and XLOADLAMBDA — current FSM capability level.
        #
        # Old bitstreams (pre-v2 TraceUnit) emit 0xBB N_INIT (2 bytes only).
        # The bridge detects 0xBB and warns the user that ELOADCALL/XLOADLAMBDA
        # will silently show wrong CR6/CR14 state (only RESULT is emitted).
        #
        # The N_INIT byte is baked in at synthesis time from hw_init_pairs.
        # The bridge (wukong_bridge.py) reads this byte and compares it against
        # the count computed from the current boot_rom.py tables.  A mismatch
        # means the bitstream was built with a different WUKONG_DEMO_NAMESPACE /
        # WUKONG_DEMO_CLIST than the one currently in source — stale bitstream.
        _TU_VERSION_CALL_3PKT = 0x02  # TraceUnit emits CALL_CR6/CR14/PUSH for ELOADCALL+XLOADLAMBDA
        _BUILD_VERSION = WUKONG_BUILD_VERSION  # baked into sentinel byte 4; increment per build
        boot_triggered  = Signal()
        sentinel_sent   = Signal()
        sentinel_phase  = Signal(2)  # 0=0xBC, 1=N_INIT, 2=TU_VERSION, 3=BUILD_VERSION

        # ── Hardware boot banner (declared early; driven by boot FSM below) ─────
        # Sends "WUKONG\r\n" via UART TX during Phase 2.5 — after hw_init writes
        # complete but BEFORE boot_start fires.  This gives hardware-level
        # confirmation that the FPGA is alive and UART TX works, completely
        # independent of whether the CM executes any instructions correctly.
        # hw_init_done is also declared here (not in the boot FSM) so the UART
        # arbitrator below can reference it.
        _BANNER_BYTES = [ord(c) for c in "WUKONG\r\n"]
        _N_BANNER = len(_BANNER_BYTES)   # 8

        hw_init_done  = Signal()         # registered: set 1 cycle after last hw_init write
        banner_idx    = Signal(range(_N_BANNER + 1), init=0)
        # sim_mode=True: pre-set banner_done so Phase 2.5 is skipped entirely.
        # The banner takes ~4320 simulation cycles (8 UART bytes × 540 cycles/byte
        # at div=53), which breaks the hw_init timing test that only allows
        # 17+N_INIT cycles.  Hardware synthesis is unaffected (sim_mode=False).
        banner_done   = Signal(init=1 if self.sim_mode else 0)

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
        # Priority (highest to lowest):
        #   1. CM MMIO reg-5 write       — cm_tx_start
        #   2. HW boot banner            — "WUKONG\r\n", sent before boot_start
        #   3. Boot sentinel (3 bytes)   — 0xBC then N_INIT&0xFF then TU_VERSION, once at boot
        #   4. TraceUnit packets         — fill remaining idle TX cycles
        #
        # cm_tx_start is the raw CM write signal; used by the TraceUnit to avoid
        # colliding with in-flight CM bytes.
        cm_tx_start = Signal()
        m.d.comb += cm_tx_start.eq(is_mmio_write & (mmio_reg_sel == 5))

        # ── Banner request logic ──────────────────────────────────────────────
        # banner_req is active in Phase 2.5: hw_init done, banner not yet sent,
        # boot not yet triggered (so CM is definitely idle).
        banner_req  = Signal()
        banner_byte = Signal(8)
        m.d.comb += banner_req.eq(hw_init_done & ~banner_done & ~boot_triggered)
        with m.Switch(banner_idx):
            for i, b in enumerate(_BANNER_BYTES):
                with m.Case(i):
                    m.d.comb += banner_byte.eq(C(b, 8))
            with m.Default():
                m.d.comb += banner_byte.eq(0)
        # tx_free: UART TX can accept a new byte THIS cycle.  ~busy alone is
        # NOT sufficient: UartTx has a one-cycle DONE state (busy=0, done=1)
        # during which `start` is ignored — a requester that advances its
        # byte counter on `~busy` double-increments across that cycle and
        # silently skips every other byte (bug: sentinel came out as
        # 0xBC TU_VERSION instead of 0xBC N_INIT TU_VERSION BUILD_VERSION).
        tx_free = Signal()
        m.d.comb += tx_free.eq(~uart_tx.busy & ~uart_tx.done)

        # Advance banner on each accepted byte (start pulse fired = accepted)
        with m.If(banner_req & tx_free & ~cm_tx_start):
            with m.If(banner_idx == _N_BANNER - 1):
                m.d.sync += [banner_done.eq(1), banner_idx.eq(0)]
            with m.Else():
                m.d.sync += banner_idx.eq(banner_idx + 1)

        # sentinel_req: active until all four sentinel bytes are accepted.
        # sentinel_phase=0 → send 0xBC; =1 → send N_INIT&0xFF;
        #               =2 → send TU_VERSION; =3 → send BUILD_VERSION.
        # After the fourth byte is accepted, sentinel_sent latches and req drops.
        # 'f' command clears sentinel_sent so the full 4-byte sequence re-fires.
        sentinel_req = Signal()
        m.d.comb += sentinel_req.eq(boot_triggered & ~sentinel_sent)
        with m.If(sentinel_req & tx_free & ~cm_tx_start & ~banner_req):
            with m.If(sentinel_phase == 0):
                m.d.sync += sentinel_phase.eq(1)   # 0xBC accepted → queue N_INIT byte
            with m.Elif(sentinel_phase == 1):
                m.d.sync += sentinel_phase.eq(2)   # N_INIT byte accepted → queue TU_VERSION
            with m.Elif(sentinel_phase == 2):
                m.d.sync += sentinel_phase.eq(3)   # TU_VERSION accepted → queue BUILD_VERSION
            with m.Else():
                m.d.sync += sentinel_sent.eq(1)    # BUILD_VERSION byte accepted → done

        trace_tx_ack = Signal()  # TraceUnit byte accepted (one-cycle ack)
        m.d.comb += [
            uart_tx.data.eq(
                Mux(cm_tx_start,                              core.dmem_wr_data[0:8],
                Mux(banner_req,                                banner_byte,
                Mux(sentinel_req & (sentinel_phase == 0),    C(0xBC, 8),
                Mux(sentinel_req & (sentinel_phase == 1),    C(N_INIT & 0xFF, 8),
                Mux(sentinel_req & (sentinel_phase == 2),    C(_TU_VERSION_CALL_3PKT, 8),
                Mux(sentinel_req & (sentinel_phase == 3),    C(_BUILD_VERSION & 0xFF, 8),
                Mux(upload_ack_req,                          C(0x06, 8),
                                                              trace_tx_byte))))))))  ,
            uart_tx.start.eq(
                cm_tx_start |
                (banner_req      & tx_free & ~cm_tx_start) |
                (sentinel_req    & tx_free & ~cm_tx_start & ~banner_req) |
                (upload_ack_req  & tx_free & ~cm_tx_start & ~sentinel_req & ~banner_req) |
                (trace_tx_req    & tx_free & ~cm_tx_start & ~sentinel_req & ~banner_req & ~upload_ack_req)),
            trace_tx_ack.eq(
                trace_tx_req & tx_free & ~cm_tx_start & ~sentinel_req & ~banner_req & ~upload_ack_req),
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
        with m.Elif(upload_wr_en):
            # Upload takes priority over CPU writes (CM is halted during upload).
            m.d.comb += [
                dmem_wr.addr.eq(upload_wr_addr),
                dmem_wr.data.eq(upload_wr_data),
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
        cm_reboot     = Signal()   # 1-cycle pulse from 'f' — full CM reboot (FAULT_RST, NIA=0)
        m.d.sync += fault_latched.eq(~cm_reboot & (fault_latched | core.fault_valid))
        m.d.comb += core.reboot_req.eq(cm_reboot)

        # step_mode=1 (default when IDE-connected): CM halts after each retired
        #   instruction and waits for an 's' command before executing the next one.
        # step_mode=0: CM executes freely; 'h' or a breakpoint hit re-enters step mode.
        # Wukong standalone: init=0 so the CM free-runs without requiring a bridge
        # to send 'r' first.  The bridge can still send 'h' to enter step mode.
        step_mode   = self.step_mode   # 0 = free-run (standalone-safe); see __init__
        step_halted = self.step_halted # 1 = CM currently held between instructions
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

        # Fault halt: any retire with fault_valid=True auto-enters step mode,
        # exactly like a breakpoint hit.  This lets the IDE single-step through
        # the fault handler without the CM silently retrying and continuing.
        fault_halt = Signal()
        m.d.comb += fault_halt.eq(core.retire_valid & core.retire_fault_valid)

        # Breakpoint hit or fault → force step_mode + halt; takes highest priority.
        with m.If(bp_hit | fault_halt):
            m.d.sync += [step_mode.eq(1), step_halted.eq(1)]
        with m.Elif(step_grant & step_mode):
            # step_grant clears halt for one retire (re-set on next retire_valid)
            m.d.sync += step_halted.eq(0)
        with m.Elif(core.retire_valid & step_mode & ~step_grant):
            m.d.sync += step_halted.eq(1)
        with m.Elif(~step_mode):
            m.d.sync += step_halted.eq(0)

        # Fetch-settle bubble: DMEM BRAM is sync-read; the cycle after
        # imem_addr changes the read port still presents the OLD word.  Mask
        # imem_valid for that cycle or the core retires a stale decode right
        # after every NIA jump (stream slides one slot after the boot CALL).
        imem_addr_prev = Signal(32, init=0xFFFFFFFF)
        m.d.sync += imem_addr_prev.eq(core.imem_addr)
        imem_settled = Signal()
        m.d.comb += imem_settled.eq(imem_addr_prev == core.imem_addr)
        m.d.comb += [
            # trace_stall is OR-ed in so the TraceUnit can drain all event
            # packets for one instruction before the next retire fires.
            core.imem_valid.eq(~step_halted & ~trace_stall & imem_settled),
            core.halt_req.eq(step_halted | trace_stall),
            core.free_run_start.eq(0),
            core.free_run_nia.eq(0),
            core.gc_start.eq(0),
        ]

        # ── Command parser FSM ─────────────────────────────────────────────────
        # Reads one-byte commands from the UART RX FIFO:
        #   's' (0x73) — step:       release CM for one retire (step_mode stays on)
        #   'r' (0x72) — run:        clear step_mode; CM runs freely
        #   'h' (0x68) — halt:       assert step_mode + step_halted immediately
        #   'b' (0x62) — breakpoint: read 4 big-endian NIA bytes, then arm/disarm
        #   'f' (0x66) — force sentinel: re-arm sentinel_sent=0 so the 3-byte
        #                boot sentinel (0xBC N_INIT TU_VERSION) is retransmitted.
        #                Lets the bridge re-detect the running bitstream identity
        #                without reprogramming the FPGA.
        #   'u' (0x75) — upload:     receive 4-byte big-endian byte-count header,
        #                            then N raw bytes (big-endian 32-bit words).
        #                            Halts CM, writes words to DMEM starting at word 0,
        #                            then sends 0x06 ACK byte via UART TX.
        #
        # Breakpoint 'b' + NIA: arms slot bp_wr_ptr with the given NIA.
        # NIA==0xFFFFFFFF disarms the slot.  Pointer wraps 0→1→2→3→0.
        #
        # Upload 'u' protocol:
        #   Byte 0:     0x75 ('u') — magic, already consumed in IDLE
        #   Bytes 1-4:  big-endian uint32 — payload byte count (must be >0, ≤65536)
        #   Bytes 5…:   raw big-endian 32-bit words, MSB first within each word
        #   After last word: board sends 0x06 (ACK) via UART TX
        # The bridge in wukong_bridge.py reads the ACK and POSTs upload_ok to the IDE.

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
                        with m.Case(0x66):  # 'f' — full CM reboot + sentinel retransmit
                            # REBOOT and FAULT both zero the NIA: pulse reboot_req
                            # so the core takes the same FAULT_RST path a post-boot
                            # fault takes (clear_all → boot ladder → NIA=0), then
                            # BOOT_PROGRAM re-executes (LOAD/CHANGE/CALL trace
                            # events re-fire).  DMEM is NOT reloaded, so uploaded
                            # lump changes take effect on the reboot.
                            # Also re-arm the sentinel and clear the fault latch +
                            # step state so the CM free-runs after the reboot.
                            m.d.comb += cm_reboot.eq(1)
                            m.d.sync += [
                                sentinel_sent.eq(0), sentinel_phase.eq(0),
                                step_mode.eq(0), step_halted.eq(0),
                            ]
                        with m.Case(0x75):  # 'u' — upload
                            # Halt the CM immediately; it stays halted until
                            # UPLOAD_ACK sends the 0x06 completion byte and the
                            # bridge then issues 'r' to re-enable free-run.
                            m.d.sync += [
                                step_mode.eq(1), step_halted.eq(1),
                                up_len_cnt.eq(0),
                            ]
                            m.next = "UPLOAD_LEN"

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

            # ── Upload FSM states ('u' = 0x75) ────────────────────────────────
            with m.State("UPLOAD_LEN"):
                # Receive 4 big-endian bytes encoding the total payload byte count.
                with m.If(uart_rx.valid):
                    m.d.sync += upload_watchdog.eq(0)
                    with m.Switch(up_len_cnt):
                        for _i in range(4):
                            with m.Case(_i):
                                m.d.sync += [up_len_bytes[_i].eq(uart_rx.data),
                                             up_len_cnt.eq(_i + 1)]
                    with m.If(up_len_cnt == 3):
                        m.next = "UPLOAD_LEN_COMMIT"
                with m.Else():
                    m.d.sync += upload_watchdog.eq(upload_watchdog + 1)
                    with m.If(upload_watchdog == _UPLOAD_WATCHDOG_LIMIT - 1):
                        # Timed out waiting for length header — abort to IDLE.
                        # step_mode / step_halted stay at 1 (fail-closed): the
                        # CM remains halted; the bridge must send an explicit 'r'
                        # after diagnosing the failure.
                        m.d.sync += upload_watchdog.eq(0)
                        m.next = "IDLE"

            with m.State("UPLOAD_LEN_COMMIT"):
                # Assemble big-endian byte count: byte[0]=MSB .. byte[3]=LSB.
                # Reject if zero or exceeds DMEM capacity (65536 bytes = 16384 words).
                up_len_val = Signal(32, name="up_len_val")
                m.d.comb += up_len_val.eq(
                    Cat(up_len_bytes[3], up_len_bytes[2],
                        up_len_bytes[1], up_len_bytes[0]))
                with m.If((up_len_val == 0) | (up_len_val > 65536)):
                    # Malformed length: return to IDLE.
                    # step_mode / step_halted stay at 1 (fail-closed): CM
                    # remains halted; bridge sends explicit 'r' to resume.
                    m.next = "IDLE"
                with m.Else():
                    m.d.sync += [
                        up_byte_cnt.eq(up_len_val[0:17]),
                        up_byte_in_word.eq(0),
                        upload_wr_addr_r.eq(0),
                    ]
                    m.next = "UPLOAD_DATA"

            with m.State("UPLOAD_DATA"):
                # Receive payload bytes; assemble big-endian 32-bit words and
                # write each complete word to DMEM as it arrives.
                # Byte ordering: byte 0 = bits[31:24] (MSB), byte 3 = bits[7:0] (LSB).
                #
                # Watchdog: if no byte arrives for _UPLOAD_WATCHDOG_LIMIT cycles
                # the UART has dropped bytes and we will never see the declared
                # byte count.  Return to IDLE so subsequent frames are not
                # silently corrupted by treating later UART traffic as payload.
                with m.If(uart_rx.valid):
                    m.d.sync += upload_watchdog.eq(0)
                    # Buffer bytes 0-2 in registers; byte 3 is used directly from
                    # uart_rx.data so it doesn't need a separate register.
                    with m.Switch(up_byte_in_word):
                        with m.Case(0): m.d.sync += up_word_buf[0].eq(uart_rx.data)
                        with m.Case(1): m.d.sync += up_word_buf[1].eq(uart_rx.data)
                        with m.Case(2): m.d.sync += up_word_buf[2].eq(uart_rx.data)

                    # When byte 3 (LSB) arrives, assemble and write the word.
                    with m.If(up_byte_in_word == 3):
                        m.d.comb += [
                            upload_wr_en.eq(1),
                            upload_wr_addr.eq(upload_wr_addr_r),
                            # Cat(LSB, b2, b1, MSB) → bits[31:24]=buf[0], bits[7:0]=rx
                            upload_wr_data.eq(
                                Cat(uart_rx.data, up_word_buf[2],
                                    up_word_buf[1], up_word_buf[0])),
                        ]
                        m.d.sync += upload_wr_addr_r.eq(upload_wr_addr_r + 1)

                    # Decrement byte counter; advance position or wrap on word boundary.
                    m.d.sync += up_byte_cnt.eq(up_byte_cnt - 1)
                    with m.If(up_byte_cnt == 1):
                        # Last byte received — proceed to ACK state.
                        m.next = "UPLOAD_ACK"
                    with m.Else():
                        m.d.sync += up_byte_in_word.eq(
                            Mux(up_byte_in_word == 3, 0, up_byte_in_word + 1))
                with m.Else():
                    # No byte this cycle — advance watchdog.
                    m.d.sync += upload_watchdog.eq(upload_watchdog + 1)
                    with m.If(upload_watchdog == _UPLOAD_WATCHDOG_LIMIT - 1):
                        # Timed out mid-payload — abort to IDLE so future 'u'
                        # frames are not silently treated as continuation data.
                        # step_mode / step_halted stay at 1 (fail-closed): the
                        # CM remains halted; bridge sends explicit 'r' to resume.
                        m.d.sync += upload_watchdog.eq(0)
                        m.next = "IDLE"

            with m.State("UPLOAD_ACK"):
                # Assert upload_ack_req to inject 0x06 into the TX arbitrator.
                # Transition to IDLE on the same cycle the start pulse fires
                # (the byte is already latched into the UART TX shift register).
                m.d.comb += upload_ack_req.eq(1)
                # Must mirror the arbitrator's accepted-start condition exactly
                # (tx_free, not bare ~busy): during UartTx's one-cycle DONE
                # state busy=0 but start is ignored — leaving on ~busy alone
                # would drop the 0x06 ACK byte.
                with m.If(tx_free & ~cm_tx_start & ~sentinel_req & ~banner_req):
                    m.next = "IDLE"

        # ── TraceUnit FSM ──────────────────────────────────────────────────────
        #
        # Emits one 12-byte 0xAA packet per *event*.  Multi-cycle instructions
        # produce multiple events, each with its own packet:
        #
        #   Instruction    Events (in order)
        #   ─────────────────────────────────────────────────────────────────
        #   LOAD           LOAD_SHADOW (old CR_dst GT) + LOAD_NEW (new GT)
        #   CHANGE         CHANGE_PUSH + CHANGE_CR12  + CHANGE_CR5
        #   CALL           CALL_CR6   + CALL_CR14    + CALL_PUSH
        #   ELOADCALL      CALL_CR6   + CALL_CR14    + CALL_PUSH
        #   XLOADLAMBDA    CALL_CR6   + CALL_CR14    + CALL_PUSH
        #   RETURN         RETURN_POP + RETURN_CR6   + RETURN_CR14
        #   all others     RESULT (single packet, payload=0)
        #
        # Packet format — 12 bytes, big-endian:
        #   [0]     0xAA             magic
        #   [1..4]  NIA              retiring instruction NIA (big-endian uint32)
        #   [5]     event_type       TRACE_EV_* constant
        #   [6..9]  payload          GT word0 (big-endian uint32; 0 for push/pop events)
        #   [10]    flags            bits[3:0]=NZCV; bits[7:4]=0
        #   [11]    fault            {bp_hit[7], fault_valid[6], 0[5], fault_code[4:0]}
        #
        # Backpressure (no silent drops): trace_stall is asserted while events
        # are pending, and is OR-ed into core.halt_req / core.imem_valid so the
        # CM cannot retire the next instruction until the queue drains.
        #
        # Must match TRACE_EV_* in wukong_bridge.py and debug-packet-protocol.md.

        # ── Event type constants ──────────────────────────────────────────────
        _TRACE_MAGIC       = 0xAA
        _TRACE_PKT_LEN     = 12   # bytes per packet (matches wukong_bridge.py TRACE_LEN)

        _TRACE_EV_RESULT      = 0x00  # Single-packet result (DR→DR, SAVE, etc.)
        _TRACE_EV_LOAD_SHADOW = 0x01  # LOAD: old CR_dst GT displaced
        _TRACE_EV_LOAD_NEW    = 0x02  # LOAD: new GT installed in CR_dst
        _TRACE_EV_CHANGE_PUSH = 0x03  # CHANGE: context stack push
        _TRACE_EV_CHANGE_CR12 = 0x04  # CHANGE: CR12 ← new thread GT
        _TRACE_EV_CHANGE_CR5  = 0x05  # CHANGE: CR5  ← heap GT
        _TRACE_EV_CALL_CR6    = 0x06  # CALL:   CR6  ← abstraction GT
        _TRACE_EV_CALL_CR14   = 0x07  # CALL:   CR14 ← code / return GT
        _TRACE_EV_CALL_PUSH   = 0x08  # CALL:   caller frame stack push
        _TRACE_EV_RETURN_POP  = 0x09  # RETURN: caller frame stack pop
        _TRACE_EV_RETURN_CR6  = 0x0A  # RETURN: CR6  ← restored from frame
        _TRACE_EV_RETURN_CR14 = 0x0B  # RETURN: CR14 ← restored from frame

        # ── Event queue: up to 3 events per retire ────────────────────────────
        # tq_type[0..2] / tq_data[0..2]: event type + payload for each slot.
        # tq_len:  total events queued (1, 2, or 3).
        # tq_ptr:  index of the event currently being sent.
        # tq_bidx: byte index within the 12-byte packet for the current event.
        # tq_nia / tq_flags / tq_fault: shared across all events for one retire.
        tq_type  = [Signal(8,  name=f"tq_type{i}")  for i in range(3)]
        tq_data  = [Signal(32, name=f"tq_data{i}")  for i in range(3)]
        tq_len   = Signal(2,  name="tq_len")
        tq_ptr   = Signal(2,  name="tq_ptr")
        tq_bidx  = Signal(4,  name="tq_bidx")
        tq_nia   = Signal(32, name="tq_nia")
        tq_flags = Signal(8,  name="tq_flags")   # bits[3:0]=NZCV; bits[7:4]=0
        tq_fault = Signal(8,  name="tq_fault")   # {bp_hit[7], fault_valid[6], 0[5], fault_code[4:0]}

        # Current event's type and payload (combinatorial mux of tq_ptr)
        _cur_ev_type = Signal(8,  name="cur_ev_type")
        _cur_ev_data = Signal(32, name="cur_ev_data")
        with m.Switch(tq_ptr):
            for _i in range(3):
                with m.Case(_i):
                    m.d.comb += [
                        _cur_ev_type.eq(tq_type[_i]),
                        _cur_ev_data.eq(tq_data[_i]),
                    ]

        with m.FSM(name="trace_unit"):
            with m.State("IDLE"):
                m.d.comb += [trace_tx_req.eq(0), trace_tx_byte.eq(0),
                             trace_stall.eq(0)]

                with m.If(core.retire_valid):
                    # Capture per-instruction shared fields
                    m.d.sync += [
                        tq_nia.eq(core.retire_nia),
                        tq_flags.eq(Cat(core.retire_flags.as_value()[:4], C(0, 4))),
                        tq_fault.eq(Cat(
                            core.retire_fault_code[:5],   # bits[4:0]
                            C(0, 1),                       # bit[5] reserved
                            core.retire_fault_valid,       # bit[6]
                            bp_hit,                        # bit[7]
                        )),
                        tq_ptr.eq(0),
                        tq_bidx.eq(0),
                    ]

                    # Decode the full 5-bit opcode bits[31:27] to determine
                    # the event sequence.  Using only bits[30:27] aliases
                    # Turing opcodes onto Church opcodes: DREAD (16/10000b)
                    # becomes LOAD (0/0000b), which incorrectly emits the
                    # two LOAD packets for one DREAD retire.
                    with m.Switch(core.retire_instr[27:32]):
                        with m.Case(ChurchOpcode.LOAD):    # 0b0000
                            m.d.sync += [
                                tq_len.eq(2),
                                tq_type[0].eq(_TRACE_EV_LOAD_SHADOW),
                                tq_data[0].eq(core.retire_trace_load_shadow_gt),
                                tq_type[1].eq(_TRACE_EV_LOAD_NEW),
                                tq_data[1].eq(core.retire_trace_load_new_gt),
                            ]
                        with m.Case(ChurchOpcode.CHANGE):  # 0b0100
                            m.d.sync += [
                                tq_len.eq(3),
                                tq_type[0].eq(_TRACE_EV_CHANGE_PUSH),
                                tq_data[0].eq(0),
                                tq_type[1].eq(_TRACE_EV_CHANGE_CR12),
                                tq_data[1].eq(core.retire_trace_cr12_gt),
                                tq_type[2].eq(_TRACE_EV_CHANGE_CR5),
                                tq_data[2].eq(core.retire_trace_cr5_gt),
                            ]
                        with m.Case(ChurchOpcode.CALL):    # 0b0010
                            m.d.sync += [
                                tq_len.eq(3),
                                tq_type[0].eq(_TRACE_EV_CALL_CR6),
                                tq_data[0].eq(core.retire_trace_cr6_gt),
                                tq_type[1].eq(_TRACE_EV_CALL_CR14),
                                tq_data[1].eq(core.retire_trace_cr14_gt),
                                tq_type[2].eq(_TRACE_EV_CALL_PUSH),
                                tq_data[2].eq(0),
                            ]
                        with m.Case(ChurchOpcode.ELOADCALL):    # 0b1000
                            # ELOADCALL modifies CR6 and CR14 identically to CALL
                            # (fused LOAD+TPERM(E)+CALL); emit the same 3-event sequence.
                            m.d.sync += [
                                tq_len.eq(3),
                                tq_type[0].eq(_TRACE_EV_CALL_CR6),
                                tq_data[0].eq(core.retire_trace_cr6_gt),
                                tq_type[1].eq(_TRACE_EV_CALL_CR14),
                                tq_data[1].eq(core.retire_trace_cr14_gt),
                                tq_type[2].eq(_TRACE_EV_CALL_PUSH),
                                tq_data[2].eq(0),
                            ]
                        with m.Case(ChurchOpcode.XLOADLAMBDA):  # 0b1001
                            # XLOADLAMBDA modifies CR6 and CR14 identically to CALL
                            # (fused LOAD+TPERM(X)+LAMBDA); emit the same 3-event sequence.
                            m.d.sync += [
                                tq_len.eq(3),
                                tq_type[0].eq(_TRACE_EV_CALL_CR6),
                                tq_data[0].eq(core.retire_trace_cr6_gt),
                                tq_type[1].eq(_TRACE_EV_CALL_CR14),
                                tq_data[1].eq(core.retire_trace_cr14_gt),
                                tq_type[2].eq(_TRACE_EV_CALL_PUSH),
                                tq_data[2].eq(0),
                            ]
                        with m.Case(ChurchOpcode.RETURN):  # 0b0011
                            # Always emit 3 events: RETURN_POP + RETURN_CR6 + RETURN_CR14.
                            # tq_data[2] is seeded with the current (callee's) CR14 here;
                            # the SEND state patches it with the correct restored caller
                            # CR14 when retire_trace_return_cr14_valid fires (cload commit).
                            m.d.sync += [
                                tq_len.eq(3),
                                tq_type[0].eq(_TRACE_EV_RETURN_POP),
                                tq_data[0].eq(0),
                                tq_type[1].eq(_TRACE_EV_RETURN_CR6),
                                tq_data[1].eq(core.retire_trace_cr6_gt),
                                tq_type[2].eq(_TRACE_EV_RETURN_CR14),
                                tq_data[2].eq(core.retire_trace_cr14_gt),
                            ]
                        with m.Default():
                            m.d.sync += [
                                tq_len.eq(1),
                                tq_type[0].eq(_TRACE_EV_RESULT),
                                tq_data[0].eq(0),
                            ]
                    m.next = "SEND"

            with m.State("SEND"):
                # Stall the CM while events are pending (no-drop guarantee)
                m.d.comb += [trace_tx_req.eq(1), trace_stall.eq(1)]

                # Select the byte for the current packet position
                with m.Switch(tq_bidx):
                    with m.Case(0):   m.d.comb += trace_tx_byte.eq(_TRACE_MAGIC)
                    with m.Case(1):   m.d.comb += trace_tx_byte.eq(tq_nia[24:32])
                    with m.Case(2):   m.d.comb += trace_tx_byte.eq(tq_nia[16:24])
                    with m.Case(3):   m.d.comb += trace_tx_byte.eq(tq_nia[8:16])
                    with m.Case(4):   m.d.comb += trace_tx_byte.eq(tq_nia[0:8])
                    with m.Case(5):   m.d.comb += trace_tx_byte.eq(_cur_ev_type)
                    with m.Case(6):   m.d.comb += trace_tx_byte.eq(_cur_ev_data[24:32])
                    with m.Case(7):   m.d.comb += trace_tx_byte.eq(_cur_ev_data[16:24])
                    with m.Case(8):   m.d.comb += trace_tx_byte.eq(_cur_ev_data[8:16])
                    with m.Case(9):   m.d.comb += trace_tx_byte.eq(_cur_ev_data[0:8])
                    with m.Case(10):  m.d.comb += trace_tx_byte.eq(tq_flags)
                    with m.Case(11):  m.d.comb += trace_tx_byte.eq(tq_fault)
                    with m.Default(): m.d.comb += trace_tx_byte.eq(0)

                # Cross-domain RETURN: cload commits the restored caller CR14 while
                # we are still sending events 0 and 1 (trace_stall holds the CM).
                # Patch tq_data[2] so RETURN_CR14 carries the correct caller value,
                # not the callee's CR14 that was latched at retire_valid time.
                # If cload faults the valid pulse never fires; the fault is reported
                # via fault_valid on the next retire (normal fault path).
                with m.If(core.retire_trace_return_cr14_valid):
                    m.d.sync += tq_data[2].eq(core.retire_trace_return_cr14_gt)

                with m.If(trace_tx_ack):
                    with m.If(tq_bidx == _TRACE_PKT_LEN - 1):
                        # Last byte of this event's packet
                        m.d.sync += tq_bidx.eq(0)
                        with m.If(tq_ptr == tq_len - 1):
                            # All events for this retire sent → return to IDLE
                            m.next = "IDLE"
                        with m.Else():
                            # More events remain → advance to next event
                            m.d.sync += tq_ptr.eq(tq_ptr + 1)
                    with m.Else():
                        m.d.sync += tq_bidx.eq(tq_bidx + 1)

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
        #   The (addr, data) pair for each cycle comes from a small combinatorial
        #   LUTRAM (init_rom) seeded with hw_init_pairs — one case in hardware,
        #   no large MUX chain.  A registered hw_init_done flag (latches when
        #   hw_init_ctr reaches N_INIT-1) replaces the synthesisable < N_INIT
        #   comparison, eliminating any Vivado comparison-folding or off-by-one.
        #
        # Phase 3 (1 cycle): boot_start pulsed; boot_triggered latched.
        #   The LED mux switches to CM-controlled outputs.
        #   The UART TX arbitrator sends sentinel bytes 0xBC N_INIT TU_VERSION (first free TX slots).
        boot_delay  = Signal(4, init=0)
        hw_init_ctr = Signal(range(N_INIT + 1), init=0)
        # hw_init_done declared earlier (near boot_triggered) for UART arbitrator use

        # ── Init LUTRAM (combinatorial read port → no MUX chain) ───────────────
        # Each entry packs dmem_addr[13:0] in bits[45:32] and dmem_data[31:0]
        # in bits[31:0].  Vivado infers LUTRAM for the small depth (~50 entries).
        _init_rom_contents = [
            ((addr & 0x3FFF) << 32) | (val & 0xFFFFFFFF)
            for addr, val in hw_init_pairs
        ] or [0]   # guard: at least one entry so depth >= 1
        init_rom    = m.submodules.init_rom = LibMemory(
            shape=unsigned(46), depth=len(_init_rom_contents),
            init=_init_rom_contents)
        init_rom_rd = init_rom.read_port(domain="comb")
        m.d.comb   += init_rom_rd.addr.eq(hw_init_ctr)

        # boot_triggered declared early (before UART arbitrator) so the sentinel
        # logic can reference it; driven here in the boot FSM.
        with m.If(~boot_triggered):
            # Phase 1: wait for boot_delay to reach 0xF
            with m.If(boot_delay < 0xF):
                m.d.sync += boot_delay.eq(boot_delay + 1)

            # Phase 2: write non-zero DMEM words one per cycle (ROM lookup)
            with m.Elif(~hw_init_done):
                m.d.sync += hw_init_ctr.eq(hw_init_ctr + 1)
                m.d.comb += [
                    hw_init_wr_en.eq(1),
                    hw_init_wr_addr.eq(init_rom_rd.data[32:46]),
                    hw_init_wr_data.eq(init_rom_rd.data[0:32]),
                ]
                # Latch done flag on the last write cycle so Phase 2.5 begins
                # the very next cycle — no fencepost, no comparison folding.
                with m.If(hw_init_ctr == N_INIT - 1):
                    m.d.sync += hw_init_done.eq(1)

            # Phase 2.5: send "WUKONG\r\n" hardware banner before CM starts.
            # banner_req / banner_byte / banner_done are driven by the UART
            # arbitrator section above; this Elif just holds boot_start low
            # until the banner is fully transmitted.
            with m.Elif(~banner_done):
                pass  # banner logic in UART arbitrator drives the TX

            # Phase 3: banner done — pulse boot_start and latch boot_triggered
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

        # ── ILA debug observation port wiring ─────────────────────────────────
        # Route internal CM signals to the top-level debug output ports so the
        # Vivado ILA (inserted by wukong_xc7a100t.tcl after synthesis) can probe
        # them.  These ports have no physical pin constraints — they are consumed
        # entirely by the on-chip ILA core over the board's built-in JTAG chain.
        m.d.comb += [
            self.dbg_boot_complete.eq(core.boot_complete),
            self.dbg_fault_valid.eq(core.fault_valid),
            self.dbg_nia.eq(core.retire_nia),
            # Pack fault telemetry into a single 32-bit word:
            #   bits[4:0]   = 0 (reserved)
            #   bit[5]      = retire_fault_valid  (fault on this retire pulse)
            #   bits[10:6]  = retire_fault_code   (5-bit fault type)
            #   bits[31:11] = fault_gt[20:0]       (GT word0 of the cap that faulted)
            self.dbg_fault.eq(Cat(
                C(0, 5),                   # bits[4:0]   = reserved
                core.retire_fault_valid,   # bit[5]      = retire_fault_valid
                core.retire_fault_code,    # bits[10:6]  = fault_code
                core.fault_gt[:21],        # bits[31:11] = fault_gt upper 21 bits
            )),
        ]

        return m
