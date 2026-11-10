"""Offline build verifier. Never connects to a builder or board."""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from initializer_route_verify import timing_summary

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def verify():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    require(manifest["schema"] == "church.cooperative-retry-build/v1", "Wrong package")
    for name, digest in manifest["files"].items():
        path = (ROOT / name).resolve()
        require(path.is_relative_to(ROOT) and sha(path) == digest, f"Changed: {name}")
    require(sha(ROOT / "candidate-le.bin") == manifest["imageSha256"], "Wrong image")
    profile = json.loads((ROOT / "rtl/guarded-profile.json").read_text())
    for key, value in dict(profile="diagnostic-cooperative-retry-25mhz",
                           clockHz=25000000, uartBaud=57600,
                           executionWatchdogIntegrated=True,
                           diagnosticRetryReturnStop=False,
                           debugCommandsEnabled=False,
                           imageSha256=manifest["imageSha256"]).items():
        require(profile[key] == value, f"Wrong profile: {key}")
    cases = list(ET.parse(ROOT / "evidence/final.xml").iter("testcase"))
    require(len(cases) == 21 and all(not any(c.find(t) is not None
            for t in ("failure", "error", "skipped")) for c in cases),
            "Missing full local acceptance")
    for name, digest in manifest["sourceFiles"].items():
        require(sha(ROOT / "source-snapshot" / name) == digest, f"Wrong source: {name}")
    if (ROOT / "synthesis.sha256").exists():
        digest, name = (ROOT / "synthesis.sha256").read_text().split()
        require(name == "synthesized.dcp" and sha(ROOT / name) == digest, "Changed checkpoint")
    return manifest


if __name__ == "__main__":
    manifest = verify()
    args = sys.argv[1:]
    if not args:
        print("COOPERATIVE_RETRY_PACKAGE_VERIFIED")
    elif args == ["--timing"]:
        print(json.dumps(timing_summary((ROOT / "timing.txt").read_text())))
    elif len(args) == 2 and args[0] == "--record":
        require(args[1].startswith("2026.1"), "Requires reviewed Vivado 2026.1")
        timing = timing_summary((ROOT / "timing.txt").read_text())
        outputs = ["candidate-EXPERIMENTAL.bit", "routed.dcp", "synthesized.dcp",
                   "timing.txt", "precise-slack.txt", "drc.txt", "route-status.txt"]
        receipt = dict(schema=manifest["schema"], case=manifest["case"],
                       imageSha256=manifest["imageSha256"],
                       manifestSha256=sha(ROOT / "manifest.json"),
                       vivadoVersion=args[1], timing=timing,
                       executionWatchdogIntegrated=True, physicalBoardTested=False,
                       programmingAuthorized=False, releaseApproved=False,
                       files={name: sha(ROOT / name) for name in outputs})
        with (ROOT / "build-receipt.json").open("x") as output:
            json.dump(receipt, output, indent=2)
        print("COOPERATIVE_RETRY_BUILD_RECEIPT_WRITTEN")
    else:
        raise SystemExit("Usage: verify.py [--timing | --record VERSION]")
