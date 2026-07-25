# Wukong XC7A100T V3 — Church Machine Port Plan

**Board:** QMTECH Wukong Board V3 (XC7A100T-2FGG676C)  
**Toolchain:** Vivado 2026.1 on droplet `165.227.190.84` (`/opt/Xilinx/2026.1/Vivado/`)  
**Programmer:** xc3sprog + Xilinx Platform Cable USB II on Chromebook  
**JTAG confirmed:** IDCODE `0x13631093` (XA7A100T Rev A) ✅

---

## V3 Board Facts (hardware-confirmed)

All pins confirmed on real hardware via counter-blink diagnostic (two LEDs blinking
at different rates = clock confirmed alive at M21; G21/G20 confirmed as user LEDs).

| Signal  | Pin | Notes                                             |
|---------|-----|---------------------------------------------------|
| `clk`   | M21 | 50 MHz oscillator — IO_L14P_T2_SRCC_34, bank 34 **HARDWARE CONFIRMED** |
| `led[0]`| G21 | User LED D1 — **ACTIVE-LOW** (FPGA low = LED on) **HARDWARE CONFIRMED** |
| `led[1]`| G20 | User LED D2 — **ACTIVE-LOW** (FPGA low = LED on) **HARDWARE CONFIRMED** |
| `rst_n` | M6  | Active-low reset button (Key1)                    |
| `serial_tx` | E3 | UART TX (E3 is **NOT** a clock pin on this board) |
| `serial_rx` | F3 | UART RX                                       |
| Part    | `xc7a100tfgg676-2` | Speed grade -2                      |
| Ethernet| GMII (not RGMII) | RTL8211E-compatible                   |

**Previously wrong pins — do not revert:**
- `clk` = E3 (E3 is UART TX on PCB, not the oscillator), M22 (no oscillator there either)
- `led[0]` = J19, `led[1]` = H19 (not connected to any LED on V3)
- `rst_n` = T2 (not the reset button on V3)

**Physical LED layout:**
- 2 solid LEDs near board edge = power rail indicators (always on, not FPGA-controlled)
- 2 user LEDs near FPGA/JTAG = G21 (led0) and G20 (led1), active-LOW

---

## Critical Amaranth + Vivado BUFG Trap

**Do NOT use `Instance("BUFG", i_I=self.clk, o_O=ClockSignal("sync"))` in Amaranth.**

Vivado's `opt_design` silently drops the explicit BUFG (BUFGCTRL: 1→0 from synth→impl),
leaving all flip-flops unclocked. The counter stays 0, LEDs appear solid regardless of
polarity — a clock-dead symptom that looks like a wrong-LED-pin problem.

**Fix:** Use a direct comb assignment so Vivado auto-infers the IBUF→BUFG chain:

```python
m.domains += ClockDomain("sync")
m.d.comb += ClockSignal("sync").eq(self.clk)   # Vivado infers IBUF→BUFG_inst
```

This creates `clk_IBUF_BUFG_inst` (BUFGCTRL_X0Y0) which is NOT dropped by opt_design.

No `CLOCK_DEDICATED_ROUTE FALSE` constraint is needed — M21 is SRCC and routes through
the dedicated clock path correctly with the auto-inferred chain.

---

## Phase 1 — Minimal LED Blink (COMPLETE ✅)

**Goal:** Prove full build pipeline and confirmed board pins before CM build.

### P1.1 — Fix XDC pin assignments for V3 ✅

**File:** `hardware/wukong_xc7a100t.xdc`

Current state (correct):
```tcl
set_property -dict { PACKAGE_PIN M21  IOSTANDARD LVCMOS33 } [get_ports { clk }];
create_clock -add -name sys_clk_pin -period 20.00 -waveform {0 10} [get_ports { clk }];
set_property -dict { PACKAGE_PIN G21  IOSTANDARD LVCMOS33 } [get_ports { led0 }];
set_property -dict { PACKAGE_PIN G20  IOSTANDARD LVCMOS33 } [get_ports { led1 }];
set_property -dict { PACKAGE_PIN M6   IOSTANDARD LVCMOS33 } [get_ports { rst_n }];
set_false_path -from [get_ports { rst_n }];
```

### P1.2 — Fix TCL build script ✅

