# Non-project implementation of one exact boot-tested checkpoint. No overrides.
if {[llength $argv]} {error "No override arguments supported"}
cd [file dirname [file normalize [info script]]]
puts [exec python3 initializer_route_verify.py]
if {[file exists route-started] || [file exists candidate-EXPERIMENTAL.bit]} {
 error "Continuation already started; do not overwrite results"
}
set sentinel [open route-started {WRONLY CREAT EXCL}]
close $sentinel
set_param general.maxThreads 2
open_checkpoint input.dcp
if {[get_property PART [current_design]] ne "xc7a100tfgg676-2"} {
 error "Unexpected checkpoint part"
}
source clock-guard.tcl
proc assert_board {} {
 set pins [dict create clk M21 rst_n M6 uart_rx_pin F3 uart_tx_pin E3 led0 G21 led1 G20]
 if {[lsort [get_property NAME [get_ports -quiet *]]] ne [lsort [dict keys $pins]]} {
  error "Unexpected board ports"
 }
 dict for {name pin} $pins {
  if {[get_property PACKAGE_PIN [get_ports $name]] ne $pin ||
      [get_property IOSTANDARD [get_ports $name]] ne "LVCMOS33"} {
   error "Board constraint mismatch: $name"
  }
 }
 foreach rule {NSTD-1 UCIO-1} {
  set_property SEVERITY Error [get_drc_checks $rule]
  if {![get_property IS_ENABLED [get_drc_checks $rule]] ||
      [get_property SEVERITY [get_drc_checks $rule]] ne "Error"} {
   error "Required DRC disabled or weakened"
  }
 }
 assert_25mhz_clocks
}
assert_board
opt_design
place_design
route_design
assert_board
report_route_status -file route-status.txt
report_utilization -file routed-utilization.txt
report_timing_summary -check_timing_verbose -report_unconstrained -file timing.txt
report_drc -file drc.txt
if {[llength [get_drc_violations -quiet -filter {SEVERITY == Error}]]} {
 error "Routed DRC errors; no bitstream"
}
# Check unrounded setup/hold slack as well as summary endpoint counts.
set evidence [open precise-slack.txt w]
foreach delay {max min} {
 set paths [get_timing_paths -quiet -delay_type $delay -max_paths 1 -nworst 1]
 if {[llength $paths] != 1} {error "Missing $delay timing path"}
 set slack [get_property SLACK $paths]
 if {![regexp {^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$} $slack] || $slack < 0} {
  error "Invalid or failing $delay slack: $slack"
 }
 puts $evidence "$delay slack=$slack"
}
close $evidence
puts [exec python3 initializer_route_verify.py --timing]
puts [exec python3 initializer_route_verify.py]
write_checkpoint routed.dcp
write_bitstream candidate-EXPERIMENTAL.bit
puts [exec python3 initializer_route_verify.py --record [version -short]]
puts "No device programmed. Full-program and runtime-reload verification remain pending."
