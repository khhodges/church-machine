# Zynq XC7Z010 Pin Verification Checklist

Board: QMTECH ZYJZGW (Zynq XC7Z010CLG400)  
XDC:  `hardware/zynq_xc7z010.xdc`  
Status: **UNVERIFIED** — complete steps below at the bench before first use.

---

## Prerequisites

- QMTECH ZYJZGW schematic PDF (search "QMTECH XC7Z010 ZYJZGW schematic")
- Vivado 2020.x or later, with xc7z010clg400-1 device support
- USB-UART adapter (3.3 V logic — e.g. CP2102 or FT232)
- USB-JTAG programmer (Xilinx Platform Cable or Digilent HS2)

---

## Step 1 — Verify pins against the schematic

Open the QMTECH ZYJZGW schematic and confirm each net below.
Check the box and note the schematic page when confirmed.

### Clock (50 MHz oscillator → PL)

- [ ] Net name `PL_CLK` or `CLK_50M` connects to **H16** (bank 35)
  - Schematic page: ___
  - If different pin found: update `PACKAGE_PIN` for `clk_in` in the XDC

### UART — PMOD JA connector

The PMOD JA connector is a 2×6 header.  Standard pinout (top row left→right):
pin 1, 2, 3, 4 | GND | VCC

- [ ] PMOD JA pin 1 net (`JA1` / `PMOD_JA[0]`) connects to **L15** — used as **TX** (board → host)
  - Schematic page: ___
- [ ] PMOD JA pin 2 net (`JA2` / `PMOD_JA[1]`) connects to **L16** — used as **RX** (host → board)
  - Schematic page: ___
  - If pins are swapped: swap the PACKAGE_PIN values for `uart_tx` and `uart_rx`

### User LEDs (active-LOW, bank 35)

- [ ] `LED0` / `PL_LED0` → **M14**  — schematic page: ___
- [ ] `LED1` / `PL_LED1` → **M15**  — schematic page: ___
- [ ] `LED2` / `PL_LED2` → **G14**  — schematic page: ___
- [ ] `LED3` / `PL_LED3` → **D18**  — schematic page: ___
  - If any LED pin differs: update the matching `PACKAGE_PIN` line in the XDC
  - Note: LEDs are active-LOW on this board (drive low to illuminate)

### Push button KEY1 (active-LOW)

- [ ] `KEY1` / `PL_KEY1` → **R18** (bank 35)
  - Schematic page: ___
  - Check: does the schematic show an external pull-up on this net?
    - If yes: remove `set_property PULLUP true [get_ports push_button]` from the XDC

---

## Step 2 — Build the bitstream

From the project root (requires Vivado on PATH):

```
python hardware/gen_verilog.py zynq          # generates build/church_zynq_xc7z010.v
vivado -mode batch -source hardware/zynq_xc7z010.tcl
```

Output: `vivado_zynq/church_zynq_xc7z010.bit`

Check for timing errors in the implementation log before proceeding.

---

## Step 3 — Program the board

```
vivado -mode batch -source hardware/prog_zynq.tcl   # if you have a prog script
```

Or via the Vivado Hardware Manager GUI:
1. Open Hardware Manager → Connect to board
2. Program device with `vivado_zynq/church_zynq_xc7z010.bit`

---

## Step 4 — Confirm UART output

Connect USB-UART adapter to PMOD JA (pin 1 = TX, pin 2 = RX, GND to GND pin).
Open a serial terminal at **115200 8N1**.

Expected output on power-up / reset:

```
CHURCH Zynq XC7Z010 v1.0
```

- [ ] UART output confirmed

---

## Step 5 — Mark pins verified in the XDC

For each confirmed pin, open `hardware/zynq_xc7z010.xdc` and replace the
`UNVERIFIED` comment above that assignment with a confirmation note, e.g.:

```
# Verified 2026-xx-xx against QMTECH ZYJZGW schematic rev B, page 4.
```

Remove the `[ ]` entries from the VERIFICATION STATUS block at the top of the
XDC as each one is cleared.

---

## Notes

- All PL I/O on this design is bank 35, LVCMOS33 (3.3 V).  Do not connect
  5 V signals to the PMOD or LED headers.
- The Zynq PS (ARM cores) is held in reset and not used by this design.
- If Vivado reports a pin conflict or DRC error on any port, cross-check
  the bank assignment — bank 35 covers roughly F14–R18 on the CLG400 package.
