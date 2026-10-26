"""Mock Vivado property/connectivity checks; not timing closure evidence."""
from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("scenario", [
    "valid", "input_slowed", "wrong_divide", "missing_clock", "wrong_output",
    "ungated", "wrong_gate_source", "unlocked_gate", "extra_clock", "missing_period",
    "native", "wrong_feedback", "wrong_gate_type", "wrong_preselect",
    "async_gate", "enabled_second_arm", "wrong_constant",
])
def test_clock_gate(tmp_path, scenario):
    mock = r'''
proc get_ports {args} {return input}
proc get_cells {args} {
    if {[string match "*MMCME2*" [lindex $args end]]} {return mmcm}
    if {$::scenario eq "ungated"} {return {}}
    return gate
}
proc get_pins {p} {return $p}
proc get_nets {args} {
    set pin [lindex $args end]
    switch $pin {
        gate/I - gate/I0 {if {$::scenario eq "wrong_gate_source"} {return input}; return divided}
        mmcm/CLKOUT0 {return divided}
        gate/CE - gate/CE0 {if {$::scenario eq "unlocked_gate"} {return constant}; return locked}
        mmcm/LOCKED {return locked}
        gate/CE1 {
            if {$::scenario eq "enabled_second_arm"} {return high}
            return low
        }
        gate/S1 - gate/IGNORE0 {return low}
        gate/S0 - gate/IGNORE1 - gate/I1 {return high}
        default {error "Unexpected pin $pin"}
    }
}
proc get_clocks {args} {
    if {[llength $args] == 1} {
        if {$::scenario eq "extra_clock"} {return {input user feedback unexpected}}
        return {input user feedback}
    }
    set pin [lindex $args end]
    switch $pin {
        input {return input}
        mmcm/CLKFBOUT {return feedback}
        mmcm/CLKOUT0 - gate/O {
            if {$::scenario eq "missing_clock"} {return {}}
            return user
        }
        default {error "Unexpected clock pin $pin"}
    }
}
proc get_property {key object} {
    if {$key eq "PERIOD"} {
        if {$::scenario eq "missing_period"} {return {}}
        if {$object eq "input"} {
            if {$::scenario eq "input_slowed"} {return 40.0}
            return 20.0
        }
        if {$object eq "feedback"} {
            if {$::scenario eq "wrong_feedback"} {return 1.0}
            return 20.0
        }
        if {$::scenario eq "wrong_output"} {return 20.0}
        return 40.0
    }
    switch $key {
        REF_NAME {if {$::scenario eq "native"} {return BUFGCE}; return BUFGCTRL}
        XILINX_LEGACY_PRIM {if {$::scenario eq "wrong_gate_type"} {return unknown}; return BUFGCE}
        PRESELECT_I0 {return [expr {$::scenario ne "wrong_preselect"}]}
        PRESELECT_I1 {return 0}
        CE_TYPE_CE0 {if {$::scenario eq "async_gate"} {return ASYNC}; return SYNC}
        TYPE {
            if {$::scenario eq "wrong_constant"} {return SIGNAL}
            if {$object eq "low"} {return GROUND}
            return POWER
        }
    }
    if {$::scenario eq "wrong_divide" && $key eq "CLKOUT0_DIVIDE_F"} {return 20.0}
    return [dict get {CLKIN1_PERIOD 20.0 DIVCLK_DIVIDE 1 CLKFBOUT_MULT_F 20.0 CLKOUT0_DIVIDE_F 40.0} $key]
}
if {[catch {assert_25mhz_clocks} problem]} {puts stderr $problem; exit 1}
puts "MOCK_CLOCK_CHECK_PASS"
'''
    script = tmp_path / "check.tcl"
    script.write_text(f'set scenario {scenario}\nsource {{{ROOT / "hardware/guarded_25mhz_clock_checks.tcl"}}}\n' + mock)
    result = subprocess.run(["tclsh", str(script)], capture_output=True, text=True)
    assert (result.returncode == 0) == (scenario in ("valid", "native")), result.stdout + result.stderr