**File:** `hardware/wukong_xc7a100t.tcl`

Part = `xc7a100tfgg676-2`, output = `church_wukong_xc7a100t.bit`.

### P1.3 — Fix wukong_top.py for V3 + BUFG + active-LOW LEDs ✅

**File:** `hardware/wukong_top.py`

Key changes confirmed:
- Removed `Instance("BUFG", ...)` — replaced with `m.d.comb += ClockSignal("sync").eq(self.clk)`
- Active-LOW LED mux: boot phase = led0 solid ON, led1 heartbeat blink; running = CM MMIO-controlled with invert
- MMIO comment: G21/G20 pins, ACTIVE-LOW noted
- `rst_n` declared as port (M6, XDC constrained) but intentionally unconnected to soft reset for now

### P1.4 — Generate Verilog from Amaranth ✅

**Command:**
```bash
python -m hardware.gen_rtlil --wukong
```

**Output:** `build/church_wukong_xc7a100t.v` — 76,051 lines, 2.6 MB, clean (no $macc/$alu cells).

### P1.5 — Transfer build files to droplet ✅

```bash
scp build/church_wukong_xc7a100t.v hardware/wukong_xc7a100t.xdc root@165.227.190.84:~/wukong_build/
```

### P1.6 — Synthesise + Implement on droplet (Vivado) ✅ (diagnostic) / 🔄 (CM build running)

**Diagnostic build (counter blink) — VERIFIED on hardware:**
- M21 clock alive (both LEDs blinked)
- G21/G20 are the correct user LED pins

**CM build — in progress (tmux session `vivado_cm`):**
```bash
cd ~/wukong_build
source /opt/Xilinx/2026.1/Vivado/settings64.sh
vivado -mode batch -source wukong_xc7a100t.tcl > vivado_cm.log 2>&1
```

Expected duration: 30–60 min (full CM design, 76K-line Verilog).

**Tests:**
1. `grep -E "write_bitstream complete|ERROR" ~/wukong_build/vivado_cm.log` — no ERROR, complete line present.
2. `grep "WNS" ~/wukong_build/vivado_cm.log` — WNS ≥ 0.0 ns.
3. `ls -lh ~/wukong_build/church_wukong_xc7a100t.bit` — file updated (newer timestamp than diagnostic build).

### P1.7 — Transfer bitstream to Chromebook ☐

```bash
scp root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit ~/
```

Or fetch from IDE download endpoint: `GET /dl/wukong-bit` (served from `build/church_wukong_xc7a100t.bit`
after `scp` back to Replit).

### P1.8 — Program the board with xc3sprog ☐

**Prerequisites:** Platform Cable USB II plugged into Chromebook, Wukong powered.

```bash
sudo xc3sprog -c xpc -p 0 -v ~/church_wukong_xc7a100t.bit
```

JTAG IDCODE = `0x13631093` (XA7A100T FGG676). Command exits 0.

### P1.9 — Verify LED behaviour on physical board ☐

Expected after CM bitstream is flashed:

| Time         | `led[0]` (G21)            | `led[1]` (G20)              |
|--------------|---------------------------|-----------------------------|
| Boot (~16 cyc POR) | Solid ON (active-LOW driven 0) | 1 Hz heartbeat blink |
| Running      | CM MMIO reg 0 bit 0 (inverted) | Solid ON (no fault) |
| Fault        | CM MMIO-controlled        | Solid ON (fault_latched=1 → ~1=0 LOW → ON) |

**Pass:** Boot→running transition within ~1 second of programming.  
**Fail (clock dead):** Both LEDs solid, no blink ever → M21 not clocking (should not happen — hardware confirmed).  
**Fail (boot stalled):** led0 solid ON, led1 keeps blinking indefinitely → boot_start never asserted or CM fault at step B:01.

---

## Phase 2 — UART / USB-Serial Callhome (Optional bridge)

**Goal:** Get a callhome packet reaching the server over a USB-serial bridge
(same pattern as Ti60) before committing to the Ethernet MAC port. Skip if
Ethernet proves easier.

> **Note:** The Wukong V3 has no onboard USB-UART bridge. This phase requires
> a 3.3 V FTDI/CP2102 dongle connected to spare FPGA GPIO pins. If no dongle
> is available, go directly to Phase 3.

