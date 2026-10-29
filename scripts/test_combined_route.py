"""Offline evidence/gate tests; never claim Vivado implementation success."""
import json
from pathlib import Path
import subprocess
import pytest
from scripts import combined_route as gate
from scripts.package_combined_route import package


def write(root, name, text):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def manifest(root, name, files):
    write(root, name, "".join(f"{gate.sha(root / n)}  {n}\n" for n in files))
    return gate.sha(root / name)


@pytest.fixture
def source(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    image = "source-snapshot/generated-artifacts/data-access-validation/admitted.bin"
    write(root, image, "fixture image")
    monkeypatch.setattr(gate, "IMAGE", gate.sha(root / image))
    write(root, "provenance.json", "{}")
    monkeypatch.setattr(gate, "INPUTS", manifest(root, "inputs.sha256", [image, "provenance.json"]))
    write(root, "model-support/server/lump_approvals.py", "# fixture")
    monkeypatch.setattr(gate, "SUPPORT", manifest(root, "model-support.sha256",
                                               ["model-support/server/lump_approvals.py"]))
    write(root, "mapped.v", "netlist")
    write(root, "synthesized.dcp", "checkpoint")
    write(root, "mapped-boot-tb.v", "module full_boot_tb;\nif(write_count) begin end\ninteger write_count=0;\n")
    write(root, "mapped-boot-tb-fixed.v", "module full_boot_tb;\ninteger write_count=0;\nif(write_count) begin end\n")
    manifest(root, "synthesized-inputs.sha256", ["mapped.v", "mapped-boot-tb.v", "synthesized.dcp"])
    manifest(root, "resumed-simulation-inputs.sha256",
             ["mapped.v", "mapped-boot-tb-fixed.v", "synthesized.dcp"])
    write(root, "synthesis.log", "COMBINED_SYNTH_EXPORT_COMPLETE\n")
    write(root, "vendor-resume.log", "COMBINED_VENDOR_VALIDATION_PASS\nVENDOR_VALIDATION_EXIT_CODE=0\n")
    write(root, "simulation-resume/simulation.txt",
          "COMBINED_VENDOR_BOOT_PASS: entry=00004610 cycles=10691\n")
    write(root, "model-validation-supported.log",
          "COMBINED_MODEL_RECOVERY_PASS\nMODEL_VALIDATION_EXIT_CODE=0\n")
    write(root, "model-results/result.json", json.dumps(dict(
        imageSha256=gate.IMAGE, outcome="continuation-resumed",
        bootCompletedAfterAuthorization=True,
        recoveryRetirements=[[0, 0], [0, 0], [0x2870, 0]] + [[0, 0]] * 97,
        faults=[{}])))
    return root


@pytest.mark.parametrize("name", [
    "inputs.sha256", "mapped.v", "synthesized.dcp", "mapped-boot-tb-fixed.v",
    "model-support/server/lump_approvals.py", "vendor-resume.log",
    "simulation-resume/simulation.txt", "model-validation-supported.log",
])
def test_reject_changed_or_missing_evidence(source, name):
    (source / name).write_text("corrupt")
    with pytest.raises(ValueError):
        gate.check_source(source)


@pytest.mark.parametrize("field,value", [
    ("imageSha256", "wrong"), ("outcome", "deadline"),
    ("bootCompletedAfterAuthorization", False),
    ("recoveryRetirements", [[0, 0]] * 100), ("faults", [{}, {}]),
])
def test_reject_wrong_recovery(source, field, value):
    path = source / "model-results/result.json"
    result = json.loads(path.read_text())
    result[field] = value
    path.write_text(json.dumps(result))
    with pytest.raises(ValueError):
        gate.check_source(source)


def test_observer_must_only_move_declaration(source):
    write(source, "mapped-boot-tb-fixed.v", "module full_boot_tb;\n// bypass")
    manifest(source, "resumed-simulation-inputs.sha256",
             ["mapped.v", "mapped-boot-tb-fixed.v", "synthesized.dcp"])
    with pytest.raises(ValueError, match="declaration order"):
        gate.check_source(source)


def test_prepare_preserves_and_binds_evidence(source, tmp_path):
    bundle = tmp_path / "bundle"
    package(bundle)
    target = tmp_path / "build"
    gate.prepare(source, target, bundle)
    gate.verify(target)
    assert (target / "input.dcp").read_bytes() == (source / "synthesized.dcp").read_bytes()
    assert not (target / "route-started").exists()
    with pytest.raises(FileExistsError):
        gate.prepare(source, target, bundle)
    write(target, "evidence/vendor-resume.log", "changed")
    with pytest.raises(ValueError, match="Saved evidence"):
        gate.verify(target)


def test_package_is_build_only_and_syntax_valid(tmp_path):
    bundle = tmp_path / "bundle"
    package(bundle)
    tcl = (bundle / "route.tcl").read_text()
    assert "open_checkpoint input.dcp" in tcl
    assert "combined_route.py --timing" in tcl
    for forbidden in ("synth_design", "launch_runs", "program_hw", "open_hw", "write_cfgmem"):
        assert forbidden not in tcl
    assert tcl.index("--timing") < tcl.index("write_bitstream")
    subprocess.run(["bash", "-n", str(bundle / "run.sh")], check=True)
    # Extraction/import must work without the repository on sys.path.
    subprocess.run(["python3", "-I", "-c",
                    f"import sys; sys.path.insert(0, {str(bundle)!r}); import combined_route"],
                   cwd=tmp_path, check=True)


def test_manifest_path_traversal_rejected(source):
    write(source, "bad.sha256", "0" * 64 + "  ../outside\n")
    with pytest.raises(ValueError, match="Unsafe"):
        gate.checksums(source, "bad.sha256")
