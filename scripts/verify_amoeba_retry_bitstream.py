"""Portable fail-closed build package verifier; no network or device access."""
import hashlib
import json
from pathlib import Path
import sys
from initializer_route_verify import timing_summary

ROOT = Path(__file__).resolve().parent
IMAGE = "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d"

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def verify():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    assert manifest["imageSha256"] == IMAGE
    for name, digest in manifest["files"].items():
        path = (ROOT / name).resolve()
        assert path.is_relative_to(ROOT) and sha(path) == digest, name
    assert sha(ROOT / "candidate-le.bin") == IMAGE
    profile = json.loads((ROOT / "rtl/guarded-profile.json").read_text())
    assert profile["imageSha256"] == IMAGE
    replay = json.loads((ROOT / "replay-result.json").read_text())
    assert replay["imageSha256"] == IMAGE and replay["outcome"] == "second-fault"
    if (ROOT / "synthesis.sha256").exists():
        digest, name = (ROOT / "synthesis.sha256").read_text().split()
        assert name == "synthesized.dcp" and sha(ROOT / name) == digest
    return manifest

if __name__ == "__main__":
    manifest = verify()
    if sys.argv[1:] == ["--timing"]:
        print(json.dumps(timing_summary((ROOT / "timing.txt").read_text())))
    elif len(sys.argv) == 3 and sys.argv[1] == "--record":
        timing = timing_summary((ROOT / "timing.txt").read_text())
        names = ["candidate-EXPERIMENTAL.bit", "routed.dcp", "synthesized.dcp",
                 "timing.txt", "precise-slack.txt", "drc.txt", "route-status.txt"]
        receipt = dict(imageSha256=IMAGE, vivadoVersion=sys.argv[2], timing=timing,
                       manifestSha256=sha(ROOT / "manifest.json"),
                       physicalBoardTested=False, releaseApproved=False,
                       files={n:sha(ROOT / n) for n in names})
        with (ROOT / "build-receipt.json").open("x") as f:
            json.dump(receipt, f, indent=2)
        print("AMOEBA_RETRY_BUILD_RECEIPT_WRITTEN")
    elif not sys.argv[1:]:
        print("AMOEBA_RETRY_BUILD_INPUTS_VERIFIED")
    else:
        raise SystemExit("Unsupported verifier arguments")
