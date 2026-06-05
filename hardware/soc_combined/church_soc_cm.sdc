# church_soc_cm.sdc — Timing constraints for Ti60F225 combined SoC+CM bitstream
#
# 50 MHz crystal at GPIOL_P_18.
# create_clock is required for efx_pnr to auto-promote the clk signal onto
# the global CLKMUX clock network.  Without it, P&R treats 'clk' as a
# regular high-fanout signal and routes it through local fabric only, which
# does not reach all quadrants → Sapphire SoC ClockDomainGenerator stalls →
# io_systemReset never deasserts → LED0 stays OFF and UART is silent.

create_clock -name clk -period 20.0 [get_ports clk]
