#!/usr/bin/env python3
"""Regression checks that vendor build launchers cannot bypass readiness."""

from pathlib import Path


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