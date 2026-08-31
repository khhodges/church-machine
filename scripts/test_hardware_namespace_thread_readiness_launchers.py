#!/usr/bin/env python3
"""Regression checks that vendor build launchers cannot bypass readiness."""

import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _assert_before(text: str, gate: str, vendor_step: str, context: str) -> None:
    gate_at = text.find(gate)
    vendor_at = text.find(vendor_step)
    assert gate_at >= 0, f"{context} does not invoke the readiness gate"
    assert vendor_at >= 0, f"{context} does not contain the vendor synthesis step"
    assert gate_at < vendor_at, (
        f"{context} invokes vendor synthesis before the namespace/thread "
        "readiness gate"
    )


def test_ti60_make_launchers_gate_vendor_build() -> None:
    text = (ROOT / "Makefile").read_text(encoding="utf-8")
    assert "readiness:" in text
    _assert_before(text, "bitstream: readiness", "bash scripts/build_ti60_bitstream.sh",
                   "Ti60 bitstream launcher")
    _assert_before(
        text,
        "bitstream-flash: readiness",
        "bash scripts/build_ti60_bitstream.sh --flash",
        "Ti60 flash launcher",
    )


def test_wukong_tcl_gates_vivado_synthesis() -> None:
    text = (ROOT / "hardware" / "wukong_xc7a100t.tcl").read_text(encoding="utf-8")
    assert "check_hardware_namespace_thread_readiness.py" in text
    _assert_before(
        text,
        "exec $readiness_python $readiness_script",
        "launch_runs synth_1",
        "Wukong Vivado launcher",
    )
    assert "Hardware readiness check failed; synthesis was not started." in text
    assert "check_ila_probe_names.py" in text
    _assert_before(
        text,
        "exec $readiness_python $ila_probe_script",
        "launch_runs synth_1",
        "Wukong Vivado ILA probe launcher",
    )
    assert "ILA probe-name check failed; synthesis was not started." in text


def test_wukong_ila_preflight_failure_stops_before_vivado(tmp_path: Path) -> None:
    """A failing ILA checker must stop the Tcl launcher before Vivado starts."""
    tclsh = shutil.which("tclsh") or shutil.which("tclsh8.6")
    if tclsh is None:
        pytest.fail("tclsh is required to exercise the Wukong launcher")

    checker_log = tmp_path / "checker-calls.log"
    fake_checker = tmp_path / "fake-checker"
    fake_checker.write_text(
        """#!/bin/sh
set -eu
printf '%s\\n' "$(basename "$1")" >> "$CHECKER_LOG"
case "$(basename "$1")" in
  check_hardware_namespace_thread_readiness.py)
    printf '%s\\n' 'fake namespace readiness passed'
    ;;
  check_ila_probe_names.py)
    printf '%s\\n' 'deliberate ILA preflight diagnostic: probe fixture is invalid' >&2
    exit 23
    ;;
  *)
    printf '%s\\n' "unexpected checker: $1" >&2
    exit 24
    ;;
esac
""",
        encoding="utf-8",
    )
    fake_checker.chmod(0o755)

    synthesis_marker = tmp_path / "synthesis-reached.marker"
    launcher_harness = tmp_path / "launcher-harness.tcl"
    launcher_harness.write_text(
        f"""proc set_param {{args}} {{}}
proc create_project {{args}} {{
    set marker [open [list {synthesis_marker}] w]
    puts $marker "create_project was reached"
    close $marker
    error "SYNTHESIS_REACHED"
}}
source [list {(ROOT / "hardware" / "wukong_xc7a100t.tcl").resolve()}]
""",
        encoding="utf-8",
    )

    env = os.environ.copy()
    env["CM_PYTHON"] = str(fake_checker)
    env["CHECKER_LOG"] = str(checker_log)
    result = subprocess.run(
        [tclsh, str(launcher_harness)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    combined_output = result.stdout + result.stderr
    assert result.returncode != 0
    assert (
        "deliberate ILA preflight diagnostic: probe fixture is invalid"
        in combined_output
    )
    assert "ILA probe-name check failed; synthesis was not started." in combined_output
    assert checker_log.read_text(encoding="utf-8").splitlines() == [
        "check_hardware_namespace_thread_readiness.py",
        "check_ila_probe_names.py",
    ]
    assert not synthesis_marker.exists(), (
        "create_project ran even though the ILA preflight failed"
    )
    assert "SYNTHESIS_REACHED" not in combined_output


def test_hardware_makefile_gates_both_pnr_profiles() -> None:
    text = (ROOT / "hardware" / "Makefile").read_text(encoding="utf-8")
    assert "$(PNR_JSON): readiness" in text
    assert "$(PNR_JSON_IOT): readiness" in text


def test_hardware_validation_group_runs_ila_probe_guard() -> None:
    text = (ROOT / "scripts" / "run-all-tests.sh").read_text(encoding="utf-8")
    hardware_group = next(
        line for line in text.splitlines() if line.startswith('ALL_GROUPS["hardware"]=')
    )
    assert "check-ila-probe-names" in hardware_group