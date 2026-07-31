---
name: Ti60 SoC UART clockDivider
description: Sapphire SoC UART baud config for Ti60F225. Wukong A7 uses Amaranth UartTx with parameterized divisor — NO CLOCKDIV register involved.
---

## ⚠️ Wukong A7 — completely different mechanism

The Wukong uses Amaranth `UartTx(clk_freq=50_000_000, baud=57_600)`.
Divisor is computed at elaboration time: `divisor = 50_000_000 // 57_600 = 868`.
Actual baud = 57,603.7 Hz (0.006% error). There is **no CLOCKDIV register** — the
Amaranth module embeds the counter at synthesis. The Ti60 CLOCKDIV=53 figure below
is **Ti60 Sapphire RISC-V firmware only** and has nothing to do with the Wukong.

## Clock Architecture (Ti60F225 Devkit) — CONFIRMED WORKING

The Ti60F225 devkit has THREE oscillators (from devkit UG v2.6 Table 1):

| Oscillator | Pin | PLL |
|---|---|---|
| **25 MHz** | **GPIOL_P_18_PLLIN0** | **PLL_TL0** |
| 33.3333 MHz | GPIOL_P_00_PLLIN0 | PLL_BL0 |
| 74.25 MHz | GPIOT_P_17_PLLIN1 | PLL_TR0 |

**GPIOL_P_18 is a PLL INPUT pin — it CANNOT drive CLKMUX directly.**
Any attempt to route GPIOL_P_18 through CLKMUX_T, CLKMUX_L, or any CLKMUX
always produces PCR_*_EN=DISABLE. The Interface Designer silently ignores it
because it's not a clock-capable GPIO pin.

**The intended (target) clock chain:**
```
25 MHz → GPIOL_P_18_PLLIN0 → PLL_TL0 (×20, pre_div=1, post_div=1, out_div=10)
       → 50 MHz top.clk
```

**CONFIRMED WORKING (Jun 2026):** When PLL_TL0 is NOT instantiated in peri.xml,
the FPGA receives the raw 25 MHz crystal directly. The sapphire.v in the current
project has NO internal PLL — `io_systemClk` is routed straight through to all
submodules. Therefore:

- **System clock = 25 MHz** (when PLL not configured)
- **CLOCKDIV=53 → 57,600 baud** (25,000,000 / (8×54) = 57,870 ≈ 57,600)
- **Confirmed:** `CHURCH Ti60 SoC+CM v1.1` + full boot sequence visible at 57600 baud on ttyUSB2

**When PLL_TL0 is correctly configured** (peri.xml has `<efxpt:pll_info>` with PLL_TL0):
- System clock = 50 MHz
- CLOCKDIV=53 → 115,200 baud

**Why:** GPIOL_P_18 is labeled `_PLLIN0` in the device architecture — it's wired
directly to PLL_TL0's reference input, not to the global clock multiplexer.
peri.xml must have `<efxpt:pll_info>` with PLL_TL0 configured — not a GPIO
clock, not OSC_0. The `<efxpt:pll_info/>` (empty) peri.xml is the root cause of
all clock failures.

## UART CLOCKDIV rule

The Sapphire SoC UART `clockDivider` register resets to **0x00** on power-up.
Firmware **must** write `UART_CLOCKDIV` before the first `uart_puts()` call.

**Without CLOCKDIV write:** UART runs at reset default (CLOCKDIV=0) = clk/8 = 3.125 Mbaud → silence.

Baud rate formula: `baudRate = ClkIn / (8 × (clockDivider + 1))`

### soc_minimal project (hardware/soc_minimal/firmware/main.c)
- UART_BASE = `0xF0010000` (standard Sapphire SoC minimal)
- UART_CLOCKDIV = `*(0xF0010000 + 0x08)`
- **Target: 115200 baud at 25 MHz → `clockDivider = 26`**
  - 25,000,000 / (8 × 27) = 115,741 ≈ 115,200 ✓

### church_soc_cm project (full SoC+CM)
- UART_BASE = `0xF8010000`
- UART_CLOCKDIV = `*(0xF8010000 + 0x08)`
- **Target: 57,600 baud at 25 MHz (no PLL) → `clockDivider = 53`**
  - 25,000,000 / (8 × 54) = 57,870 ≈ 57,600 ✓
- With PLL (50 MHz) → 115,200 baud: `clockDivider = 53`
  - 50,000,000 / (8 × 54) = 115,741 ≈ 115,200 ✓

## Efinity build flow — CONFIRMED WORKING sequence (Penguin, Jun 2026)

```bash
export EFINITY_HOME=/home/sipantichijk/efinity/2025.2
export PYTHONHOME=$EFINITY_HOME
export EFINITY_USER_DIR_INI=/home/sipantichijk/.local/share/efinity/user_dir.ini
export EFXPT_HOME=$EFINITY_HOME/pt
source $EFINITY_HOME/bin/setup.sh

cd ~/church_project/SoC

# CRITICAL: patch sapphire.v with firmware BRAM data BEFORE synthesis
python3 scripts/patch_sapphire_init.py sapphire.v \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin

# Synthesis
python3 $EFINITY_HOME/scripts/efx_run.py --flow map --work_dir work_syn --prj church_soc_cm.xml

# PNR — must use efx_pnr directly, NOT efx_run -f pnr
/home/sipantichijk/efinity/2025.2/bin/efx_pnr \
  --circuit church_soc_cm --family Titanium --device Ti60F225 \
  --operating_conditions C3 \
  --vdb_file outflow/church_soc_cm.vdb --use_vdb_file on \
  --prj church_soc_cm.xml --output_dir outflow --work_dir work_pnr \
  --place_file outflow/church_soc_cm.place --route_file outflow/church_soc_cm.route \
  --sdc_file church_soc_cm.sdc \
  --sync_file outflow/church_soc_cm.interface.csv

# Bitstream
python3 $EFINITY_HOME/scripts/efx_run.py --flow pgm --prj church_soc_cm.xml
```

## Flash and UART check

```bash
# Flash FPGA config
unset PYTHONHOME
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex

# UART — 57600 baud (25 MHz clock, CLOCKDIV=53)
stty -F /dev/ttyUSB2 57600 raw -echo && cat /dev/ttyUSB2
# Expected: "CHURCH Ti60 SoC+CM v1.1" then countdown then NIA/CALLHOME
```

## SDC must be referenced by absolute path in church_soc_cm.xml

```xml
<efx:sdc_file name="/home/sipantichijk/church_project/SoC/church_soc_cm.sdc" />
```

Relative path ("church_soc_cm.sdc") is silently ignored — pnr falls back to 1 ns default
constraint and reports timing failure even though the design meets 20 ns easily.

## BRAM layout

```
0xF9000000 — BRAM start (8 KB confirmed working)
0xF9002000 — BRAM end / stack top (_stack_top in link.ld)
0xF8010000 — UART_BASE (UART_DATA +0, UART_STATUS +4, UART_CLOCKDIV +8)
0xF8100000 — CM APB3 bridge
```
