## QMTECH Wukong XC7A100T — Church Machine LED Flash Constraints
## Device: xc7a100tfgg676-2   (Artix-7, Speed Grade -2)
## Source:  LiteX litex-boards qmtech_wukong.py _io_v3 (community-verified on real hardware)
##
## Apply with: add_files -fileset constrs_1 wukong_xc7a100t.xdc

## ── System clock — M21 re-test with minimal Verilog (no Amaranth BUFG) ────────
## M21 = IO_L14P_T2_SRCC_34 (bank 34, SRCC-capable → dedicated clock routing OK)
## Re-testing because previous builds had BUFG optimized away by Vivado.
set_property -dict { PACKAGE_PIN M21  IOSTANDARD LVCMOS33 } [get_ports { clk }];
create_clock -add -name sys_clk_pin -period 20.00 -waveform {0 10} [get_ports { clk }];

## ── User LEDs (G21=led0, G20=led1 — V3 verified) ─────────────────────────────
## led[0] — D1 (G21):  solid ON while booting, then blinks ~1 Hz after boot
## led[1] — D2 (G20):  1 Hz heartbeat while booting, solid ON if fault latches
set_property -dict { PACKAGE_PIN G21  IOSTANDARD LVCMOS33 } [get_ports { led0 }];
set_property -dict { PACKAGE_PIN G20  IOSTANDARD LVCMOS33 } [get_ports { led1 }];

## ── Reset button (active LOW, pin M6 — V3) ────────────────────────────────────
set_property -dict { PACKAGE_PIN M6   IOSTANDARD LVCMOS33 } [get_ports { rst_n }];

## ── Bitstream / configuration settings ────────────────────────────────────────
set_property CFGBVS        VCCO [current_design];
set_property CONFIG_VOLTAGE 3.3  [current_design];

## ── UART TX (callhome — CH340 USB socket, 57600 8N1) ──────────────────────────
## E3 = IO_L5P_T0_34, bank 34, LVCMOS33 — hardware-confirmed (FPGA TX → CH340 RX)
## Only TX is constrained; RX (F3) is not wired in V2 (TX-only callhome).
set_property -dict { PACKAGE_PIN E3  IOSTANDARD LVCMOS33 } [get_ports { uart_tx_pin }];

## ── False paths (async inputs to sync domain) ──────────────────────────────────
set_false_path -from [get_ports { rst_n }];
