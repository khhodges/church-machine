# church_soc_cm.sdc — Timing constraints for Ti60F225 combined SoC+CM bitstream
#
# 50 MHz crystal at GPIOL_P_18.
# create_clock is required for efx_pnr to auto-promote the clk signal onto
# the global CLKMUX clock network.  Without it, P&R treats 'clk' as a
# regular high-fanout signal and routes it through local fabric only, which
# does not reach all quadrants → Sapphire SoC ClockDomainGenerator stalls →
# io_systemReset never deasserts → LED0 stays OFF and UART is silent.

# PLL_TL0: 25 MHz crystal → VCO 500 MHz → 25 MHz output (out_divider=20, period 40 ns).
# At 25 MHz system clock, CLOCKDIV=53 in firmware → 57600 baud (25MHz / (8×54)).
# Timing violations at 50 MHz (out_divider=10) caused Sapphire SoC ClockDomainGenerator
# to stall — io_systemReset never deasserted, LED0 stayed OFF. Fixed by halving PLL output.
create_clock -name clk -period 40.0 [get_nets clk]
