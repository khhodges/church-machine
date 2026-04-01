# Synopsys Design Constraints — Church Machine, Efinix Titanium Ti60 F225
#
# Clock source: 25 MHz crystal oscillator at ball B2
# PLL (PLL_TL0): M=4 N=1 O=2 → 50 MHz system clock "clk" on GCLK network

create_clock -name {pll_refclk} -period 40.0 [get_ports {pll_refclk}]

create_generated_clock -name {clk} \
    -source [get_ports {pll_refclk}] \
    -multiply_by 2 \
    [get_pins {pll_inst1/CLKOUT0}]
