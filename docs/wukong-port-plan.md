# Wukong XC7A100T V3 — Church Machine Port Plan

**Board:** QMTECH Wukong Board V3 (XC7A100T-2FGG676C)  
**Toolchain:** Vivado 2026.1 on droplet `165.227.190.84` (`/opt/Xilinx/2026.1/Vivado/`)  
**Programmer:** xc3sprog + Xilinx Platform Cable USB II on Chromebook  
**JTAG confirmed:** IDCODE `0x13631093` (XA7A100T Rev A) ✅

---

## V3 Board Facts (locked — LiteX-verified)

Source: `litex-hub/litex-boards` `qmtech_wukong.py` `_io_v3` block, tested on real hardware.

| Signal  | Pin | Notes                                             |
|---------|-----|---------------------------------------------------|
| `clk`   | M21 | 50 MHz oscillator (MRCC-capable, bank 34)         |
| `led[0]`| G21 | User LED D1                                       |
| `led[1]`| G20 | User LED D2                                       |
| `rst_n` | M6  | Active-low reset button (Key1)                    |
| `btn`   | H7  | User button (Key0)                                |
| `serial_tx` | E3 | UART TX (E3 is **NOT** a clock pin on this board) |
| `serial_rx` | F3 | UART RX                                       |
| Part    | `xc7a100tfgg676-2` | Speed grade -2                      |
| Ethernet| GMII (not RGMII) | RTL8211E-compatible                   |

**Previously wrong pins (J19/H19 for LEDs, E3 for clock, T2 for reset) — do not revert.**
E3 is wired to a UART transceiver on the PCB, not the 50 MHz oscillator.

The 2 solid LEDs near the board edge = power rail indicators (not FPGA-controlled).
The 2 soft LEDs near FPGA/JTAG = DONE LED + user LED D1 at G21 (or D1+D2 at G21/G20).

---

## Phase 1 — Minimal LED Blink (Toolchain + Hardware Verified)

**Goal:** Get `wukong_top.py` (LED-only, no Ethernet) synthesised, placed,
routed, and running on the physical board. Proves the full build pipeline works
end-to-end before touching any Ethernet logic.

### P1.1 — Fix XDC pin assignments for V3

**File:** `hardware/wukong_xc7a100t.xdc`

Changes required:
- Clock pin: `H4` → `E3`
- `led0` pin: `J4` → `J19`
- `led1` pin: `H6` → `H19`
- Part comment: `-1` → `-2`

**Test:** `grep PACKAGE_PIN hardware/wukong_xc7a100t.xdc` must show `E3`, `J19`, `H19`. No `H4`, `J4`, or `H6` anywhere.

### P1.2 — Fix TCL build script

**File:** `hardware/wukong_xc7a100t.tcl`

Changes required:
- `set PART "xc7a100tfgg676-1"` → `"xc7a100tfgg676-2"`
- Update LED comments to reference J19 / H19
- Update programming section to show `xc3sprog` command (not OpenOCD)
- Add Vivado path note: `/opt/Xilinx/2026.1/Vivado/settings64.sh`

**Test:** `grep -E "PART|xc3sprog" hardware/wukong_xc7a100t.tcl` shows `-2` and `xc3sprog`.

### P1.3 — Fix wukong_top.py docstring for V3

**File:** `hardware/wukong_top.py`

Changes required (docstring only — code has no hardcoded pins):
- All pin references: H4→E3, J4→J19, H6→H19
- Part string: `xc7a100tfgg676-1C` → `xc7a100tfgg676-2`

**Test:** `grep -E "H4|J4|H6|-1FGG" hardware/wukong_top.py` returns nothing.

### P1.4 — Generate Verilog from Amaranth (on Replit)

**Command:**
```bash
python -m hardware.gen_rtlil --wukong
```

**Output:** `build/church_wukong_xc7a100t.v`

**Test:** File exists and contains `module church_wukong_xc7a100t`. No Python
errors or Amaranth warnings about undriven signals.

### P1.5 — Transfer build files to droplet

**Command (from Replit shell):**
```bash
DROPLET=165.227.190.84
rsync -avz build/church_wukong_xc7a100t.v \
           hardware/wukong_xc7a100t.xdc \
           hardware/wukong_xc7a100t.tcl \
      root@$DROPLET:~/wukong_build/
```

