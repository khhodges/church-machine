"""Bind retained local evidence without rewriting original failing test records."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from prepare_candidate import ROOT, HERE, PARENT_MANIFEST, expected_sources, source_map

OUT = ROOT / "generated-artifacts"


def cases(name):
    path = OUT / name
    entries = list(ET.parse(path).iter("testcase"))
    return [(e.attrib["name"], not any(e.find(tag) is not None
                                     for tag in ("failure", "error", "skipped"))) for e in entries]


def main():
    expected, _ = expected_sources()
    if source_map(OUT / "request-retry-candidate") != expected:
        raise ValueError("Candidate source drift")
    original = cases("request-retry-fulltop-results.xml")
    failures = [name for name, ok in original if not ok]
    if len(original) != 12 or failures != ["test_full_top[early_response-125000]"]:
        raise ValueError(f"Unexpected original run results: {original}")
    rerun = cases("request-retry-early-response-results.xml")
    if rerun != [(failures[0], True)]:
        raise ValueError("Missing exact passing rerun")
    unit_host = cases("request-retry-unit-host-results.xml")
    regression = cases("request-retry-disabled-results.xml")
    if len(unit_host) != 22 or not all(ok for _, ok in unit_host):
        raise ValueError("Unit/host evidence missing or failing")
    if len(regression) != 1 or not regression[0][1]:
        raise ValueError("Prior-profile regression missing")
    names = [
        "request-retry-fulltop-results.xml", "request-retry-fulltop.log",
        "request-retry-early-response-results.xml", "request-retry-unit-host-results.xml",
        "request-retry-disabled-results.xml", "request-retry-sim-capture.bin",
    ]
    paths = [OUT / name for name in names] + sorted(HERE.glob("*.py")) + [
        HERE / "README.md", HERE / "top-integration.patch"]
    manifest = dict(
        schema="church.request-retry-local-evidence/v1",
        parentManifestSha256=PARENT_MANIFEST,
        candidateSourceFiles=expected,
        sourceFilesSha256=hashlib.sha256(json.dumps(expected, sort_keys=True,
                                                   separators=(",", ":")).encode()).hexdigest(),
        uniquePassingCases=35,
        fullTop=dict(originalPassed=11, originalFailed=1, passingRerun=failures[0],
                     explanation="Only the early-input request-count assertion was corrected; "
                     "hard fault, no acceptance and zero destination writes already passed. "
                     "No RTL fix was needed. Original failure is retained, not erased."),
        warnings="Amaranth monitor sync-domain placement deprecation for future 0.6; no runtime assertion warning suppressed.",
        productionChanged=False, vendorBuilt=False, physicalBoardTested=False,
        files={p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
    )
    (OUT / "request-retry-local-evidence.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("REQUEST_RETRY_LOCAL_EVIDENCE_VERIFIED", manifest["uniquePassingCases"])


if __name__ == "__main__":
    main()
