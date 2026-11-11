# Fail closed on missing objects, wrong wiring, unconstrained pins, or timing.
proc exactly_one {objects label} {
    if {[llength $objects] != 1} { error "$label: expected one object, got $objects" }
    return [lindex $objects 0]
}
proc near {actual expected label} {
    if {![string is double -strict $actual] || abs($actual-$expected) > 0.001} {
        error "$label: expected $expected, got $actual"
    }
}
proc connected {a b} {
    set left [get_nets -quiet -segments -of_objects $a]
    set right [get_nets -quiet -segments -of_objects $b]
    foreach net $left { if {[lsearch -exact $right $net] >= 0} { return } }
    error "Disconnected: $a -> $b"
}
proc pin {cell name} {
    return [exactly_one [get_pins -quiet $cell/$name] "$cell/$name"]
}
proc enforce_pin_drc {} {
    foreach rule {NSTD-1 UCIO-1} {
        set check [exactly_one [get_drc_checks $rule] $rule]
        # Vivado 2026.1 defaults to Critical Warning after synthesis.
        set_property SEVERITY Error $check
        set_property IS_ENABLED true $check
        if {[get_property SEVERITY $check] ne "Error" ||
            ![get_property IS_ENABLED $check]} { error "Could not enforce $rule" }
    }
}
proc check_timing_text {text} {
    foreach name {
        no_clock constant_clock pulse_width_clock unconstrained_internal_endpoints
        multiple_clock generated_clocks loops
    } {
        # Require each named summary, not a generic "0" anywhere in the report.
        set pattern [format {checking %s \(([0-9]+)\)} $name]
        if {![regexp $pattern $text match count] || $count != 0} {
            error "Missing or failing check_timing category: $name"
        }
    }
}
proc check_board {} {
    if {[get_property PART [current_design]] ne "xc7a100tfgg676-2"} {
        error "Wrong FPGA part"
    }
    if {[lsort [get_ports]] ne [lsort {clk maintenance_n uart_rx_pin uart_tx_pin}]} {
        error "Unexpected or missing board ports"
    }
    foreach {port package direction} {
        clk M21 IN maintenance_n M6 IN uart_rx_pin F3 IN uart_tx_pin E3 OUT
    } {
        set p [exactly_one [get_ports $port] $port]
        if {[get_property PACKAGE_PIN $p] ne $package ||
            [get_property IOSTANDARD $p] ne "LVCMOS33" ||
            [get_property DIRECTION $p] ne $direction} {
            error "Incomplete or incorrect constraint on $port"
        }
    }
    if {![get_property PULLUP [get_ports maintenance_n]]} { error "Missing inactive pullup" }
    foreach rule {NSTD-1 UCIO-1} {
        if {[get_property SEVERITY [get_drc_checks $rule]] ne "Error" ||
            ![get_property IS_ENABLED [get_drc_checks $rule]]} {
            error "$rule was downgraded or disabled"
        }
    }
    set mm [exactly_one [get_cells -hier -filter {REF_NAME =~ MMCME2*}] MMCM]
    set gate [exactly_one [get_cells -hier -filter {REF_NAME == BUFGCE || REF_NAME == BUFGCTRL}] user_clock_gate]
    set fb [exactly_one [get_cells -hier -filter {REF_NAME == BUFG}] feedback_BUFG]
    # There are also IBUFs on the asynchronous inputs; select the clock IBUF by connectivity.
    set ib {}
    foreach cell [get_cells -hier -filter {REF_NAME == IBUF}] {
        if {![catch {connected [get_ports clk] [pin $cell I]}]} { lappend ib $cell }
    }
    set ib [exactly_one $ib clock_IBUF]
    foreach {property value} {
        CLKIN1_PERIOD 20.0 DIVCLK_DIVIDE 1 CLKFBOUT_MULT_F 20.0
        CLKOUT0_DIVIDE_F 40.0 CLKOUT0_PHASE 0.0 CLKOUT0_DUTY_CYCLE 0.5
    } { near [get_property $property $mm] $value "MMCM $property" }
    connected [pin $ib O] [pin $mm CLKIN1]
    connected [pin $mm CLKFBOUT] [pin $fb I]
    connected [pin $fb O] [pin $mm CLKFBIN]
    set gate_input I
    set gate_enable CE
    if {[get_property REF_NAME $gate] eq "BUFGCTRL"} {
        # Artix-7 Vivado maps BUFGCE onto arm 0 of BUFGCTRL.
        if {[get_property XILINX_LEGACY_PRIM $gate] ne "BUFGCE" ||
            ![get_property PRESELECT_I0 $gate] ||
            [get_property PRESELECT_I1 $gate] ||
            [get_property CE_TYPE_CE0 $gate] ne "SYNC"} {
            error "Unexpected BUFGCTRL expansion"
        }
        foreach {name type} {
            CE1 GROUND S1 GROUND IGNORE0 GROUND S0 POWER IGNORE1 POWER I1 POWER
        } {
            set nets [get_nets -quiet -segments -of_objects [pin $gate $name]]
            if {![llength $nets]} { error "Missing constant on gate $name" }
            foreach net $nets {
                if {[get_property TYPE $net] ne $type} {
                    error "Gate $name must remain $type"
                }
            }
        }
        set gate_input I0
        set gate_enable CE0
    }
    connected [pin $mm CLKOUT0] [pin $gate $gate_input]
    connected [pin $mm LOCKED] [pin $gate $gate_enable]
    set input [exactly_one [get_clocks -of_objects [get_ports clk]] input_clock]
    near [get_property PERIOD $input] 20.0 input_period
    set execution [exactly_one [get_clocks -of_objects [pin $gate O]] execution_clock]
    near [get_property PERIOD $execution] 40.0 execution_period
    if {![get_property IS_GENERATED $execution]} { error "Execution clock not derived from MMCM" }
    set registers [lsort [all_registers]]
    # Vivado includes the MMCM in all_registers, although it is clock-generation
    # infrastructure, not an execution register. Exclude only the exact MMCM
    # already validated above (part, parameters, input/feedback/output wiring).
    set mm_index [lsearch -exact $registers $mm]
    if {$mm_index >= 0} { set registers [lreplace $registers $mm_index $mm_index] }
    if {[llength $registers] == 0 ||
        $registers ne [lsort [all_registers -clock $execution]]} {
        error "Sequential logic is missing the 25 MHz execution clock"
    }
}

