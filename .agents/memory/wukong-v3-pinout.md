---
name: QMTECH Wukong V3 XC7A100T FGG676 pin assignments
description: Correct FPGA pin assignments for QMTECH Wukong V3 board — hardware-confirmed by counter test and LED behavioral evidence
---

# QMTECH Wukong V3 (XC7A100T-2FGG676C) Correct Pins

## Target-revision boundary

The owner explicitly confirmed **V3** and **Micro SD slot** on 2026-11-13.
**Why:** An earlier V2 manual filename caused ambiguity; the subsequent
explicit board identification supersedes that filename.
**How to apply:** Use the V3 schematic for the proposed onboard microSD and
Ethernet plan. Do not request the V2 manual to identify this target again.
Do not infer an inserted card, unmodified physical wiring, or permission to
erase storage or access hardware.

The owner supplied a SanDisk 32GB Ultra 100MBs SDHC card description, a router
as Ethernet peer, and manual power control on 2026-11-13.
**Why:** The development equipment plan must not assume a gigabit-only peer,
automatic power switching, or the advertised card speed over SPI.
**How to apply:** Plan multi-speed full-duplex Ethernet and operator-assisted
power tests. Verify microSD form factor and card identity before physical use;
the supplied product description does not specify an exact SKU or grant writes.

**Source:** Hardware-confirmed on real board via counter-blink diagnostic test.

## Pin Table

| Signal      | Pin  | Notes |
|-------------|------|-------|
| `clk`       | M21  | 50 MHz oscillator, IO_L14P_T2_SRCC_34, bank 34 — **hardware confirmed** |
| `led[0]`    | G21  | User LED D1, **ACTIVE-LOW** (pin LOW = LED ON) |
| `led[1]`    | G20  | User LED D2, **ACTIVE-LOW** (pin LOW = LED ON) |
| `rst_n`     | M6   | Active-low reset button (bank 34) |
| `serial_tx` | E3   | UART TX — **E3 is NOT a clock pin on this board** |
| `serial_rx` | F3   | UART RX |

## Wrong Pins (do not revert)

- `clk` = E3 (E3 is UART TX on PCB), M22 (no oscillator), E3 (no oscillator)
- `led[0]` = J19 (not connected to any LED on V3)
- `led[1]` = H19 (not connected to any LED on V3)
- `rst_n` = T2 (not the reset button on V3)

## Critical Amaranth/Vivado BUFG Trap

**Do NOT use `Instance("BUFG", i_I=self.clk, o_O=ClockSignal("sync"))` in Amaranth for this board.**

Vivado's opt_design silently drops the explicit BUFG (BUFGCTRL: 1→0 from synth→impl), leaving all registers unclocked (counter stays 0, LEDs appear solid). The fix is:

```python
m.domains += ClockDomain("sync")
m.d.comb += ClockSignal("sync").eq(self.clk)  # Vivado auto-infers IBUF→BUFG
```

This auto-infers `clk_IBUF_BUFG_inst` (BUFGCTRL_X0Y0) and keeps it through implementation.

**Why:** With an explicit BUFG driven directly by a top-level port, Vivado inserts an IBUF automatically between the port and the BUFG. The resulting IBUF→BUFG chain is seen as redundant buffering and opt_design removes the explicit BUFG, leaving only the IBUF routing through general interconnect. The auto-inferred chain is NOT dropped because Vivado knows it's load-bearing.

## Board LED Layout (physical)

- 2 solid LEDs near board edge = power rail indicators (always on, not FPGA-controlled)
- 2 user LEDs near FPGA/JTAG = G21 (led0) and G20 (led1), active-LOW

## XDC Template

```tcl
set_property -dict { PACKAGE_PIN M21  IOSTANDARD LVCMOS33 } [get_ports { clk }];
create_clock -add -name sys_clk_pin -period 20.00 -waveform {0 10} [get_ports { clk }];
set_property -dict { PACKAGE_PIN G21  IOSTANDARD LVCMOS33 } [get_ports { led0 }];
set_property -dict { PACKAGE_PIN G20  IOSTANDARD LVCMOS33 } [get_ports { led1 }];
set_property -dict { PACKAGE_PIN M6   IOSTANDARD LVCMOS33 } [get_ports { rst_n }];
```

No `CLOCK_DEDICATED_ROUTE FALSE` needed — M21 is SRCC and routes through dedicated clock path correctly when Vivado auto-infers the IBUF→BUFG chain.
