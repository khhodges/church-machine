"""Package integrity and mocked vendor-gate tests, not FPGA implementation."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("package_builder", ROOT / "scripts/prepare_guarded_build_package.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
verify = builder.verify
from scripts.resume_guarded_drc_build import upgrade


@pytest.fixture(scope="module")
def package(tmp_path_factory):
    output = tmp_path_factory.mktemp("guarded-package") / "candidate"
    # Exercise the retained package in its own source context, not whichever
    # later RTL trial happens to be checked out. Test stale rejection separately.
    receipt = json.loads((ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/production-verilog-compile-600s.json").read_text())
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(builder, "source_fingerprint", lambda _: receipt["sourceFingerprint"])
        builder.prepare(output)
    return output


def test_frozen_identity(package):
    result = verify(package)
    assert result["releaseVerified"] is False
    assert "full UART reload" in result["pendingGates"]


def test_builder_rejects_changed_source_before_staging(tmp_path, monkeypatch):
    monkeypatch.setattr(builder, "source_fingerprint", lambda _: "different source")
    with pytest.raises(ValueError, match="Hardware source changed"):
        builder.prepare(tmp_path / "candidate")
    assert not (tmp_path / "candidate").exists()


@pytest.mark.parametrize("candidate", ["timing-read-selection", "timing-dwrite-capture"])
def test_explicit_timing_candidate_keeps_its_own_evidence(tmp_path, candidate):
    output = tmp_path / "timing"
    evidence = ROOT / f"docs/phase-1/reload-evidence/new-layout-{candidate}"
    receipt = json.loads((evidence / "compile.json").read_text())
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(builder, "source_fingerprint", lambda _: receipt["sourceFingerprint"])
        builder.prepare(output, candidate=candidate)
    record = verify(output)
    assert record["candidate"] == candidate
    boot = json.loads((output / "boot.json").read_text())
    assert boot["finalNiaObservation"] == ["00003504", "00000000"]
    assert (output / "boot.txt").read_bytes() == (evidence / "boot.txt").read_bytes()
    if candidate == "timing-dwrite-capture":
        assert "three pre-existing conformance-suite failures" in record["pendingGates"]
        assert "regression-summary.json" in record["files"]
        assert json.loads((output / "regression-summary.json").read_text())["failed"] == 3


def test_unknown_candidate_rejected_before_staging(tmp_path):
    with pytest.raises(ValueError, match="Unknown explicit candidate"):
        builder.prepare(tmp_path / "candidate", candidate="implicit-latest")
    assert not (tmp_path / "candidate").exists()


@pytest.mark.parametrize("name", ["candidate-le.bin", "build.tcl", "boot.json"])
def test_changed_input_rejected(package, tmp_path, name):
    target = tmp_path / "candidate"
    shutil.copytree(package, target)
    with (target / name).open("ab") as stream:
        stream.write(b"changed")
    with pytest.raises(ValueError, match="hash mismatch"):
        verify(target)


def test_missing_required_input_rejected(package, tmp_path):
    target = tmp_path / "candidate"
    shutil.copytree(package, target)
    manifest = json.loads((target / "manifest.json").read_text())
    del manifest["files"]["build.tcl"]
    (target / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Missing required"):
        verify(target)


@pytest.mark.skipif(not shutil.which("tclsh"), reason="Tcl required")
@pytest.mark.parametrize("scenario", ["good", "setup", "hold", "pulse", "empty", "nan", "ports", "drc", "disabled", "promotion_failed"])
def test_vendor_gates_with_mocked_vivado(package, tmp_path, scenario, resume=False):
    # The real Vivado executable is deliberately never invoked by this fixture.
    if resume:
        target = tmp_path / "resume-package"
        shutil.copytree(ROOT / "generated-artifacts/new-layout-guarded-build", target)
        checkpoint = target / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"
        checkpoint.parent.mkdir(parents=True)
        checkpoint.write_bytes(b"MOCK checkpoint only")
        upgrade(target)
        verify(target)
        package = target
    script = r'''
set argv {}
set drc_severity {Critical Warning}
set impl_started 0
proc launch_runs {name args} {
    if {$name eq "synth_1" && $::resume_mode} {error "Must not relaunch synthesis"}
    if {$name eq "impl_1"} {set ::impl_started 1}
}
proc current_project {} {return project}
proc get_files {args} {return [glob -nocomplain [lindex $args end]]}
proc set_property {key value args} {
    if {$key eq "SEVERITY" && $::scenario ne "promotion_failed"} {
        set ::drc_severity $value
    }
}
rename exec real_exec
proc exec {args} {
    if {[lsearch -exact $args "--record"] >= 0} {return "MOCK receipt only"}
    return [real_exec {*}$args]
}
proc get_ports {args} {
    if {[lindex $args end] eq "*"} {
        if {$::scenario eq "ports"} {return {clk rst_n led0 led1 uart_rx_pin uart_tx_pin unexpected}}
        return {clk rst_n led0 led1 uart_rx_pin uart_tx_pin}
    }
    return [lindex $args end]
}
proc get_property {key obj} {
    switch -- $key {
        NAME {return $obj}
        PART {return xc7a100tfgg676-2}
        TOP {return church_wukong_xc7a100t}
        DIRECTORY {return [file normalize work/guarded_candidate.runs/synth_1]}
        NEEDS_REFRESH {return [expr {$::scenario eq "stale"}]}
        PACKAGE_PIN {return [dict get {clk M21 rst_n M6 uart_rx_pin F3 uart_tx_pin E3 led0 G21 led1 G20} $obj]}
        IOSTANDARD {return LVCMOS33}
        SEVERITY {return $::drc_severity}
        IS_ENABLED {return [expr {$::scenario ne "disabled"}]}
        PERIOD {return 20.0}
        PROGRESS {
            if {$obj eq "impl_1" && !$::impl_started} {
                if {$::scenario eq "started"} {return 50%}
                return 0%
            }
            return 100%
        }
        STATS.WNS {
            if {$::scenario eq "empty"} {return ""}
            if {$::scenario eq "nan"} {return NaN}
            if {$::scenario eq "setup"} {return -0.1}
            return 0.1
        }
        STATS.WHS {if {$::scenario eq "hold"} {return -0.1}; return 0.1}
        STATS.TPWS {if {$::scenario eq "pulse"} {return -0.1}; return 0}
        default {error "Unmocked property: $key"}
    }
}
proc get_clocks {args} {return clk}
proc get_drc_violations {args} {if {$::scenario eq "drc"} {return bad}; return {}}
proc get_drc_checks {x} {return $x}
proc get_runs {x} {return $x}
proc current_fileset {} {return sources_1}
proc version {args} {return MOCK}
proc write_bitstream {args} {puts "MOCK_BITSTREAM_ONLY"}
foreach name {set_param create_project open_project add_files update_compile_order
              wait_on_run open_run report_utilization close_design report_timing_summary
              report_drc write_checkpoint} {
    proc $name {args} {}
}
if {[catch {source $build_script} problem]} {puts stderr $problem; exit 1}
'''
    mock = tmp_path / "mock.tcl"
    selected = "resume.tcl" if resume else "build.tcl"
    mock.write_text(f"set scenario {scenario}\nset resume_mode {int(resume)}\n"
                    f"set build_script {{{package / selected}}}\n" + script)
    result = subprocess.run(["tclsh", str(mock)], capture_output=True, text=True, timeout=30)
    assert (result.returncode == 0) == (scenario == "good"), result.stderr
    assert ("MOCK_BITSTREAM_ONLY" in result.stdout) == (scenario == "good")


@pytest.mark.parametrize("scenario", ["good", "stale", "started", "disabled", "promotion_failed"])
def test_resume_reuses_only_fresh_synthesis(package, tmp_path, scenario):
    test_vendor_gates_with_mocked_vivado(package, tmp_path, scenario, resume=True)
