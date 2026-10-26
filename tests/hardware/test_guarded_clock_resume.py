"""Continuation preparation only; synthetic checkpoints are not Vivado evidence."""
import json
from pathlib import Path
import shutil
import pytest
from scripts.prepare_guarded_clock_resume import prepare, sha

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def original(tmp_path):
    target = tmp_path / "original"
    shutil.copytree(ROOT / "generated-artifacts/new-layout-build25", target)
    checkpoint = target / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"MOCK CHECKPOINT; NOT FPGA EVIDENCE")
    (target / "build.exit").write_text("1\n")
    (target / "build.log").write_text("Feedback clock: expected 1.0 ns, got 20.000\n")
    return target


def test_preserves_inputs_and_pins_checkpoint(original):
    old = (original / "manifest.json").read_bytes()
    inputs = json.loads(old)["files"]
    checkpoint = original / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"
    prepare(original, ROOT / "hardware/guarded_25mhz_clock_checks.tcl")
    assert (original / "original-clock-manifest.json").read_bytes() == old
    for name, expected in inputs.items():
        assert sha(original / name) == expected
    manifest = json.loads((original / "manifest.json").read_text())
    assert manifest["resumeCheckpointSha256"] == sha(checkpoint)
    resume = (original / "clock-resume.tcl").read_text()
    preflight = (original / "clock-resume-preflight.tcl").read_text()
    assert "launch_runs synth_1" not in resume
    assert "launch_runs impl_1 -jobs 2" in resume
    assert "Timing failed:" in resume and "Routed DRC errors" in resume
    assert "source clock-resume-guard.tcl" in resume
    assert "NEEDS_REFRESH" in preflight and "resumeCheckpointSha256" in preflight
    assert "launch_runs" not in preflight and "write_bitstream" not in preflight
    assert "CLOCK_RESUME_PREFLIGHT_PASS" in preflight
    with pytest.raises(ValueError, match="already prepared"):
        prepare(original, ROOT / "hardware/guarded_25mhz_clock_checks.tcl")


@pytest.mark.parametrize("case", ["rtl", "running", "different_failure", "checkpoint", "existing"])
def test_rejects_wrong_resume_state(original, case):
    before = (original / "manifest.json").read_bytes()
    if case == "rtl":
        (original / "church_wukong_xc7a100t.v").write_text("changed")
    elif case == "running":
        (original / "build.exit").unlink()
    elif case == "different_failure":
        (original / "build.log").write_text("Some other failure")
    elif case == "existing":
        (original / "clock-resume.tcl").write_text("existing")
    else:
        (original / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp").unlink()
    with pytest.raises((ValueError, OSError)):
        prepare(original, ROOT / "hardware/guarded_25mhz_clock_checks.tcl")
    assert (original / "manifest.json").read_bytes() == before
