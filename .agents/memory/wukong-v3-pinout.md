---
name: QMTECH Wukong V3 XC7A100T FGG676 pin assignments
description: Correct FPGA pin assignments for QMTECH Wukong V3 board — do NOT revert to old wrong pins
---

# QMTECH Wukong V3 (XC7A100T-2FGG676C) Correct Pins

**Source:** LiteX litex-hub/litex-boards `qmtech_wukong.py` `_io_v3` block — community-verified on real hardware.

## Pin Table

| Signal      | Pin  | Notes |
|-------------|------|-------|
| `clk`       | M21  | 50 MHz oscillator, MRCC-capable bank-34 pin |
| `led[0]`    | G21  | User LED D1 |
| `led[1]`    | G20  | User LED D2 |
| `rst_n`     | M6   | Active-low reset button (Key1) |
| `btn`       | H7   | User button (Key0) |
| `serial_tx` | E3   | UART TX — **E3 is NOT a clock pin on this board** |
| `serial_rx` | F3   | UART RX |

## Wrong Pins (do not revert)

The design originally used these WRONG assignments:
- `clk` = E3 (E3 is UART TX on the PCB, wired to a UART transceiver, not the oscillator)
- `led[0]` = J19 (not connected to any LED on V3)
- `led[1]` = H19 (not connected to any LED on V3)
- `rst_n` = T2 (not the reset button on V3)

## Board LED Layout (physical)

- 2 solid LEDs near board edge = power rail indicators (not FPGA-controlled, always on)
- 2 soft LEDs near FPGA/JTAG = DONE LED + user LEDs at G21/G20

## XDC Template

```tcl
set_property -dict { PACKAGE_PIN M21  IOSTANDARD LVCMOS33 } [get_ports { clk }];
create_clock -add -name sys_clk_pin -period 20.00 -waveform {0 10} [get_ports { clk }];
set_property -dict { PACKAGE_PIN G21  IOSTANDARD LVCMOS33 } [get_ports { led0 }];
set_property -dict { PACKAGE_PIN G20  IOSTANDARD LVCMOS33 } [get_ports { led1 }];
set_property -dict { PACKAGE_PIN M6   IOSTANDARD LVCMOS33 } [get_ports { rst_n }];
```

**Why:** E3 was mistakenly assumed to be the clock based on it being an SRCC-capable pin in Artix-7, but on the QMTECH Wukong V3 PCB it is routed to a UART transceiver. The 50 MHz oscillator is routed to M21. The LED PCB traces go to G21/G20 (not J19/H19). None of the original pin guesses matched the actual PCB routing.
