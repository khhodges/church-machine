"""Offline build-runner tests: fixtures are not vendor implementation evidence."""
import json
from pathlib import Path
import shutil
import subprocess
import pytest
from scripts import combined_route as common
from scripts import uart_packet_route as gate
from scripts import package_uart_packet_route as packager

REPO = Path(__file__).resolve().parents[1]


def write(root, name, content):
    dest = root / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content)


def manifest(root, name, files):
    write(root, name, "".join(f"{common.sha(root / f)}  {f}\n" for f in files))
    return common.sha(root / name)


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    source = tmp_path / "validation"
    resources = tmp_path / "resources"
    image = "source-snapshot/generated-artifacts/data-access-validation/admitted.bin"
    write(source, image, "fixture image")
    monkeypatch.setattr(common, "IMAGE", common.sha(source / image))
    uart_files = {"hardware/wukong_top.py": "top", "hardware/uart_packet_arbiter.py": "arbiter"}
    for name, text in uart_files.items():
        write(source, "source-snapshot/" + name, text)
    write(source, "provenance.json", json.dumps({
        "imageSha256": common.IMAGE,
        "uartPacketAtomicSources": {
            n: common.sha(source / "source-snapshot" / n) for n in uart_files},
    }))
    monkeypatch.setattr(gate, "INPUTS", manifest(source, "inputs.sha256",
        [image, "provenance.json"] + ["source-snapshot/" + n for n in uart_files]))
    for name in ("mapped.v", "mapped-boot-tb.v", "synthesized.dcp"):
        write(source, name, "fixture " + name)
    manifest(source, "synthesized-inputs.sha256",
             ["mapped.v", "mapped-boot-tb.v", "synthesized.dcp"])
    write(source, "synthesis.log", "COMBINED_SYNTH_EXPORT_COMPLETE\n")
    write(source, "vendor-validation.log", "COMBINED_VENDOR_VALIDATION_PASS\n")
    write(source, "simulation-work/simulation.txt",
          "COMBINED_VENDOR_BOOT_PASS: entry=00004610 cycles=211530\n")
    model = resources / "generated-artifacts/uart-packet-atomic-validation"
    write(model, "model-results/result.json", json.dumps(dict(
        imageSha256=common.IMAGE, outcome="continuation-resumed",
        runCouldNotBypassFault=True, authorizedAfterSnapshot=True, resetObserved=True,
        bootCompletedAfterAuthorization=True, snapshot={}, faults=[dict(code=8)],
        recoveryRetirements=[[0, 0], [4, 0], [0x2870, 0]] + [[0, 0]] * 97)))
    write(model, "model.log", "COMBINED_MODEL_RECOVERY_PASS\n")
    monkeypatch.setattr(gate, "MODEL_RESULT", common.sha(model / "model-results/result.json"))
    monkeypatch.setattr(gate, "MODEL_LOG", common.sha(model / "model.log"))
    for name in ("scripts/uart_packet_route.py", "scripts/combined_route.py",
                 "scripts/initializer_route_verify.py", "hardware/initializer_route.tcl",
                 "hardware/guarded_25mhz_clock_checks.tcl"):
        dest = resources / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / name, dest)
    monkeypatch.setattr(packager, "ROOT", resources)
    bundle = tmp_path / "bundle"
    packager.package(bundle)
    monkeypatch.setattr(gate, "ROOT", bundle)
    return source, bundle


@pytest.mark.parametrize("name", [
    "inputs.sha256", "provenance.json", "synthesized.dcp", "mapped.v", "mapped-boot-tb.v",
    "synthesized-inputs.sha256", "synthesis.log", "vendor-validation.log",
    "simulation-work/simulation.txt", "source-snapshot/hardware/uart_packet_arbiter.py",
])
def test_rejects_changed_validation_evidence(fixture, name):
    source, _ = fixture
    write(source, name, "changed")
    with pytest.raises(ValueError):
        gate.check_source(source)


