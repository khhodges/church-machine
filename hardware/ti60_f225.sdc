# Synopsys Design Constraints — Church Machine, Efinix Titanium Ti60 F225
#
# Clock topology (two phases):
#
#   Phase A — direct crystal (current peri.xml, no PLL configured):
#     Ball B2 (GPIOT_P_07_CLK4_P) → CLKMUX_T → core port "clk" @ 25 MHz
#     Use the create_clock line below.
#
#   Phase B — PLL-enabled (after running setup_ti60_peri.py):
#     Ball B2 → pll_refclk GPIO → PLL_TL0 (M=4 N=1 O=2) → "clk" GCLK @ 50 MHz
#     Comment out Phase A and uncomment Phase B below, then re-synthesise.

# ── Phase A: direct 25 MHz crystal on "clk" port (active now) ────────────────
create_clock -name {clk} -period 40.000 [get_ports {clk}]

# ── Phase B: PLL-generated 50 MHz (enable after setup_ti60_peri.py) ──────────
# create_clock -name {pll_refclk} -period 40.000 [get_ports {pll_refclk}]
# create_generated_clock -name {clk} \
#     -source [get_ports {pll_refclk}] \
#     -multiply_by 2 \
#     [get_pins {pll_inst1/CLKOUT0}]
