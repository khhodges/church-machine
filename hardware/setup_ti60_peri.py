#!/usr/bin/env python3
"""Configure church_ti60_f225.peri.xml via the Efinity DesignAPI.

Usage (from the Efinity project directory that contains church_ti60_f225.peri.xml):

  PYTHONPATH=$HOME/efinity/2025.2/lib:$HOME/efinity/2025.2/pt/bin \\
  EFXPT_HOME=$HOME/efinity/2025.2/pt \\
    $HOME/efinity/2025.2/bin/python3.11 \\
    <path-to-this-script>/setup_ti60_peri.py

Pin map (confirmed from Ti60F225_kit.isf reference designs):
  clk         B2  = 25 MHz on-board crystal  → direct "clk" input (Phase A, no PLL)
  uart_tx     H14 = GPIOR_P_11  (external header, not FT4232H)
  uart_rx     M14 = GPIOR_P_02  (external header, not FT4232H)
  push_button A7  = GPIOT_N_06  USER_PB active-low (weak pull-up)
  led0        K14 = USER_LED[0]
  led1        J15 = USER_LED[1]
  led2        H10 = USER_LED[2]
  led3        J14 = USER_LED[3]

NOTE: The Ti60F225 devkit has NO UART path to the FT4232H.
      The FT4232H is used only for JTAG programming/debug.
      uart_tx/rx are routed to GPIO pins for use with an external
      USB-UART adapter if needed.

Clock: Phase A — B2 25 MHz crystal → direct GPIO input "clk" (no PLL).
       Efinity 2025.2 requires a TITANIUMPLL RTL primitive for peri-only
       PLL configuration; without it check_design crashes.  The core runs
       at 25 MHz; UART baud will be 57600 instead of 115200.  The SDC
       (ti60_f225.sdc) Phase A constraint (period 40 ns) is already active.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.environ.get("EFXPT_HOME", ""), "bin"))

from api_service.design import DesignAPI

PERI_XML = "church_ti60_f225.peri.xml"

# ── Create a fresh schema-valid peri.xml via the DesignAPI itself.
# Hand-crafted XML is always rejected ("corrupted") because the schema is strict;
# design.create() is the only way to produce a file the API will accept.
design = DesignAPI(is_verbose=True)
if hasattr(design, "create"):
    design.create(PERI_XML, "Ti60F225")
    print(f"  created fresh design → {PERI_XML}")
else:
    # Older Efinity builds that lack create() — load a schema-valid seed file
    # produced by saving an empty Ti60F225 project via the Interface Designer.
    # We reconstruct one here using the known-good attribute set from the schema.
    _SEED = '''<?xml version="1.0" encoding="UTF-8"?>
<efxpt:design_db name="church_ti60_f225" device_def="Ti60F225"
  version="2025.2.0" db_version="20241001"
  last_change_date="Tue Apr 01 00:00:00 2026"
  xmlns:efxpt="http://www.efinixinc.com/peri_design_db"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.efinixinc.com/peri_design_db peri_design_db.xsd ">
  <efxpt:device_info>
    <efxpt:iobank_info>
      <efxpt:iobank name="1A" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="1A_MODE_SEL"/>
      <efxpt:iobank name="1B" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="1B_MODE_SEL"/>
      <efxpt:iobank name="2A" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="2A_MODE_SEL"/>
      <efxpt:iobank name="2B" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="2B_MODE_SEL"/>
      <efxpt:iobank name="3A" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="3A_MODE_SEL"/>
      <efxpt:iobank name="3B" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="3B_MODE_SEL"/>
      <efxpt:iobank name="4A" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="4A_MODE_SEL"/>
      <efxpt:iobank name="4B" iostd="1.8 V LVCMOS" is_dyn_voltage="false" mode_sel_name="4B_MODE_SEL"/>
      <efxpt:iobank name="BL" iostd="3.3 V LVCMOS" is_dyn_voltage="false" mode_sel_name="BL_MODE_SEL"/>
      <efxpt:iobank name="BR" iostd="3.3 V LVCMOS" is_dyn_voltage="false" mode_sel_name="BR_MODE_SEL"/>
      <efxpt:iobank name="TL" iostd="3.3 V LVCMOS" is_dyn_voltage="false" mode_sel_name="TL_MODE_SEL"/>
      <efxpt:iobank name="TR" iostd="3.3 V LVCMOS" is_dyn_voltage="false" mode_sel_name="TR_MODE_SEL"/>
    </efxpt:iobank_info>
  </efxpt:device_info>
  <efxpt:gpio_info>
    <efxpt:global_unused_config unused_gpio="register" pull_option="none"
      bus_hold="false" is_dyn_voltage="false" dynamic_config="false"/>
  </efxpt:gpio_info>
</efxpt:design_db>
'''
    with open(PERI_XML, "w", encoding="UTF-8") as _f:
        _f.write(_SEED)
    print(f"  wrote seed peri.xml (fallback) → {PERI_XML}")
    design.load(PERI_XML)

for bank in ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]:
    design.set_device_property(bank, "DYNAMIC_VOLTAGE", "0", "IOBANK")
    design.set_mode_sel_name(bank, f"{bank}_MODE_SEL", bank)
    design.set_device_property(bank, "VOLTAGE", "1.8", "IOBANK")
for bank in ["BL", "BR", "TL", "TR"]:
    design.set_device_property(bank, "DYNAMIC_VOLTAGE", "0", "IOBANK")
    design.set_mode_sel_name(bank, f"{bank}_MODE_SEL", bank)
    design.set_device_property(bank, "VOLTAGE", "3.3", "IOBANK")

# ── Clock: 25 MHz crystal at B2 → direct GCLK input "clk" (Phase A) ─────────
# No PLL instantiated here.  Efinity 2025.2 requires a TITANIUMPLL RTL cell
# to configure a peri-only PLL via check_design; without it the tool crashes
# with a null-dereference.  Phase A runs the core at 25 MHz directly.
# The SDC (ti60_f225.sdc) already has Phase A active (create_clock period 40).
design.create_input_gpio("clk")
design.set_property("clk", "CONN_TYPE", "GCLK")
design.assign_pkg_pin("clk", "B2")
# ─────────────────────────────────────────────────────────────────────────────

# ── GPIO signals ──────────────────────────────────────────────────────────────
design.create_output_gpio("uart_tx")
design.create_input_gpio("uart_rx")
design.create_input_gpio("push_button")
design.create_output_gpio("led0")
design.create_output_gpio("led1")
design.create_output_gpio("led2")
design.create_output_gpio("led3")

design.set_property("push_button", "PULL_OPTION", "WEAK_PULLUP")

design.assign_pkg_pin("uart_tx",     "H14")
design.assign_pkg_pin("uart_rx",     "M14")
design.assign_pkg_pin("push_button", "A7")
design.assign_pkg_pin("led0",        "K14")
design.assign_pkg_pin("led1",        "J15")
design.assign_pkg_pin("led2",        "H10")
design.assign_pkg_pin("led3",        "J14")
# ─────────────────────────────────────────────────────────────────────────────

design.save()
print(f"SUCCESS — {PERI_XML} written")
