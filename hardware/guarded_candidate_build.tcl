# Experimental guarded candidate only. No programming, flash image, or ILA.
# Run from a fresh extracted package: vivado -mode batch -source build.tcl
if {[llength $argv]} { error "This build accepts no override flags." }
cd [file dirname [file normalize [info script]]]
puts [exec python3 verify.py]
set candidate_clock_hz [exec python3 -c {import json; print(json.load(open("profile.json"))["clockHz"])}]
if {$candidate_clock_hz == 25000000} {
    source guarded_25mhz_clock_checks.tcl
} elseif {$candidate_clock_hz != 50000000} {
    error "Unsupported candidate clock"
}
if {[file exists work] || [file exists candidate-EXPERIMENTAL.bit]} {
    error "Refusing to overwrite build output. Extract into a fresh directory."
}
set_param general.maxThreads 2
create_project guarded_candidate work -part xc7a100tfgg676-2
add_files -norecurse church_wukong_xc7a100t.v
add_files -fileset constrs_1 -norecurse wukong_xc7a100t.xdc
set_property top church_wukong_xc7a100t [current_fileset]
update_compile_order -fileset sources_1

proc assert_board_io {} {
    set pins [dict create clk M21 rst_n M6 uart_rx_pin F3 uart_tx_pin E3 led0 G21 led1 G20]
    if {[lsort [get_property NAME [get_ports -quiet *]]] ne [lsort [dict keys $pins]]} {
        error "Unexpected physical ports; refusing this candidate."
    }
    dict for {name pin} $pins {
        set port [get_ports $name]
        if {[get_property PACKAGE_PIN $port] ne $pin ||
            [get_property IOSTANDARD $port] ne "LVCMOS33"} {
            error "Incorrect board constraint for $name"
        }
    }
    foreach rule {NSTD-1 UCIO-1} {
        # Vivado 2026.1 reports Critical Warning at the post-synthesis stage.
        # Enforce our stronger policy explicitly; never downgrade or disable it.
        set_property SEVERITY Error [get_drc_checks $rule]
        if {![get_property IS_ENABLED [get_drc_checks $rule]]} {
            error "DRC $rule is disabled"
        }
        if {[get_property SEVERITY [get_drc_checks $rule]] ne "Error"} {
            error "DRC $rule must remain Error"
        }
    }
    if {$::candidate_clock_hz == 25000000} {
        assert_25mhz_clocks
    } else {
        set clocks [get_clocks -quiet]
        if {[llength $clocks] != 1 || [get_property PERIOD $clocks] != 20.0} {
            error "Expected exactly one 50 MHz clock"
        }
    }
}
proc completed {name} {
    if {[get_property PROGRESS [get_runs $name]] ne "100%"} {
        error "$name did not complete; inspect work/guarded_candidate.runs/$name"
    }
}
launch_runs synth_1 -jobs 2
wait_on_run synth_1
completed synth_1
open_run synth_1
assert_board_io
report_utilization -file synth-utilization.txt
close_design
launch_runs impl_1 -jobs 2
wait_on_run impl_1
completed impl_1
open_run impl_1
assert_board_io
report_utilization -file routed-utilization.txt
report_timing_summary -check_timing_verbose -report_unconstrained -file timing.txt
report_drc -file drc.txt
if {[llength [get_drc_violations -quiet -filter {SEVERITY == Error}]]} {
    error "Routed DRC errors; bitstream not written."
}
set timing_values {}
foreach metric {WNS WHS TPWS} {
    set value [get_property STATS.$metric [get_runs impl_1]]
    if {![regexp {^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$} $value]} {
        error "Missing/nonfinite timing evidence: $metric=$value"
    }
    if {$value < 0} { error "Timing failed: $metric=$value; no override supported." }
    lappend timing_values $value
}
# Verify inputs again before producing an output; inputs may not change mid-build.
puts [exec python3 verify.py]
write_bitstream candidate-EXPERIMENTAL.bit
write_checkpoint routed.dcp
puts [exec python3 verify.py --record [version -short] {*}$timing_values]
puts "EXPERIMENTAL candidate built. Not release-approved. No device was programmed."