proc check_routed {} {
    check_board
    report_clocks -file clocks.rpt
    report_clock_interaction -file clock_interaction.rpt
    report_io -file io.rpt
    report_utilization -file utilization.rpt
    report_timing_summary -delay_type min_max -report_unconstrained -file timing.rpt
    # External UART and maintenance pins are explicitly asynchronous in XDC.
    # Internal endpoints must nevertheless all be timed, with no loops/multiple clocks.
    set checks [check_timing -override_defaults {
        no_clock constant_clock pulse_width_clock unconstrained_internal_endpoints
        multiple_clock generated_clocks loops
    } -return_string]
    set f [open check_timing.rpt w]; puts $f $checks; close $f
    check_timing_text $checks
    foreach type {max min} {
        set paths [get_timing_paths -delay_type $type -max_paths 1 -nworst 1]
        set path [exactly_one $paths "$type timing path"]
        set slack [get_property SLACK $path]
        if {![string is double -strict $slack] || $slack < 0} {
            error "$type timing failed: $slack"
        }
    }
    # Includes pulse-width checks not represented by the setup/hold paths.
    set timing [report_timing_summary -delay_type min_max -return_string]
    if {![string match {*All user specified timing constraints are met.*} $timing]} {
        error "Timing summary does not confirm all constraints met"
    }
    report_drc -ruledeck default -file drc.rpt
    foreach violation [get_drc_violations] {
        if {[get_property SEVERITY $violation] in {Error {Critical Warning}}} {
            error "Blocking DRC: $violation"
        }
    }
}
