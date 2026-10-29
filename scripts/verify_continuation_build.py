"""Standalone integrity gate and timing-clean receipt for the isolated build."""
import hashlib
import json
import math
from pathlib import Path
import sys

IMAGE = "e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(root):
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest["schema"] != "church.continuation-build/v1":
        raise ValueError("Wrong build manifest")
    for name, expected in manifest["files"].items():
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()) or digest(path) != expected:
            raise ValueError("Input mismatch: " + name)
    profile = json.loads((root / "profile.json").read_text())
    if (profile["profile"] != "factory-continuation-25mhz-v1" or
            profile["imageSha256"] != IMAGE or profile["expectedBootGuard"] != 0 or
            profile["clockHz"] != 25000000 or profile["clockMode"] != "mmcm-25mhz" or
            profile["part"] != "xc7a100tfgg676-2" or
            digest(root / "candidate-le.bin") != IMAGE):
        raise ValueError("Unexpected image or hardware profile")
    generated = json.loads((root / "guarded-profile.json").read_text())
    if generated["generatedFilesSha256"]["church_wukong_xc7a100t.v"] != digest(
            root / "church_wukong_xc7a100t.v"):
        raise ValueError("Generated RTL digest mismatch")
    for key, value in profile.items():
        if generated.get(key) != value:
            raise ValueError("Generated profile mismatch: " + key)
    stamp = "// CM-HARDWARE-SOURCES-SHA256: " + manifest["sourceFingerprint"]
    if stamp not in (root / "church_wukong_xc7a100t.v").read_text().splitlines()[:5]:
        raise ValueError("RTL source fingerprint mismatch")
    replay = json.loads((root / "rtl-recovery-corrected.json").read_text())
    if (replay["imageSha256"] != IMAGE or replay["outcome"] != "continuation-resumed" or
            not replay["bootCompletedAfterAuthorization"] or
            len(replay["recoveryRetirements"]) != 100):
        raise ValueError("Missing accepted exact-image recovery evidence")
    return manifest


def main():
    root = Path(__file__).resolve().parent
    manifest = verify(root)
    if len(sys.argv) > 1:
        if len(sys.argv) != 6 or sys.argv[1] != "--record":
            raise ValueError("Expected --record VERSION WNS WHS TPWS")
        values = [float(v) for v in sys.argv[3:]]
        if any(not math.isfinite(v) or v < 0 for v in values):
            raise ValueError("Timing is missing or negative")
        outputs = ["candidate-EXPERIMENTAL.bit", "routed.dcp", "timing.txt",
                   "drc.txt", "synth-utilization.txt", "routed-utilization.txt"]
        record = dict(schema="church.continuation-build-receipt/v1",
                      imageSha256=IMAGE, sourceFingerprint=manifest["sourceFingerprint"],
                      manifestSha256=digest(root / "manifest.json"),
                      vivadoVersion=sys.argv[2], timing=dict(zip(["WNS", "WHS", "TPWS"], values)),
                      files={name: digest(root / name) for name in outputs},
                      physicalBoardTested=False, programmed=False, releaseApproved=False)
        with (root / "build-receipt.json").open("x") as f:
            json.dump(record, f, indent=2)
    print("PASS: frozen continuation build inputs verified; no device programmed")


if __name__ == "__main__":
    main()
