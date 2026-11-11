"""Local-only package and Tcl gate tests. No vendor or board commands."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from combined_package import verify_package, verify_rtl, identity
from export_combined_board import export
from build_combined_vendor import build


@pytest.fixture(scope="module")
def package():
    path = ROOT / "generated-artifacts" / f"combined-vendor-test-{uuid.uuid4().hex}"
    try:
        export(path)
        subprocess.run([sys.executable, str(path / "generate.py")], check=True,
                       capture_output=True, text=True)
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def test_exact_runtime_and_conversion(package):
    manifest = verify_package(package)
    receipt = verify_rtl(package, manifest)
    assert receipt["tools"]["yosys"].startswith("Yosys ")
    text = (package / "rtl/combined_starter.v").read_text()
    assert "module combined_starter(" in text
    assert "MMCME2_BASE" in text and "BUFGCE" in text
    assert ".CLKIN1_PERIOD(20.0)" in text
    assert ".CLKOUT0_DIVIDE_F(40.0)" in text
    assert ".CE(locked)" in text
    assert not (package / "vendor").exists()


@pytest.mark.parametrize("name", [
    "board.xdc", "build.tcl", "checks.tcl", "build_vendor.py",
    "source/applications/all-waiting.bin", "source/combined-inputs.json",
])
def test_frozen_file_mutation_rejected(package, name):
    path = package / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        with pytest.raises(ValueError, match="Frozen source changed"):
            verify_package(package)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize("field,value", [
    ("inputClockHz", 25_000_000), ("executionClockHz", 50_000_000),
    ("part", "xc7a35t"), ("runtimeSourceSha256", "0"*64),
    ("programmingAuthorized", True),
])
def test_profile_mutation_rejected(package, field, value):
    path = package / "board-source-manifest.json"
    before = path.read_text()
    try:
        manifest = json.loads(before)
        manifest[field] = value
        path.write_text(json.dumps(manifest))
        with pytest.raises(ValueError, match="Unapproved board profile"):
            verify_package(package)
    finally:
        path.write_text(before)


def test_rehashed_runtime_cannot_inherit_qualification(package):
    path = package / "board-source-manifest.json"
    before = path.read_text()
    try:
        manifest = json.loads(before)
        manifest["files"]["../escape"] = "0"*64
        manifest["boardSourceSha256"] = identity(manifest["files"])
        path.write_text(json.dumps(manifest))
        with pytest.raises(ValueError, match="escapes"):
            verify_package(package)
    finally:
        path.write_text(before)


def test_changed_generated_verilog_rejected(package):
    path = package / "rtl/combined_starter.v"
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        with pytest.raises(ValueError, match="Generated RTL changed"):
            verify_rtl(package, verify_package(package))
    finally:
        path.write_bytes(before)


def test_no_authorization_never_launches_vendor(package, tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Vendor command reached without authorization")
    monkeypatch.setattr(subprocess, "check_output", forbidden)
    monkeypatch.setattr(subprocess, "run", forbidden)
    approval = tmp_path / "approval.json"
    for grant in [{}, {"allowVendorBuild": True},
                  {"allowVendorBuild": True, "allowProgramming": True}]:
        approval.write_text(json.dumps(grant))
        with pytest.raises(ValueError, match="authorization"):
            build(package, approval)
    assert not (package / "vendor").exists()


def tcl(code):
    # tclsh stdin doesn't reliably return a nonzero status for script errors.
    script = f'source {{{HERE / "combined-vendor-checks.tcl"}}}\n'
    script += "if {[catch {\n" + code + "\n} problem]} {puts stderr $problem; exit 1}\n"
    return subprocess.run(["tclsh"], input=script, text=True, capture_output=True)


def test_timing_report_gate():
    names = ["no_clock", "constant_clock", "pulse_width_clock",
             "unconstrained_internal_endpoints", "multiple_clock", "generated_clocks", "loops"]
    clean = "\n".join(f"{n}. checking {name} (0)" for n, name in enumerate(names, 1))
    assert tcl(f"check_timing_text {{{clean}}}").returncode == 0
    for name in names:
        for bad in [clean.replace(f"{name} (0)", f"{name} (1)"),
                    clean.replace(f"checking {name}", "missing")]:
            assert tcl(f"check_timing_text {{{bad}}}").returncode != 0
    assert tcl("check_timing_text {}").returncode != 0


def test_clock_numeric_and_connectivity_gates():
    assert tcl("near 20.000 20 input; near 40.000 40 execution").returncode == 0
    for code in ["near 20 40 execution", "near 40 20 input",
                 "near {} 40 execution", "exactly_one {} MMCM",
                 "exactly_one {a b} BUFGCE"]:
        assert tcl(code).returncode != 0
    mocked = """
    proc get_nets {args} { return [lindex $args end] }
    connected {divided} {divided}
    connected {locked} {locked}
    """
    assert tcl(mocked).returncode == 0
    assert tcl(mocked + "\nconnected {locked} {constant_one}").returncode != 0


# Model Vivado queries, not the MMCM's electrical behavior. Run the actual
# check_board procedure against both complete and deliberately broken evidence.
BOARD_MODEL = """
array set props {
    design,PART xc7a100tfgg676-2
    clk,PACKAGE_PIN M21 maintenance_n,PACKAGE_PIN M6
    uart_rx_pin,PACKAGE_PIN F3 uart_tx_pin,PACKAGE_PIN E3
    clk,DIRECTION IN maintenance_n,DIRECTION IN
    uart_rx_pin,DIRECTION IN uart_tx_pin,DIRECTION OUT
    maintenance_n,PULLUP 1
    mm,CLKIN1_PERIOD 20 mm,DIVCLK_DIVIDE 1 mm,CLKFBOUT_MULT_F 20
    mm,CLKOUT0_DIVIDE_F 40 mm,CLKOUT0_PHASE 0 mm,CLKOUT0_DUTY_CYCLE 0.5
    input,PERIOD 20 execution,PERIOD 40 execution,IS_GENERATED 1
    NSTD-1,SEVERITY Error UCIO-1,SEVERITY Error
    NSTD-1,IS_ENABLED 1 UCIO-1,IS_ENABLED 1 gate,REF_NAME BUFGCE
}
foreach port {clk maintenance_n uart_rx_pin uart_tx_pin} {
    set props($port,IOSTANDARD) LVCMOS33
}
array set nets {
    clk in ib/I in ib/O buffered mm/CLKIN1 buffered
    mm/CLKFBOUT raw fb/I raw fb/O feedback mm/CLKFBIN feedback
    mm/CLKOUT0 divided gate/I divided mm/LOCKED locked gate/CE locked
}
set ports {clk maintenance_n uart_rx_pin uart_tx_pin}
set registers {r1 r2}
set execution_registers {r1 r2}
proc current_design {} {return design}
proc get_property {key object} {global props; return $props($object,$key)}
proc set_property {key value object} {global props; set props($object,$key) $value}
proc get_ports {args} {global ports; if {![llength $args]} {return $ports}; return [lindex $args end]}
proc get_drc_checks {rule} {return $rule}
proc get_cells {args} {
    switch -- [lindex $args end] {
        {REF_NAME =~ MMCME2*} {return mm}
        {REF_NAME == BUFGCE || REF_NAME == BUFGCTRL} {return gate}
        {REF_NAME == BUFG} {return fb}
        {REF_NAME == IBUF} {return ib}
    }
    error "Unexpected cell query"
}
proc get_pins {args} {return [lindex $args end]}
proc get_nets {args} {global nets; return $nets([lindex $args end])}
proc get_clocks {args} {
    switch -- [lindex $args end] {clk {return input} gate/O {return execution}}
    error "Unexpected clock query"
}
proc all_registers {args} {
    global registers execution_registers
    if {[llength $args]} {return $execution_registers}
    return $registers
}
"""


def test_complete_board_evidence_passes():
    result = tcl(BOARD_MODEL + "\ncheck_board")
    assert result.returncode == 0, result.stderr


def test_validated_mmcm_is_not_an_execution_register():
    result = tcl(BOARD_MODEL + "\nlappend registers mm\ncheck_board")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("mutation", [
    "set execution_registers {r1}",
    "lappend registers other_clock_cell",
    "lappend execution_registers unknown_register",
    "set registers {mm}; set execution_registers {}",
    "set props(mm,CLKOUT0_DIVIDE_F) 20",
])
def test_mmcm_exception_does_not_hide_bad_coverage(mutation):
    result = tcl(BOARD_MODEL + "\nlappend registers mm\n" + mutation + "\ncheck_board")
    assert result.returncode != 0


@pytest.mark.parametrize("mutation", [
    "set props(clk,PACKAGE_PIN) M20",
    "set props(maintenance_n,PULLUP) 0",
    "set props(uart_tx_pin,IOSTANDARD) DEFAULT",
    "set props(uart_rx_pin,DIRECTION) OUT",
    "lappend ports debug",
    "set props(NSTD-1,SEVERITY) Warning",
    "set props(UCIO-1,SEVERITY) Warning",
    "set props(NSTD-1,IS_ENABLED) 0",
    "set props(UCIO-1,IS_ENABLED) 0",
    "set props(mm,CLKIN1_PERIOD) 40",
    "set props(mm,CLKOUT0_DIVIDE_F) 20",
    "set props(input,PERIOD) 40",
    "set props(execution,PERIOD) 20",
    "set props(execution,IS_GENERATED) 0",
    "set nets(mm/CLKIN1) wrong",
    "set nets(mm/CLKFBIN) wrong",
    "set nets(gate/I) wrong",
    "set nets(gate/CE) constant_one",
    "set execution_registers {r1}",
])
def test_incomplete_board_evidence_fails(mutation):
    assert tcl(BOARD_MODEL + "\n" + mutation + "\ncheck_board").returncode != 0


EXPANDED_GATE = """
set props(gate,REF_NAME) BUFGCTRL
set props(gate,XILINX_LEGACY_PRIM) BUFGCE
set props(gate,PRESELECT_I0) 1
set props(gate,PRESELECT_I1) 0
set props(gate,CE_TYPE_CE0) SYNC
set nets(gate/I0) divided
set nets(gate/CE0) locked
unset nets(gate/I) nets(gate/CE)
foreach {name type} {CE1 GROUND S1 GROUND IGNORE0 GROUND S0 POWER IGNORE1 POWER I1 POWER} {
    set nets(gate/$name) const_$name
    set props(const_$name,TYPE) $type
}
"""


def test_vivado_expanded_gate_and_default_drc_policy():
    defaults = """
    set props(NSTD-1,SEVERITY) {Critical Warning}
    set props(UCIO-1,SEVERITY) {Critical Warning}
    set props(NSTD-1,IS_ENABLED) 0
    set props(UCIO-1,IS_ENABLED) 0
    enforce_pin_drc
    check_board
    """
    for model in [BOARD_MODEL, BOARD_MODEL + EXPANDED_GATE]:
        result = tcl(model + defaults)
        assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("mutation", [
    "set props(gate,XILINX_LEGACY_PRIM) OTHER",
    "set props(gate,PRESELECT_I0) 0",
    "set props(gate,PRESELECT_I1) 1",
    "set props(gate,CE_TYPE_CE0) ASYNC",
    "set nets(gate/I0) wrong",
    "set nets(gate/CE0) constant_one",
    *[f"set props(const_{pin},TYPE) WRONG"
      for pin in ["CE1", "S1", "IGNORE0", "S0", "IGNORE1", "I1"]],
    "set nets(gate/CE1) {}",
])
def test_expanded_gate_mutations_fail(mutation):
    assert tcl(BOARD_MODEL + EXPANDED_GATE + mutation + "\ncheck_board").returncode != 0


@pytest.mark.parametrize("mutation,passes", [
    ("", True),
    ("set setup -0.01", False),
    ("set hold -0.01", False),
    ("set setup {}", False),
    ("set summary {Timing constraints are not met.}", False),
    ("set violations {bad}; set severity Error", False),
    ("set violations {bad}; set severity {Critical Warning}", False),
    ("set checks {}", False),
])
def test_routed_receipt_gates(tmp_path, mutation, passes):
    model = f"cd {{{tmp_path}}}\n" + """
    proc check_board {} {}
    foreach cmd {report_clocks report_clock_interaction report_io report_utilization report_drc} {
        proc $cmd {args} {}
    }
    set setup 1.0; set hold 0.1; set violations {}; set severity Warning
    set summary {All user specified timing constraints are met.}
    set checks {}
    foreach name {
        no_clock constant_clock pulse_width_clock unconstrained_internal_endpoints
        multiple_clock generated_clocks loops
    } {append checks "checking $name (0)\\n"}
    proc check_timing {args} {global checks; return $checks}
    proc report_timing_summary {args} {global summary; return $summary}
    proc get_timing_paths {args} {return [lindex $args 1]}
    proc get_drc_violations {} {global violations; return $violations}
    proc get_property {key object} {
        global setup hold severity
        if {$key eq "SEVERITY"} {return $severity}
        if {$object eq "max"} {return $setup}
        return $hold
    }
    """
    result = tcl(model + mutation + "\ncheck_routed")
    assert (result.returncode == 0) == passes, result.stderr


def test_fresh_export_reproduces_rtl_identity(package):
    other = package.with_name(package.name + "-repeat")
    try:
        export(other)
        subprocess.run([sys.executable, str(other / "generate.py")], check=True,
                       capture_output=True, text=True)
        first = verify_rtl(package, verify_package(package))
        second = verify_rtl(other, verify_package(other))
        assert first == second
    finally:
        shutil.rmtree(other, ignore_errors=True)