### P2.1 — Identify spare GPIO pins for UART TX ☐

Pick two available LVCMOS33 pins not used by LEDs/clock/button. Candidates
(from the FGG676 package, IO bank 14/15): document chosen pins here before
editing XDC.

### P2.2 — Add UART TX to wukong_top.py ☐

Wire a minimal UART-TX module (reuse `hardware/uart_tx.py`) to the CM UART
capability. Baud 57600 (matches existing callhome bridge).

**Test:** Connect dongle, run `python server/callhome_bridge.py --port /dev/ttyUSB0 --baud 57600`,
observe callhome packet appearing in IDE dashboard within 60 s of power-on.

---

## Phase 3 — GMII Ethernet Callhome

**Goal:** Replace RGMII MAC with GMII, get UDP callhome packet reaching the
server over Ethernet. This is the proper long-term callhome path for the Wukong.

### P3.1 — Audit V3 Ethernet pins ☐

The Wukong V3 uses GMII (not RGMII) with an RTL8211E PHY. Audit the schematic
to confirm actual GMII pin assignments and document them here before any code changes.

**Required pin list:** CLK, TX_CLK, TXD[7:0], TX_EN, TX_ER, RX_CLK, RXD[7:0],
RX_DV, RX_ER, MDC, MDIO, RSTN.

### P3.2 — Write gmii_mac.py ☐

Create `hardware/gmii_mac.py` — a GMII MAC that sends periodic UDP callhome
frames. Derive from `hardware/rgmii_mac.py` but:
- Remove DDR RGMII TX/RX logic (GMII is single-edge 8-bit)
- Remove nibble-to-byte conversion (GMII is already 8-bit)
- Keep ARP reply and UDP TX state machines unchanged

### P3.3 — Create wukong_ethernet_v3.py (new file) ☐

> **Note:** `hardware/wukong_xc7a100t.py` was the orphaned v1.1 Ethernet top-level
> (200 MHz W19 clock, RTL8211E RGMII). It was never wired into the build pipeline
> (`gen_rtlil.py` always imported from `wukong_top.py`) and has been deleted to
> prevent build mix-ups. Do not restore it.

Create a new `hardware/wukong_ethernet_v3.py` top-level for the full V3 Ethernet
build (keep `wukong_top.py` as the LED-blink / UART-only build target):
- MMCM input: `p_CLKIN1_PERIOD = 20.0` (50 MHz input from M21)
- MMCM multiplier adjusted for 1 GHz VCO target
- Wire `GmiiMac` (from P3.2) into CM MMIO EthernetDevice capability
- Update XDC with confirmed GMII pin names (from P3.1)

### P3.4 — XDC for full Ethernet build ☐

Add GMII pin constraints to `wukong_xc7a100t.xdc` (separate `_eth` block).
Set IOSTANDARD to LVCMOS33. Add `set_input_delay` / `set_output_delay` for GMII timing.

### P3.5 — End-to-end callhome test ☐

1. Power on Wukong with Ethernet cable plugged into router/switch.
2. Wait ≤ 60 s.
3. IDE Dashboard → Boards panel shows Wukong board entry.
4. Server logs show UDP callhome packet from correct MAC address.

---

## Build Pipeline Quick Reference

```
┌─────────────────┐        scp           ┌────────────────────┐
│   Replit        │ ──────────────────→  │   Droplet          │
│                 │  .v + .xdc + .tcl    │  165.227.190.84    │
│  gen_rtlil.py  │                       │  Vivado 2026.1     │
│  --wukong       │ ←───────────────────  │  → .bit            │
└─────────────────┘        scp .bit       └────────────────────┘
                                                   │
                                              scp .bit
                                                   ↓
                                         ┌────────────────────┐
                                         │  Chromebook        │
                                         │  xc3sprog -c xpc   │
                                         │  → Wukong board    │
                                         └────────────────────┘
```

### Key commands

