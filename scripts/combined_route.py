"""Prepare/verify build-only routing from the exact combined validation evidence."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

try:
    from initializer_route_verify import timing_summary
except ModuleNotFoundError:
    from scripts.initializer_route_verify import timing_summary

INPUTS = "f32ed2114a63138dc0d85d2122677f52abbf5b0824e002f0c04f8511ec7aa331"
SUPPORT = "f2092306edde80c07a74d6a55bb8fba0a03d444b89207e6c4aea81c06526c3c8"
IMAGE = "e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102"
EVIDENCE = (
    "inputs.sha256", "synthesized-inputs.sha256", "resumed-simulation-inputs.sha256",
    "model-support.sha256", "provenance.json", "synthesis.log", "vendor-resume.log",
    "simulation-resume/simulation.txt", "model-validation-supported.log",
    "model-results/result.json",
)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe(root, name):
    path = root / name
    require(not Path(name).is_absolute() and ".." not in Path(name).parts,
            f"Unsafe manifest path: {name}")
    require(path.resolve().is_relative_to(root.resolve()), f"Escaped path: {name}")
    return path


def checksums(root, filename, pinned=None):
    manifest = root / filename
    if pinned:
        require(sha(manifest) == pinned, f"Wrong checksum manifest: {filename}")
    entries = {}
    for line in manifest.read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        require(match is not None, f"Malformed checksum: {filename}")
        digest, name = match.groups()
        require(name not in entries, f"Duplicate checksum: {name}")
        require(sha(safe(root, name)) == digest, f"Changed input: {name}")
        entries[name] = digest
    require(bool(entries), f"Empty manifest: {filename}")
    return entries


def marker(path, expected):
    require(path.read_text().splitlines().count(expected) == 1,
            f"Missing/ambiguous result {expected}: {path.name}")


def check_source(source):
    checksums(source, "inputs.sha256", INPUTS)
    checksums(source, "model-support.sha256", SUPPORT)
    original = checksums(source, "synthesized-inputs.sha256")
    resumed = checksums(source, "resumed-simulation-inputs.sha256")
    require(set(original) == {"mapped.v", "mapped-boot-tb.v", "synthesized.dcp"},
            "Unexpected original synthesis evidence")
    require(set(resumed) == {"mapped.v", "mapped-boot-tb-fixed.v", "synthesized.dcp"},
            "Unexpected resumed synthesis evidence")
    for name in ("mapped.v", "synthesized.dcp"):
        require(original[name] == resumed[name], f"Resumed synthesis differs: {name}")
    text = (source / "mapped-boot-tb.v").read_text()
    decl, header = "integer write_count=0;\n", "module full_boot_tb;\n"
    require(text.count(decl) == 1 and text.count(header) == 1, "Unexpected observer")
    corrected = text.replace(decl, "", 1).replace(header, header + decl, 1)
    require((source / "mapped-boot-tb-fixed.v").read_text() == corrected,
            "Observer correction changed more than declaration order")
    marker(source / "synthesis.log", "COMBINED_SYNTH_EXPORT_COMPLETE")
    marker(source / "vendor-resume.log", "COMBINED_VENDOR_VALIDATION_PASS")
    marker(source / "vendor-resume.log", "VENDOR_VALIDATION_EXIT_CODE=0")
    boot = (source / "simulation-resume/simulation.txt").read_text()
    require(len(re.findall(r"^COMBINED_VENDOR_BOOT_PASS: entry=00004610 cycles=\d+$",
                           boot, re.M)) == 1, "Missing exact combined boot pass")
    log = source / "model-validation-supported.log"
    marker(log, "COMBINED_MODEL_RECOVERY_PASS")
    marker(log, "MODEL_VALIDATION_EXIT_CODE=0")
    result = json.loads((source / "model-results/result.json").read_text())
    require(result["imageSha256"] == IMAGE, "Wrong recovery image")
    require(result["outcome"] == "continuation-resumed"
            and result["bootCompletedAfterAuthorization"] is True,
            "Recovery did not complete")
    require(len(result["recoveryRetirements"]) == 100
            and result["recoveryRetirements"][2][0] == 0x2870
            and len(result["faults"]) == 1, "Recovery evidence differs")
    require(sha(source / "source-snapshot/generated-artifacts/data-access-validation/admitted.bin")
            == IMAGE, "Approved image changed")
    return {name: sha(source / name) for name in EVIDENCE}


def prepare(source, target, bundle):
    checksums(bundle, "checksums.sha256")
    evidence = check_source(source)
    target.mkdir(exist_ok=False)
    for name in checksums(bundle, "checksums.sha256"):
        shutil.copyfile(bundle / name, target / name)
    shutil.copyfile(bundle / "checksums.sha256", target / "checksums.sha256")
    for name in EVIDENCE:
        dest = target / "evidence" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, dest)
    shutil.copyfile(source / "synthesized.dcp", target / "input.dcp")
    meta = dict(sourceDirectory=str(source), evidence=evidence,
                inputCheckpointSha256=sha(source / "synthesized.dcp"),
                imageSha256=IMAGE, scope="Experimental build only; no board access")
    (target / "continuation.json").write_text(json.dumps(meta, indent=2) + "\n")
    verify(target)
    print(f"COMBINED_ROUTE_PREPARED: {target}")
    print("No Vivado or board command started.")


def verify(root):
    checksums(root, "checksums.sha256")
    meta = json.loads((root / "continuation.json").read_text())
    source = Path(meta["sourceDirectory"])
    require(check_source(source) == meta["evidence"], "Validation evidence changed")
    for name, digest in meta["evidence"].items():
        require(sha(safe(root / "evidence", name)) == digest, f"Saved evidence changed: {name}")
    require(sha(root / "input.dcp") == sha(source / "synthesized.dcp")
            == meta["inputCheckpointSha256"], "Not the validated checkpoint")
    return meta


def record(root, version):
    meta = verify(root)
    names = ("candidate-EXPERIMENTAL.bit", "routed.dcp", "timing.txt", "drc.txt",
             "precise-slack.txt", "route-status.txt", "routed-utilization.txt",
             "continuation.json", "checksums.sha256")
    require(all((root / n).stat().st_size > 0 for n in names), "Missing/empty output")
    receipt = dict(schema="church.combined-experimental-build/v1",
                   vivado=version, inputCheckpointSha256=meta["inputCheckpointSha256"],
                   imageSha256=IMAGE, evidence=meta["evidence"],
                   files={n: sha(root / n) for n in names},
                   timing=timing_summary((root / "timing.txt").read_text()),
                   physicalTested=False, releaseApproved=False, boardProgrammed=False)
    with (root / "build-receipt.json").open("x") as stream:
        json.dump(receipt, stream, indent=2)
    print("COMBINED_EXPERIMENTAL_BITSTREAM_READY")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    if len(sys.argv) == 4 and sys.argv[1] == "--prepare":
        prepare(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve(), root)
    elif len(sys.argv) == 2 and sys.argv[1] == "--timing":
        print(json.dumps(timing_summary((root / "timing.txt").read_text())))
    elif len(sys.argv) == 3 and sys.argv[1] == "--record":
        record(root, sys.argv[2])
    elif len(sys.argv) == 1:
        verify(root)
        print("COMBINED_TESTED_INPUTS_VERIFIED")
    else:
        raise SystemExit("Usage: combined_route.py [--prepare SOURCE NEW_TARGET | --timing | --record VERSION]")
