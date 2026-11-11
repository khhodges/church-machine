## Experimental combined starter only: QMTECH Wukong V3 xc7a100tfgg676-2.
## Pin evidence: docs/wukong-port-plan.md and retained board.xdc.
set_property -dict { PACKAGE_PIN M21 IOSTANDARD LVCMOS33 } [get_ports clk]
create_clock -name sys_clk_pin -period 20.000 [get_ports clk]

## Key1/M6: pressed LOW enables maintenance. NOT transport reset or scheduler.
## Pull up to the inactive state when the switch is open.
set_property -dict { PACKAGE_PIN M6 IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports maintenance_n]
set_property -dict { PACKAGE_PIN F3 IOSTANDARD LVCMOS33 } [get_ports uart_rx_pin]
set_property -dict { PACKAGE_PIN E3 IOSTANDARD LVCMOS33 } [get_ports uart_tx_pin]

## Asynchronous external inputs enter the retained synchronizers.
set_false_path -from [get_ports maintenance_n]
set_false_path -from [get_ports uart_rx_pin]
## MMCM generated clock is derived by Vivado. Do not override it with 50 MHz.
## Keep NSTD-1/UCIO-1 at Error. No unconstrained debug/LED ports.
