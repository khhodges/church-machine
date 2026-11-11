# Run only through build_vendor.py after exact-package authorization.
# No hardware manager, remote host, board selection, or programming operations.
set root [file dirname [file normalize [info script]]]
source [file join $root checks.tcl]
set_param general.maxThreads 1
if {[catch {
    create_project -in_memory -part xc7a100tfgg676-2
    read_verilog [file join $root rtl combined_starter.v]
    read_xdc [file join $root board.xdc]
    synth_design -top combined_starter -part xc7a100tfgg676-2 -flatten_hierarchy none
    enforce_pin_drc
    check_board
    write_checkpoint synthesis.dcp
    opt_design
    place_design -directive Default
    route_design -directive Default
    enforce_pin_drc
    check_routed
    write_checkpoint routed.dcp
    write_bitstream combined_starter.bit
    set f [open gates.json w]
    puts $f {{"clockConnectivity":true,"pinConstraints":true,"setupHold":true,"drc":true,"unconstrained":false}}
    close $f
} problem options]} {
    puts stderr "COMBINED BUILD REJECTED: $problem"
    puts stderr [dict get $options -errorinfo]
    exit 1
}
exit 0
