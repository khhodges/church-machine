"""Build-only gate for the exact UART packet-atomic validation package."""
import json
from pathlib import Path
import re
import sys

if __package__:
    from . import combined_route as common
else:
    import combined_route as common

INPUTS = "6bc0c205ae34cff37f60720c7a9b69ac12cec9b4e379cc02b96e45da10110cc0"
MODEL_RESULT = "edce79b274e4bddb28422f272c19b8f52ee3fbd7a773d00308163f081f67c746"
MODEL_LOG = "19049ece74380f660cdc5adb95ebd1213a5d83dc87d8d0f6f3c918b7724b0c91"
ROOT = Path(__file__).resolve().parent
EVIDENCE = (
    "inputs.sha256", "synthesized-inputs.sha256", "provenance.json",
    "synthesis.log", "vendor-validation.log", "simulation-work/simulation.txt",
)


def check_model(bundle):
    common.require(common.sha(bundle / "model-result.json") == MODEL_RESULT,
                   "Not the verified local recovery result")
    common.require(common.sha(bundle / "model.log") == MODEL_LOG,
                   "Not the verified local recovery log")
    common.marker(bundle / "model.log", "COMBINED_MODEL_RECOVERY_PASS")
    result = json.loads((bundle / "model-result.json").read_text())
    common.require(
        result["imageSha256"] == common.IMAGE
        and result["outcome"] == "continuation-resumed"
        and result["runCouldNotBypassFault"] is True
        and result["authorizedAfterSnapshot"] is True
        and result["resetObserved"] is True
        and result["bootCompletedAfterAuthorization"] is True
        and result["snapshot"] is not None
        and len(result["faults"]) == 1 and result["faults"][0]["code"] == 8
        and len(result["recoveryRetirements"]) == 100
        and result["recoveryRetirements"][2][0] == 0x2870,
        "Incomplete exact-image recovery evidence")


def check_source(source):
    common.checksums(source, "inputs.sha256", INPUTS)
    check_model(ROOT)
    hashes = common.checksums(source, "synthesized-inputs.sha256")
    common.require(set(hashes) == {"mapped.v", "mapped-boot-tb.v", "synthesized.dcp"},
                   "Unexpected synthesis evidence")
    common.marker(source / "synthesis.log", "COMBINED_SYNTH_EXPORT_COMPLETE")
    common.marker(source / "vendor-validation.log", "COMBINED_VENDOR_VALIDATION_PASS")
    boot = (source / "simulation-work/simulation.txt").read_text()
    common.require(len(re.findall(
        r"^COMBINED_VENDOR_BOOT_PASS: entry=00004610 cycles=\d+$", boot, re.M)) == 1,
        "Missing exact vendor-mapped boot pass")
    for name in ("synthesis.log", "vendor-validation.log", "simulation-work/simulation.txt"):
        common.require(not re.search(r"^(?:ERROR:|FATAL|Traceback)", (source / name).read_text(), re.M),
                       f"Error in vendor evidence: {name}")
    provenance = json.loads((source / "provenance.json").read_text())
    common.require(provenance["imageSha256"] == common.IMAGE, "Wrong image provenance")
    common.require(common.sha(source / "source-snapshot/generated-artifacts/data-access-validation/admitted.bin")
                   == common.IMAGE, "Approved image changed")
    required = {"hardware/wukong_top.py", "hardware/uart_packet_arbiter.py"}
    common.require(set(provenance["uartPacketAtomicSources"]) == required,
                   "Missing UART correction provenance")
    for name, digest in provenance["uartPacketAtomicSources"].items():
        common.require(common.sha(common.safe(source / "source-snapshot", name)) == digest,
                       f"UART correction changed: {name}")
    return {name: common.sha(source / name) for name in EVIDENCE}


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--prepare":
        common.prepare(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve(),
                       ROOT, validate_source=check_source)
    elif len(sys.argv) == 2 and sys.argv[1] == "--timing":
        print(json.dumps(common.timing_summary((ROOT / "timing.txt").read_text())))
    elif len(sys.argv) == 3 and sys.argv[1] == "--record":
        common.record(ROOT, sys.argv[2], validate_source=check_source)
    elif len(sys.argv) == 1:
        common.verify(ROOT, validate_source=check_source)
        print("UART_PACKET_TESTED_INPUTS_VERIFIED")
    else:
        raise SystemExit("Usage: uart_packet_route.py [--prepare SOURCE NEW_TARGET | --timing | --record VERSION]")