**Test:** `ssh root@$DROPLET ls ~/wukong_build/` shows all three files with
today's timestamp.

### P1.6 — Synthesise + Implement on droplet (Vivado)

**Command (on droplet, inside tmux):**
```bash
source /opt/Xilinx/2026.1/Vivado/settings64.sh
cd ~/wukong_build
vivado -mode batch -source wukong_xc7a100t.tcl 2>&1 | tee vivado_build.log
```

Expected duration: 15–30 min (Artix-7, small design).

**Tests:**
1. `grep "Synthesis complete\|Implementation complete" vivado_build.log` — both lines present.
2. `grep "Timing clean\|WNS" vivado_build.log` — WNS ≥ 0.0 ns (must not be negative at 50 MHz).
3. `ls ~/wukong_build/church_wukong_xc7a100t.bit` — file exists, size ≥ 1 MB.

**Failure paths:**
- Synthesis error → check `vivado_wukong/church_wukong_xc7a100t.runs/synth_1/*.log`
- Timing violation → WNS < 0 is a warning only at 50 MHz; investigate if < −1 ns

### P1.7 — Transfer bitstream to Chromebook

**Command (on Chromebook):**
```bash
scp root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit ~/
```

**Test:** `ls -lh ~/church_wukong_xc7a100t.bit` shows file present.

### P1.8 — Program the board with xc3sprog

**Prerequisites:** Platform Cable USB II plugged into Chromebook, Wukong powered.

**Command (on Chromebook):**
```bash
xc3sprog -c xpc -p 0 ~/church_wukong_xc7a100t.bit
```

**Tests:**
1. Command exits 0.
2. `xc3sprog -c xpc -j` after programming still shows `XA7A100T` (board alive).

### P1.9 — Verify LED behaviour on physical board

| Time         | `led[0]` (J19)          | `led[1]` (H19)         |
|--------------|-------------------------|------------------------|
| Boot (~µs)   | Solid ON                | 1 Hz heartbeat blink   |
| Running      | Blinks ~1 Hz (NUC_PROGRAM LED demo) | Solid OFF |
| Fault        | Any                     | Solid ON (fault latched) |

**Pass criterion:** Observe the boot→running transition within 1–2 seconds of programming.
If `led[0]` stays solid and `led[1]` keeps blinking indefinitely → boot stalled (check fault path).

---

## Phase 2 — UART / USB-Serial Callhome (Optional bridge)

**Goal:** Get a callhome packet reaching the server over a USB-serial bridge
(same pattern as Ti60) before committing to the Ethernet MAC port. Skip if
Ethernet proves easier.

> **Note:** The Wukong V3 has no onboard USB-UART bridge. This phase requires
> a 3.3 V FTDI/CP2102 dongle connected to spare FPGA GPIO pins. If no dongle
> is available, go directly to Phase 3.

### P2.1 — Identify spare GPIO pins for UART TX

Pick two available LVCMOS33 pins not used by LEDs/clock/button. Candidates
(from the FGG676 package, IO bank 14/15): document chosen pins here before
editing XDC.

**Test:** `xc3sprog -c xpc -j` shows board still alive after new XDC applied.

### P2.2 — Add UART TX to wukong_top.py

Wire a minimal UART-TX module (reuse `hardware/uart_tx.py`) to the CM UART
capability. Baud 57600 (matches existing callhome bridge).

**Test:** Connect dongle, run `python server/callhome_bridge.py --port /dev/ttyUSB0 --baud 57600`, observe callhome packet appearing in IDE dashboard within 60 s of power-on.

---

## Phase 3 — GMII Ethernet Callhome

**Goal:** Replace RGMII MAC with GMII, get UDP callhome packet reaching the
server over Ethernet. This is the proper long-term callhome path for the Wukong.

### P3.1 — Audit V3 Ethernet pins

The existing `hardware/wukong_xc7a100t.py` docstring lists RGMII pin names
and `W19` as the 200 MHz clock — both wrong for V3. Audit schematic / confirm
actual GMII pin assignments and document them here before any code changes.

**Required pin list:** CLK, TX_CLK, TXD[7:0], TX_EN, TX_ER, RX_CLK, RXD[7:0],
RX_DV, RX_ER, MDC, MDIO, RSTN.

