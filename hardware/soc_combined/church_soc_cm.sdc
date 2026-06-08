# church_soc_cm.sdc — Timing constraints for Ti60F225 combined SoC+CM bitstream
#
# 50 MHz crystal at GPIOL_P_18.
# create_clock is required for efx_pnr to auto-promote the clk signal onto
# the global CLKMUX clock network.  Without it, P&R treats 'clk' as a
# regular high-fanout signal and routes it through local fabric only, which
# does not reach all quadrants → Sapphire SoC ClockDomainGenerator stalls →
# io_systemReset never deasserts → LED0 stays OFF and UART is silent.

# No PLL. Clock = 25 MHz crystal direct from GPIOL_P_18 (period 40 ns).
# CLOCKDIV=53 in firmware → 57600 baud (25 MHz / (8×54) ≈ 57870 baud).
# Any PLL entry in peri.xml causes AssertionError in Efinity 2026.1 Interface
# Designer (pll/writer/summary.py assert reg is not None) → LPF never written
# → efx_pgm fails. Solution: remove PLL, use direct GPIO clock input.
create_clock -name clk -period 40.0 [get_nets clk]