| Step | Location | Command |
|------|----------|---------|
| Generate Verilog | Replit | `python -m hardware.gen_rtlil --wukong` |
| Push to droplet | Replit | `scp build/church_wukong_xc7a100t.v hardware/wukong_xc7a100t.xdc root@165.227.190.84:~/wukong_build/` |
| Source Vivado | Droplet | `source /opt/Xilinx/2026.1/Vivado/settings64.sh` |
| Build bitstream | Droplet | `cd ~/wukong_build && tmux new-session -d -s vivado_cm 'vivado -mode batch -source wukong_xc7a100t.tcl > vivado_cm.log 2>&1; echo EXIT_$? >> vivado_cm.log'` |
| Check progress | Droplet | `tail -5 ~/wukong_build/vivado_cm.log` |
| Fetch bitstream | Replit | `scp root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit build/` |
| Detect board | Chromebook | `xc3sprog -c xpc -j` (IDCODE=0x13631093) |
| Program board | Chromebook | `sudo xc3sprog -c xpc -p 0 -v ~/church_wukong_xc7a100t.bit` |
| Serve bitstream | IDE | `GET /dl/wukong-bit` (requires board to hit endpoint) |

---

## Progress Tracker

| Step | Status | Notes |
|------|--------|-------|
| JTAG detect | ✅ | IDCODE 0x13631093, XA7A100T FGG676 |
| P1.1 XDC pins | ✅ | M21, G21, G20, M6 — HARDWARE CONFIRMED |
| P1.2 TCL fix | ✅ | Part xc7a100tfgg676-2, xc3sprog |
| P1.3 wukong_top.py | ✅ | BUFG fix, active-LOW LED mux, M21/G21/G20 |
| P1.4 Verilog regen | ✅ | 76K lines, 2.6 MB, clean |
| P1.5 Transfer to droplet | ✅ | scp |
| P1.6 Diagnostic build | ✅ | Counter blink — M21/G21/G20 hardware confirmed |
| P1.6 CM build (V1, LED-only) | ✅ | EXIT_0, write_bitstream complete, 3,826,002 bytes |
| P1.6 CM build (V2, UART+LED) | ✅ | EXIT_0, WNS=3.593 ns, 3,736,048 bytes — Jul 25 2026 |
| P1.6 CM build (V4, TraceUnit+UartRx) | ✅ | EXIT_0, WNS=1.791 ns (final route), 3,736,048 bytes — Jul 25 2026; uart_rx_pin (F3) + TraceUnit in build |
| P1.7 Bitstream to Chromebook | ✅ | `build/church_wukong_xc7a100t.bit` in repo; `/dl/wukong-bit` endpoint live |
| P1.8 Program board | ✅ | xc3sprog confirmed (V1); re-flash with V4 bit (uart_rx_pin live) |
| P1.9 LED + UART behaviour | ☐ | Flash V4 bit; confirm 's' cmd → 0xAA trace packet on F3 bridge |
| P2 UART callhome (CH340) | ✅ | UART TX wired to E3 (LVCMOS33); baud 57600; NUC_PROGRAM sends repeating banner |
| P2b Single-step trace (UART RX) | ✅ | F3 RX wired (LVCMOS33); TraceUnit emits 11-byte 0xAA packets on every retire; command parser handles s/r/h/b; 4-NIA breakpoints; IDE polls /hardware/wukong/trace |
| P3.1 GMII pin audit | ☐ | Needs schematic |
| P3.2 gmii_mac.py | ☐ | New file |
| P3.3 wukong_ethernet_v3.py | ☐ | New file; old wukong_xc7a100t.py (v1.1 orphan) deleted |
| P3.4 XDC Ethernet | ☐ | GMII timing |
| P3.5 End-to-end callhome | ☐ | IDE dashboard |

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| Vivado drops explicit BUFG | Never use `Instance("BUFG", ...)` in Amaranth for Vivado; use `m.d.comb += ClockSignal("sync").eq(self.clk)` |
| V3 Ethernet pins not documented | Audit schematic before P3 — do not guess |
| GMII timing closure at 100 MHz | Use MMCM (already present), verify WNS ≥ 0 |
| xc3sprog -c xpc hangs | Replug cable, re-enable in Crostini USB settings |
| Crostini loses USB device on sleep | `lsusb` to confirm, toggle in Linux settings |
| Vivado licence expires | BASIC licence valid until 2027-06-27 |
| rst_n Vivado warning | Intentional — constrained but unconnected, `set_false_path` in XDC silences timing errors |
