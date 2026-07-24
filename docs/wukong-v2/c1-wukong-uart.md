# C1 — Add UART to Wukong for IDE Communication

## Priority
**Critical** — V2 bitstream cannot communicate with the Church Machine IDE without this.

## Root Cause
`hardware/wukong_top.py` has no UART ports. The QMTECH Wukong V3 board has a CH340
USB-UART bridge chip physically present (same connector used by the Ti60's callhome
bridge), but the current minimal top-level never instantiates TX/RX logic or assigns
the relevant XDC pins.

Without UART:
- The board cannot call home to the IDE.
- The IDE cannot upload a boot image.
- The IDE cannot deploy any CLOOMC program.

## Baud Rate Calculation (50 MHz oscillator)
The Ti60 callhome bridge uses baud = 57 600 with a 25 MHz SoC clock:
  CLOCKDIV = (25 000 000 / 57 600 / 8) − 1 ≈ 53

Wukong oscillator is **50 MHz**:
  CLOCKDIV = (50 000 000 / 57 600 / 8) − 1 ≈ 107.5  → use 108 (0.46 % error, within
  UART tolerance).

The same 57 600 baud matches the existing IDE `BAUD_RATE` constant in
`server/callhome.py` and the Pi/Chromebook bridge scripts.

## Files to Change

| File | Change |
|------|--------|
| `hardware/wukong_top.py` | Add `uart_tx` (out) and `uart_rx` (in) ports; instantiate a simple 8N1 UART TX/RX module; wire the callhome encoder into TX |
| `hardware/wukong_xc7a100t.xdc` | Add `set_property PACKAGE_PIN` lines for UART TX and RX pins (see pinout note below) |
| `hardware/boot_rom.py` | `DEMO_NAMESPACE` slot 2 (`UART_DEV`) already exists with location `0x40000014`; verify the Wukong UART MMIO register map matches that offset |
| `hardware/gen_rtlil.py` | No change needed — already generates from `wukong_top.py` |

## Wukong V3 UART Pin Assignment
**Hardware-confirmed** — the CH340 USB-UART bridge is physically present on the board
(USB socket visible). The FPGA-side pins are:
- UART_TX (FPGA output → CH340 RX): **E3**  (bank 34, LVCMOS33)
- UART_RX (CH340 TX → FPGA input):  **F3**  (bank 34, LVCMOS33)

Note: E3 was previously mis-used as the clock pin in an early bitstream. E3 is **not**
a clock-capable pin — it is the UART TX trace on the PCB. The correct clock pin is M21.

Add to `hardware/wukong_xc7a100t.xdc` (create if it doesn't exist):
```
set_property PACKAGE_PIN E3 [get_ports uart_tx]
set_property IOSTANDARD LVCMOS33 [get_ports uart_tx]
set_property PACKAGE_PIN F3 [get_ports uart_rx]
set_property IOSTANDARD LVCMOS33 [get_ports uart_rx]
```

## UART TX Implementation Approach
The Ti60 uses the Sapphire SoC RISC-V firmware to drive UART. The Wukong has no
SoC, so the UART must be driven directly by the Church Machine core via MMIO.

Add a minimal 8N1 UART TX block (pure Amaranth RTL) to `wukong_top.py`:
- MMIO register at offset `0x40000014` (word 5 = existing UART_DEV location)
  - Write: enqueue a byte to send
  - Read bit 0: TX FIFO full flag
- 8-deep TX FIFO (single shift register is acceptable for callhome)
- Baud divider = 108 (50 MHz / 57 600 / 8 oversampling)

The callhome message format is already defined in `server/callhome.py`. NUC_PROGRAM
(or the IDE-deployed boot image) will DWRITE the callhome packet bytes to the UART
MMIO register in sequence.

## MMIO Register Map After This Change

| Reg | Offset | Description |
|-----|--------|-------------|
| 0 | 0x40000000 | LED0_RGB |
| 1 | 0x40000004 | LED1_RGB |
| 2 | 0x40000008 | LED2_RGB (no pin, placeholder) |
| 3 | 0x4000000C | (reserved) |
| 4 | 0x40000010 | (reserved) |
| 5 | 0x40000014 | UART_TX_DATA / UART_STATUS (matches UART_DEV location) |
| 11–15 | 0x4000002C–... | Timer (unchanged) |

## Acceptance Criteria
1. `hardware/gen_rtlil.py` runs to completion; `build/church_wukong_xc7a100t.v` contains
   a UART TX module and the `uart_tx`/`uart_rx` ports.
2. Vivado synthesis passes without unassigned I/O errors on the UART pins.
3. The UART_DEV MMIO address in `DEMO_NAMESPACE` slot 2 matches the new register offset.
4. A `hardware/test_wukong_uart.py` Amaranth simulation test verifies that DWRITEing
   a byte to MMIO reg 5 eventually clocks out the correct 8N1 bit sequence on `uart_tx`.

## Risks
- **Pin assignment**: Wukong schematic must be consulted to confirm D3/C4. Wrong pins
  → TX idles, board is silent, Vivado produces a DRC warning not an error.
- **FIFO depth**: An 8-deep FIFO is sufficient for single-byte callhome pings. For
  streaming output (e.g. program trace), a deeper FIFO may be needed later.
- **BAUD drift**: The 0.46 % error at CLOCKDIV=108 is within UART spec. Confirm with a
  logic analyser or scope if the board is silent after synthesis.

## Depends On
C2 (BOOT_PROGRAM fix) and C3 (NS address fix) must land alongside or after C1 for the
full callhome flow to work end-to-end, but C1 can be developed and tested independently
via simulation.
