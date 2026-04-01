#!/usr/bin/env python3
"""Configure church_ti60_f225.peri.xml via the Efinity DesignAPI.

Usage (from the Efinity project directory that contains church_ti60_f225.peri.xml):

  PYTHONPATH=$HOME/efinity/2025.2/lib:$HOME/efinity/2025.2/pt/bin \\
  EFXPT_HOME=$HOME/efinity/2025.2/pt \\
    $HOME/efinity/2025.2/bin/python3.11 \\
    <path-to-this-script>/setup_ti60_peri.py

Pin map (confirmed from Ti60F225_kit.isf reference designs):
  pll_refclk  B2  = 25 MHz on-board crystal  → PLL_TL0 → 50 MHz "clk" GCLK
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

Clock: B2 25 MHz oscillator → PLL (M=4, N=1, O=2) → 50 MHz "clk"
       This matches the exact PLL settings from Ti60F225_kit.isf.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.environ.get("EFXPT_HOME", ""), "bin"))

from api_service.design import DesignAPI

PERI_XML = "church_ti60_f225.peri.xml"

design = DesignAPI(is_verbose=True)
design.load(PERI_XML)

# ── Strip stale GPIOs / PLLs left over from template peri.xml ────────────────
import xml.etree.ElementTree as _ET
_NS = "http://www.efinixinc.com/peri_design_db"
_KEEP = {"uart_tx", "uart_rx", "push_button",
         "led0", "led1", "led2", "led3"}
_tree = _ET.parse(PERI_XML)
_root = _tree.getroot()
for _sec in _root.findall(f"{{{_NS}}}gpio_info"):
    for _g in _sec.findall(f"{{{_NS}}}comp_gpio"):
        if _g.get("name") not in _KEEP:
            print(f"  cleanup: removing GPIO {_g.get('name')!r}")
            _sec.remove(_g)
for _sec in _root.findall(f"{{{_NS}}}pll_info"):
    for _p in _sec.findall(f"{{{_NS}}}pll"):
        print(f"  cleanup: removing PLL {_p.get('name')!r}")
        _sec.remove(_p)
_ET.register_namespace("efxpt", _NS)
_ET.register_namespace("xsi",   "http://www.w3.org/2001/XMLSchema-instance")
_tree.write(PERI_XML, xml_declaration=True, encoding="UTF-8")
design.load(PERI_XML)   # reload after cleanup
# ─────────────────────────────────────────────────────────────────────────────

for bank in ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]:
    design.set_device_property(bank, "DYNAMIC_VOLTAGE", "0", "IOBANK")
    design.set_mode_sel_name(bank, f"{bank}_MODE_SEL", bank)
    design.set_device_property(bank, "VOLTAGE", "1.8", "IOBANK")
for bank in ["BL", "BR", "TL", "TR"]:
    design.set_device_property(bank, "DYNAMIC_VOLTAGE", "0", "IOBANK")
    design.set_mode_sel_name(bank, f"{bank}_MODE_SEL", bank)
    design.set_device_property(bank, "VOLTAGE", "3.3", "IOBANK")

# ── Clock: 25 MHz crystal at B2 → PLL_TL0 → 50 MHz GCLK "clk" ───────────────
# These settings are identical to the verified Ti60F225_kit.isf reference.
design.create_pll_input_clock_gpio("pll_refclk")
design.create_block("pll_inst1", "PLL")

design.set_property("pll_inst1", "CLKOUT0_EN",          "1",        "PLL")
design.set_property("pll_inst1", "CLKOUT1_EN",          "0",        "PLL")
design.set_property("pll_inst1", "CLKOUT2_EN",          "0",        "PLL")
design.set_property("pll_inst1", "CLKOUT3_EN",          "0",        "PLL")
design.set_property("pll_inst1", "CLKOUT4_EN",          "0",        "PLL")
design.set_property("pll_inst1", "REFCLK_SOURCE",       "EXTERNAL", "PLL")
design.set_property("pll_inst1", "CLKOUT0_CONN_TYPE",   "gclk",     "PLL")
design.set_property("pll_inst1", "CLKOUT0_DIV",         "27",       "PLL")
design.set_property("pll_inst1", "CLKOUT0_DYNPHASE_EN", "0",        "PLL")
design.set_property("pll_inst1", "CLKOUT0_PHASE_STEP",  "0",        "PLL")
design.set_property("pll_inst1", "CLKOUT0_PIN",         "clk",      "PLL")
design.set_property("pll_inst1", "EXT_CLK",             "EXT_CLK0", "PLL")
design.set_property("pll_inst1", "IS_CLKOUT0_INVERTED", "0",        "PLL")
design.set_property("pll_inst1", "LOCKED_PIN",          "",         "PLL")
design.set_property("pll_inst1", "M",                   "4",        "PLL")
design.set_property("pll_inst1", "N",                   "1",        "PLL")
design.set_property("pll_inst1", "O",                   "2",        "PLL")
design.set_property("pll_inst1", "PHASE_SHIFT_ENA_PIN", "",         "PLL")
design.set_property("pll_inst1", "PHASE_SHIFT_PIN",     "",         "PLL")
design.set_property("pll_inst1", "PHASE_SHIFT_SEL_PIN", "",         "PLL")
design.set_property("pll_inst1", "REFCLK_FREQ",         "25.0",     "PLL")
design.set_property("pll_inst1", "RSTN_PIN",            "",         "PLL")
design.set_property("pll_inst1", "FEEDBACK_MODE",       "LOCAL",    "PLL")
design.set_property("pll_inst1", "FEEDBACK_CLK",        "CLK0",     "PLL")

design.assign_pkg_pin("pll_refclk", "B2")
design.assign_resource("pll_inst1", "PLL_TL0", "PLL")
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
