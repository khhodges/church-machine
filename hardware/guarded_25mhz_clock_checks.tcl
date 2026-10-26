# Read-only checks on the synthesized/routed design. Never relax constraints.
proc require_clock_period {clocks expected label} {
    if {[llength $clocks] != 1} { error "$label: expected exactly one clock" }
    set actual [get_property PERIOD $clocks]
    if {![string is double -strict $actual] || $actual != $expected} {
        error "$label: expected $expected ns, got $actual"
    }
}
proc assert_25mhz_clocks {} {
    require_clock_period [get_clocks -quiet -of_objects [get_ports clk]] 20.0 "Board input"
    set mmcm [get_cells -hier -quiet -filter {REF_NAME =~ MMCME2*}]
    if {[llength $mmcm] != 1} {error "Expected exactly one MMCM"}
    foreach {property expected} {
        CLKIN1_PERIOD 20.0 DIVCLK_DIVIDE 1 CLKFBOUT_MULT_F 20.0 CLKOUT0_DIVIDE_F 40.0
    } {
        set value [get_property $property $mmcm]
        if {![string is double -strict $value] || $value != $expected} {
            error "MMCM $property mismatch: $value"
        }
    }
    require_clock_period [get_clocks -quiet -of_objects [get_pins $mmcm/CLKOUT0]] 40.0 "User clock"
    # Vivado's auto-derived feedback timing object follows the 50 MHz master;
    # it does not expose the 1 GHz internal VCO as a 1 ns feedback clock.
    require_clock_period [get_clocks -quiet -of_objects [get_pins $mmcm/CLKFBOUT]] 20.0 "Feedback clock"
    if {[llength [get_clocks -quiet]] != 3} {
        error "Unexpected additional or missing clocks"
    }
    set gate [get_cells -hier -quiet -filter {REF_NAME == BUFGCE || REF_NAME == BUFGCTRL}]
    if {[llength $gate] != 1} {error "Expected exactly one user clock gate"}
    require_clock_period [get_clocks -quiet -of_objects [get_pins $gate/O]] 40.0 "Buffered user clock"
    set mapping {I CLKOUT0 CE LOCKED}
    if {[get_property REF_NAME $gate] eq "BUFGCTRL"} {
        if {[get_property XILINX_LEGACY_PRIM $gate] ne "BUFGCE" ||
            ![get_property PRESELECT_I0 $gate] ||
            [get_property PRESELECT_I1 $gate] ||
            [get_property CE_TYPE_CE0 $gate] ne "SYNC"} {
            error "Unexpected BUFGCTRL configuration"
        }
        # Vivado expands BUFGCE into the clock-0 arm of BUFGCTRL. The other
        # arm must stay disabled, not become a second clock source.
        foreach {pin type} {CE1 GROUND S1 GROUND IGNORE0 GROUND S0 POWER IGNORE1 POWER I1 POWER} {
            set nets [get_nets -quiet -segments -of_objects [get_pins $gate/$pin]]
            if {![llength $nets]} {error "Missing constant on gate $pin"}
            foreach net $nets {
                if {[get_property TYPE $net] ne $type} {
                    error "Gate $pin must remain $type"
                }
            }
        }
        set mapping {I0 CLKOUT0 CE0 LOCKED}
    }
    # Check actual clock-tree connectivity, not just a clock named 25 MHz.
    foreach {pin target} $mapping {
        set incoming [get_nets -quiet -segments -of_objects [get_pins $gate/$pin]]
        set expected [get_nets -quiet -segments -of_objects [get_pins $mmcm/$target]]
        if {![llength $incoming] || [lsort $incoming] ne [lsort $expected]} {
            error "User clock gate $pin is not connected to MMCM $target"
        }
    }
}