@pytest.mark.parametrize("field,value", [
    ("imageSha256", "wrong"), ("outcome", "deadline"), ("runCouldNotBypassFault", False),
    ("authorizedAfterSnapshot", False), ("resetObserved", False),
    ("bootCompletedAfterAuthorization", False), ("snapshot", None),
    ("faults", []), ("faults", [dict(code=9)]), ("recoveryRetirements", [[0, 0]] * 100),
])
def test_recovery_assertions_are_required(fixture, monkeypatch, field, value):
    source, bundle = fixture
    result = json.loads((bundle / "model-result.json").read_text())
    result[field] = value
    write(bundle, "model-result.json", json.dumps(result))
    monkeypatch.setattr(gate, "MODEL_RESULT", common.sha(bundle / "model-result.json"))
    with pytest.raises(ValueError, match="recovery evidence"):
        gate.check_source(source)


def test_model_hash_is_not_replaceable(fixture):
    source, bundle = fixture
    write(bundle, "model-result.json", "{}")
    with pytest.raises(ValueError, match="verified local recovery"):
        gate.check_source(source)


def test_wrong_prior_input_pin_rejected(fixture, monkeypatch):
    source, _ = fixture
    monkeypatch.setattr(gate, "INPUTS", common.INPUTS)
    with pytest.raises(ValueError, match="Wrong checksum manifest"):
        gate.check_source(source)


def test_error_or_duplicate_pass_is_not_success(fixture):
    source, _ = fixture
    write(source, "vendor-validation.log",
          "ERROR: fixture failure\nCOMBINED_VENDOR_VALIDATION_PASS\n")
    with pytest.raises(ValueError, match="Error in vendor evidence"):
        gate.check_source(source)
    write(source, "vendor-validation.log", "COMBINED_VENDOR_VALIDATION_PASS\n" * 2)
    with pytest.raises(ValueError, match="ambiguous"):
        gate.check_source(source)


def test_prepare_and_verify_checkpoint_and_evidence(fixture, tmp_path):
    source, bundle = fixture
    target = tmp_path / "build"
    common.prepare(source, target, bundle, validate_source=gate.check_source)
    common.verify(target, validate_source=gate.check_source)
    assert (target / "input.dcp").read_bytes() == (source / "synthesized.dcp").read_bytes()
    assert (target / "model-result.json").read_bytes() == (bundle / "model-result.json").read_bytes()
    assert not (target / "route-started").exists()
    with pytest.raises(FileExistsError):
        common.prepare(source, target, bundle, validate_source=gate.check_source)
    write(target, "input.dcp", "replaced")
    with pytest.raises(ValueError, match="validated checkpoint"):
        common.verify(target, validate_source=gate.check_source)
    shutil.copyfile(source / "synthesized.dcp", target / "input.dcp")
    write(target, "evidence/vendor-validation.log", "replaced")
    with pytest.raises(ValueError, match="Saved evidence"):
        common.verify(target, validate_source=gate.check_source)


def test_package_preserves_existing_pre_bitstream_gates(fixture, tmp_path):
    _, bundle = fixture
    tcl = (bundle / "route.tcl").read_text()
    original = (REPO / "hardware/initializer_route.tcl").read_text()
    assert tcl == original.replace("initializer_route_verify.py", "uart_packet_route.py")
    assert "open_checkpoint input.dcp" in tcl
    assert tcl.index("--timing") < tcl.index("write_bitstream")
    for forbidden in ("synth_design", "launch_runs", "program_hw", "open_hw", "write_cfgmem"):
        assert forbidden not in tcl
    common.checksums(bundle, "checksums.sha256")
    subprocess.run(["bash", "-n", str(bundle / "run.sh")], check=True)
    subprocess.run(["python3", "-I", "-c",
                    f"import sys; sys.path.insert(0, {str(bundle)!r}); import uart_packet_route"],
                   cwd=tmp_path, check=True)
