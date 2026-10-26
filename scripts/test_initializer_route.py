import pytest
from pathlib import Path
import subprocess
from scripts.initializer_route_verify import timing_summary


HEADER = "WNS(ns) TNS(ns) TNS Failing Endpoints TNS Total Endpoints WHS(ns) THS(ns) THS Failing Endpoints THS Total Endpoints WPWS(ns) TPWS(ns) TPWS Failing Endpoints TPWS Total Endpoints"
VALUES = ["7.215", "0.000", "0", "48735", "0.078", "0.000",
          "0", "48735", "7.000", "0.000", "0", "17616"]


def report(values):
    return HEADER + "\n-----\n" + " ".join(values) + "\n"


def test_complete_summary():
    assert timing_summary(report(VALUES))["WNS"] == 7.215


@pytest.mark.parametrize("index,value", [
    (0, "-0.001"), (4, "-0.001"), (8, "-0.001"),
    (2, "1"), (6, "1"), (10, "1"),
    (3, "0"), (7, "0"), (11, "0"),
    (0, "NaN"), (4, "Inf"), (9, "-0.001"),
])
def test_reject_bad_evidence(index, value):
    values = list(VALUES)
    values[index] = value
    with pytest.raises(ValueError):
        timing_summary(report(values))


def test_reject_missing_or_duplicate_summary():
    for text in ("", report(VALUES) * 2, HEADER + "\n---\nN/A"):
        with pytest.raises(ValueError):
            timing_summary(text)


@pytest.mark.parametrize("scenario", ["pass", "drc", "slack", "pulse", "clock"])
def test_tcl_stops_before_bitstream_on_gate_failure(tmp_path, scenario):
    script = Path(__file__).resolve().parents[1] / "hardware/initializer_route.tcl"
    (tmp_path / "route.tcl").write_text(script.read_text())
    (tmp_path / "clock-guard.tcl").write_text(
        'proc assert_25mhz_clocks {} {if {$::scenario eq "clock"} {error "bad clock"}}')
    harness = r"""
set scenario SCENARIO
set argv {}
rename exec actual_exec
proc exec {args} {
 if {[lsearch $args --timing]>=0 && $::scenario eq "pulse"} {error "pulse failure"}
 return TEST_VERIFIED
}
proc set_param {args} {}
proc open_checkpoint {args} {}
proc current_design {} {return design}
proc version {args} {return 2026.1}
proc get_ports {args} {
 if {[lindex $args end] eq "*"} {return {clk rst_n uart_rx_pin uart_tx_pin led0 led1}}
 return [lindex $args end]
}
proc get_property {property object} {
 switch -- $property {
  PART {return xc7a100tfgg676-2}
  NAME {return $object}
  PACKAGE_PIN {return [dict get {clk M21 rst_n M6 uart_rx_pin F3 uart_tx_pin E3 led0 G21 led1 G20} $object]}
  IOSTANDARD {return LVCMOS33}
  IS_ENABLED {return 1}
  SEVERITY {return Error}
  SLACK {if {$::scenario eq "slack"} {return -0.00001}; return 1.0}
  default {error "Unexpected property $property"}
 }
}
proc get_drc_checks {args} {return [lindex $args end]}
proc set_property {args} {}
proc get_drc_violations {args} {
 if {$::scenario eq "drc"} {return violation}
 return {}
}
proc get_timing_paths {args} {return path}
foreach name {opt_design place_design route_design report_route_status report_utilization report_timing_summary report_drc write_checkpoint} {
 proc $name {args} {}
}
proc write_bitstream {args} {puts BITSTREAM_WRITE_REACHED}
if {[catch {source route.tcl} message]} {puts $message; exit 1}
"""
    result = subprocess.run(["tclsh"], cwd=tmp_path, input=harness.replace("SCENARIO", scenario),
                            capture_output=True, text=True, timeout=10)
    assert (result.returncode == 0) == (scenario == "pass"), result.stdout + result.stderr
    assert ("BITSTREAM_WRITE_REACHED" in result.stdout) == (scenario == "pass")
