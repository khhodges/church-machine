"""Freeze the boot-tested 25 MHz candidate for experimental vendor synthesis."""
import base64
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.readiness import WUKONG_SOURCES, source_fingerprint
from scripts.guarded_candidate_verify import verify, digest

REPLAY = ROOT / "generated-artifacts/new-layout-boot25-startup-validation"
REPLAY_SHA = "a9eb90de393d44f4063540ffc52d03a5699ed61b07a5b61108ee9ba9606e3bf4"
TRANSCRIPT = ROOT / "attached_assets/Pasted-new-layout-boot25-startup-validation-tar-gz-OK-boot-tb-_1792972105288.txt"
TRANSCRIPT_SHA = "6c1be506d010fafd03c265dab82f1cb1e385d4e7d0dd1d757364dbadb4ea1b46"


def prepare(output):
    archive = REPLAY.with_suffix(".tar.gz")
    if digest(archive) != REPLAY_SHA or digest(TRANSCRIPT) != TRANSCRIPT_SHA:
        raise ValueError("Retained vendor evidence changed")
    replay_manifest = json.loads((REPLAY / "manifest.json").read_text())
    if replay_manifest["sourceFingerprint"] != source_fingerprint(WUKONG_SOURCES):
        raise ValueError("RTL source changed after vendor replay")
    # Bind the local inputs to the exact archive the user verified and ran.
    with tarfile.open(archive) as tar:
        for name in [*replay_manifest["files"], "manifest.json"]:
            with tar.extractfile(f"{REPLAY.name}/{name}") as stream:
                if stream.read() != (REPLAY / name).read_bytes():
                    raise ValueError(f"Replay archive mismatch: {name}")
    output.mkdir(parents=True, exist_ok=False)
    paths = {
        "church_wukong_xc7a100t.v": REPLAY / "church_wukong_xc7a100t.v",
        "guarded-profile.json": REPLAY / "guarded-profile.json",
        "profile.json": REPLAY / "profile.json",
        "boot_tb.v": REPLAY / "boot_tb.v",
        "replay-run.sh": REPLAY / "run.sh",
        "vendor-replay-manifest.json": REPLAY / "manifest.json",
        "boot.txt": TRANSCRIPT,
        "candidate-le.bin": ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin",
        "wukong_xc7a100t.xdc": ROOT / "hardware/wukong_xc7a100t.xdc",
        "build.tcl": ROOT / "hardware/guarded_candidate_build.tcl",
        "guarded_25mhz_clock_checks.tcl": ROOT / "hardware/guarded_25mhz_clock_checks.tcl",
        "verify.py": ROOT / "scripts/guarded_candidate_verify.py",
    }
    for name, source in paths.items():
        shutil.copyfile(source, output / name)
    observation = {
        "schema": "church.vendor-boot-observation/v1",
        "evidenceOrigin": "user-supplied droplet transcript",
        "transcriptSha256": TRANSCRIPT_SHA,
        "replayArchiveSha256": REPLAY_SHA,
        "replayManifestSha256": digest(output / "vendor-replay-manifest.json"),
        "verilogSha256": digest(output / "church_wukong_xc7a100t.v"),
        "sourceFingerprint": replay_manifest["sourceFingerprint"],
        "executableSha256": None,
        "limitation": "No exported XSim executable digest or independently fetched remote receipt",
        "bootEntry": "00003504", "bootCycles": 207812,
        "fullProgramVerified": False, "physicalBoardTested": False,
    }
    (output / "vendor-boot.json").write_text(json.dumps(observation, indent=2) + "\n")
    files = {p.name: digest(p) for p in sorted(output.iterdir())}
    manifest = {
        "schema": "church.experimental-guarded-package/v1",
        "candidate": "phase1-25mhz", "files": files,
        "imageSha256": digest(output / "candidate-le.bin"),
        "releaseVerified": False,
        "purpose": "Offline experimental 25 MHz synthesis only; no programming",
        "pendingGates": [
            "full program replay / Mallory denial", "fault-code conformance",
            "three pre-existing conformance-suite failures",
            "full UART reload", "physical board identification and acceptance",
            "GT memory integrity not implemented", "external I/O timing coverage",
            "release approval",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    verify(output)
    result = output.with_suffix(".tar.gz")
    with tarfile.open(result, "x:gz") as tar:
        tar.add(output, arcname=output.name)
    raw = result.read_bytes()
    (output / "DOWNLOAD-build25-base64.txt").write_text(base64.b64encode(raw).decode())
    print(json.dumps({"archive": str(result), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()}, indent=2))
    return result


if __name__ == "__main__":
    prepare(ROOT / "generated-artifacts/new-layout-build25")
