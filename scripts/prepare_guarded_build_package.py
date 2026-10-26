"""Freeze a separate experimental vendor package; never generate replacement RTL."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.readiness import WUKONG_SOURCES, source_fingerprint
from scripts.guarded_candidate_verify import verify


def prepare(output, *, candidate="baseline"):
    retained = ROOT / "generated-artifacts/new-layout-production-rtl-lambda-operand"
    evidence = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime"
    image = evidence / "candidate-le.bin"
    compile_path = evidence / "production-verilog-compile-600s.json"
    boot_path = evidence / "production-executable-replay-boot.json"
    transcript = evidence / "production-executable-replay-boot.txt"
    if candidate in ("timing-read-selection", "timing-dwrite-capture"):
        retained = ROOT / f"generated-artifacts/new-layout-{candidate}/rtl"
        evidence = ROOT / f"docs/phase-1/reload-evidence/new-layout-{candidate}"
        compile_path, boot_path, transcript = (
            evidence / "compile.json", evidence / "boot.json", evidence / "boot.txt")
    elif candidate != "baseline":
        raise ValueError("Unknown explicit candidate")
    compile_record = json.loads(compile_path.read_text())
    if source_fingerprint(WUKONG_SOURCES) != compile_record["sourceFingerprint"]:
        raise ValueError("Hardware source changed since retained compile; do not regenerate silently")
    output.mkdir(parents=True, exist_ok=False)
    inputs = {
        "church_wukong_xc7a100t.v": retained / "church_wukong_xc7a100t.v",
        "guarded-profile.json": retained / "guarded-profile.json",
        "profile.json": ROOT / "hardware/profiles/new_layout_guarded.json",
        "candidate-le.bin": image,
        "compile.json": compile_path,
        "boot.json": boot_path,
        "boot.txt": transcript,
        "wukong_xc7a100t.xdc": ROOT / "hardware/wukong_xc7a100t.xdc",
        "build.tcl": ROOT / "hardware/guarded_candidate_build.tcl",
        "verify.py": ROOT / "scripts/guarded_candidate_verify.py",
    }
    if candidate == "timing-dwrite-capture":
        for name in ("regression-summary.json", "regression-run.txt", "baseline-failures.txt"):
            inputs[name] = evidence / name
    for name, source in inputs.items():
        shutil.copyfile(source, output / name)
    manifest = {
        "schema": "church.experimental-guarded-package/v1",
        "candidate": candidate,
        "imageSha256": hashlib.sha256((output / "candidate-le.bin").read_bytes()).hexdigest(),
        "files": {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
                  for name in inputs},
        "releaseVerified": False,
        "purpose": "User-requested isolated offline experimental synthesis; no programming",
        "pendingGates": ["full program replay / Mallory denial", "fault-code conformance",
                         "full UART reload", "physical board identification and acceptance",
                         "release approval"],
    }
    if candidate == "timing-dwrite-capture":
        manifest["pendingGates"].append("three pre-existing conformance-suite failures")
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    verify(output)
    archive = output.with_suffix(".tar.gz")
    with tarfile.open(archive, "x:gz") as tar:
        tar.add(output, arcname=output.name)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    print(f"{checksum}  {archive}")
    return archive


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=["baseline", "timing-read-selection", "timing-dwrite-capture"],
                        default="baseline")
    args = parser.parse_args()
    name = {"baseline": "new-layout-guarded-build",
            "timing-read-selection": "new-layout-timing-build",
            "timing-dwrite-capture": "new-layout-dwrite-build"}[args.candidate]
    prepare(ROOT / "generated-artifacts" / name, candidate=args.candidate)