### P3.2 — Write gmii_mac.py

Create `hardware/gmii_mac.py` — a GMII MAC that sends periodic UDP callhome
frames. Derive from `hardware/rgmii_mac.py` but:
- Remove DDR RGMII TX/RX logic (GMII is single-edge 8-bit)
- Remove nibble-to-byte conversion (GMII is already 8-bit)
- Keep ARP reply and UDP TX state machines unchanged

**Test (simulation):** Unit test that drives mock GMII RX with an ARP request
and checks the module replies with a correct ARP response.

### P3.3 — Update wukong_xc7a100t.py for V3 / GMII

Changes:
- MMCM input: `p_CLKIN1_PERIOD = 5.0` (200 MHz) → `20.0` (50 MHz)
- MMCM multiplier: `CLKFBOUT_MULT_F = 5.0` → `20.0` (VCO = 50 × 20 = 1000 MHz)
- Port rename: `clk_200mhz` → `clk`
- Replace `RgmiiMac` → `GmiiMac`
- Update XDC with confirmed GMII pin names

**Test (synthesis):** Vivado reports no unconnected ports, timing clean.

### P3.4 — XDC for full Ethernet build

Add GMII pin constraints to `wukong_xc7a100t.xdc` (separate `_eth` block).
Set IOSTANDARD to LVCMOS33. Add `set_input_delay` / `set_output_delay` for
GMII timing.

### P3.5 — End-to-end callhome test

1. Power on Wukong with Ethernet cable plugged into router/switch.
2. Wait ≤ 60 s.
3. IDE Dashboard → Boards panel shows Wukong board entry.
4. Server logs show UDP callhome packet from correct MAC address.

---

## Build Pipeline Quick Reference

```
┌─────────────────┐        rsync         ┌────────────────────┐
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
| Push to droplet | Replit | `rsync -avz build/*.v hardware/wukong*.xdc hardware/wukong*.tcl root@165.227.190.84:~/wukong_build/` |
| Source Vivado | Droplet | `source /opt/Xilinx/2026.1/Vivado/settings64.sh` |
| Build bitstream | Droplet | `cd ~/wukong_build && vivado -mode batch -source wukong_xc7a100t.tcl` |
| Fetch bitstream | Chromebook | `scp root@165.227.190.84:~/wukong_build/church_wukong_xc7a100t.bit ~/` |
| Detect board | Chromebook | `xc3sprog -c xpc -j` |
| Program board | Chromebook | `xc3sprog -c xpc -p 0 ~/church_wukong_xc7a100t.bit` |

---

## Progress Tracker

| Step | Status | Notes |
|------|--------|-------|
| P1.1 XDC pin fix | ✅ | E3, J19, H19, -2 |
| P1.2 TCL fix | ✅ | Part -2, xc3sprog |
| P1.3 wukong_top.py docstring | ✅ | All old pins removed |
| P1.4 Verilog generation | ✅ | 6.5 MB, 142k lines, clean |
| P1.5 Transfer to droplet | ✅ | GitHub sync (6a1d0550) |
| P1.6 Vivado synth + impl | ✅ | WNS=0.000 ns, 12 min |
| P1.7 Bitstream to Chromebook | ☐ | scp |
| P1.8 Program board | ☐ | xc3sprog |
| P1.9 LED behaviour verified | ☐ | Visual check |
| P2 UART callhome | ☐ | Skip if no FTDI dongle |
| P3.1 GMII pin audit | ☐ | Needs schematic |
| P3.2 gmii_mac.py | ☐ | New file |
| P3.3 wukong_xc7a100t.py V3 | ☐ | 50MHz MMCM + GMII |
| P3.4 XDC Ethernet | ☐ | GMII timing |
| P3.5 End-to-end callhome | ☐ | IDE dashboard |

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| V3 Ethernet pins not documented | Audit schematic before P3 — do not guess |
| GMII timing closure at 100 MHz | Use MMCM (already present), verify WNS ≥ 0 |
| xc3sprog -c xpc hangs | Replug cable, re-enable in Crostini USB settings |
| Crostini loses USB device on sleep | `lsusb` to confirm, toggle in Linux settings |
| Vivado licence expires | BASIC licence valid until 2027-06-27 |
