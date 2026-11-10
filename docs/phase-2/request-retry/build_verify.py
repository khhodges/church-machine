"""Portable request-diagnostic build verifier. No network or device operations."""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from initializer_route_verify import timing_summary

ROOT = Path(__file__).resolve().parent
IMAGE = "930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7"
SOURCE = "54a626a8fa35c73803e1d9b92aaf56940b40030a1b81209886b8a6e5992736ca"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cases(name):
    elements = list(ET.parse(ROOT / "evidence/generated-artifacts" / name).iter("testcase"))
    return [(e.attrib["name"], not any(e.find(tag) is not None
                                     for tag in ("failure", "error", "skipped"))) for e in elements]


def verify():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    require(manifest["schema"] == "church.request-retry-diagnostic-build/v1", "Wrong package")
    require(manifest["imageSha256"] == IMAGE and sha(ROOT / "candidate-le.bin") == IMAGE,
            "Wrong fixture image")
    for name, digest in manifest["files"].items():
        path = (ROOT / name).resolve()
        require(path.is_relative_to(ROOT) and sha(path) == digest, f"Input changed: {name}")
    source_hash = hashlib.sha256(json.dumps(manifest["sourceFiles"], sort_keys=True,
                                           separators=(",", ":")).encode()).hexdigest()
    require(source_hash == SOURCE == manifest["sourceFilesSha256"], "Wrong tested sources")
    for name, digest in manifest["sourceFiles"].items():
        path = (ROOT / "source-snapshot" / name).resolve()
        require(path.is_relative_to(ROOT / "source-snapshot") and sha(path) == digest,
                f"Source changed: {name}")
    evidence = json.loads((ROOT / "evidence/request-retry-local-evidence.json").read_text())
    require(evidence["candidateSourceFiles"] == manifest["sourceFiles"], "Evidence source mismatch")
    for name, digest in evidence["files"].items():
        path = (ROOT / "evidence" / name).resolve()
        require(path.is_relative_to(ROOT / "evidence") and sha(path) == digest,
                f"Evidence changed: {name}")
    original = cases("request-retry-fulltop-results.xml")
    corrected = "test_full_top[early_response-125000]"
    require(len(original) == 12 and [name for name, ok in original if not ok] == [corrected],
            "Unexpected original full-top evidence")
    require(cases("request-retry-early-response-results.xml") == [(corrected, True)],
            "Missing exact passing rerun")
    for name, count in (("request-retry-unit-host-results.xml", 22),
                        ("request-retry-disabled-results.xml", 1)):
        rows = cases(name)
        require(len(rows) == count and all(ok for _, ok in rows), f"Missing passing evidence: {name}")
    profile = json.loads((ROOT / "rtl/guarded-profile.json").read_text())
    required = dict(profile="diagnostic-request-retry-25mhz", part="xc7a100tfgg676-2",
                    imageSha256=IMAGE, clockHz=25000000, inputClockHz=50000000,
                    clockMode="mmcm-25mhz", uartBaud=57600, expectedBootGuard=23971,
                    diagnosticUartReceive=True, diagnosticUartRequest=True,
                    diagnosticRetryReturnStop=True, diagnosticLlrStop=False,
                    debugCommandsEnabled=False, executionWatchdogIntegrated=False)
    for name, value in required.items():
        require(profile.get(name) == value, f"Profile boundary changed: {name}")
    for field, filename in (("requestFrameSha256", "request-frame.bin"),
                            ("responseFrameSha256", "response-frame.bin")):
        require(profile[field] == manifest[field] == sha(ROOT / filename), f"Frame changed: {filename}")
    require(profile["objectId"] == manifest["objectId"], "Object identity mismatch")
    for name, digest in profile["generatedFilesSha256"].items():
        path = (ROOT / "rtl" / name).resolve()
        require(path.is_relative_to(ROOT / "rtl") and sha(path) == digest, "RTL changed")
    if (ROOT / "synthesis.sha256").exists():
        digest, name = (ROOT / "synthesis.sha256").read_text().split()
        require(name == "synthesized.dcp" and sha(ROOT / name) == digest, "Checkpoint changed")
    return manifest


if __name__ == "__main__":
    manifest = verify()
    args = sys.argv[1:]
    if args == ["--timing"]:
        print(json.dumps(timing_summary((ROOT / "timing.txt").read_text())))
    elif len(args) == 2 and args[0] == "--record":
        require(args[1].startswith("2026.1"), "Requires reviewed Vivado 2026.1")
        timing = timing_summary((ROOT / "timing.txt").read_text())
        outputs = ["candidate-EXPERIMENTAL.bit", "routed.dcp", "synthesized.dcp",
                   "timing.txt", "precise-slack.txt", "drc.txt", "route-status.txt"]
        receipt = dict(
            schema="church.request-retry-diagnostic-build/v1",
            imageSha256=IMAGE, sourceFilesSha256=SOURCE,
            objectId=manifest["objectId"], requestFrameSha256=manifest["requestFrameSha256"],
            responseFrameSha256=manifest["responseFrameSha256"],
            diagnosticUartReceive=True, diagnosticUartRequest=True, debugCommandsEnabled=False,
            manifestSha256=sha(ROOT / "manifest.json"), vivadoVersion=args[1], timing=timing,
            executionWatchdogIntegrated=False, physicalBoardTested=False,
            releaseApproved=False, programmingAuthorized=False,
            files={name: sha(ROOT / name) for name in outputs})
        with (ROOT / "build-receipt.json").open("x") as output:
            json.dump(receipt, output, indent=2)
        print("REQUEST_RETRY_DIAGNOSTIC_BUILD_RECEIPT_WRITTEN")
    elif not args:
        print("REQUEST_RETRY_DIAGNOSTIC_INPUTS_VERIFIED")
    else:
        raise SystemExit("Unsupported arguments")
