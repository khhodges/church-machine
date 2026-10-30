"""Read-only cross-layer comparison of frozen retry evidence; no board access."""
from pathlib import Path
import hashlib
import importlib
import json
import shutil
import struct
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT / "generated-artifacts/uart-packet-atomic-validation"
sys.path.insert(0, str(FROZEN / "source-snapshot"))
from hardware.wukong_bridge import (
    decode_trace_packet, decode_snapshot_frame, parse_boot_sentinel)

IMAGE = "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d"
CAPTURES = [
    ("startup", "amoeba-retry-startup-20261030-190911-786619_1793387477299.bin",
     "3d3d55d228729fe156abae8aed8a396bf396025e9a030f094942a00e39ec21bb"),
    ("reboot", "amoeba-retry-manual-reboot-20261030-191344-489410_1793387733633.bin",
     "a5d98bc704f818968b5d313966792aee04e2a029bbbe4123c3ea518776e03b39"),
]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    """Keep reset epochs and incomplete frames; never disguise a tail as text."""
    result = {"epochs": [], "prefix": "", "incomplete": None}
    epoch = None
    i = 0
    while i < len(raw):
        if raw[i] in (0xBB, 0xBC):
            item = parse_boot_sentinel(raw, i)
            if not item:
                raise ValueError(f"Incomplete boot sentinel at {i}")
            epoch = dict(sentinel=item, trace=[], snapshots=[], text="", offset=i)
            result["epochs"].append(epoch)
            i += item["length"]
        elif raw[i] == 0xAC:
            if i + 4 > len(raw):
                raise ValueError("Incomplete snapshot header")
            length = int.from_bytes(raw[i+2:i+4], "big") + 8
            frame = raw[i:i+length]
            item = decode_snapshot_frame(frame)  # Includes length/version/CRC checks.
            assert epoch is not None
            epoch["snapshots"].append(dict(offset=i, raw=frame.hex(), decoded=item))
            i += length
        elif raw[i] == 0xAA:
            if i + 12 > len(raw):
                result["incomplete"] = dict(kind="trace", offset=i, raw=raw[i:].hex())
                break
            frame = raw[i:i+12]
            item = decode_trace_packet(frame)
            if item["ev_type"] not in range(12):
                raise ValueError(f"Unknown trace event at {i}")
            assert epoch is not None
            epoch["trace"].append(dict(offset=i, raw=frame.hex(), decoded=item))
            i += 12
        else:
            if raw[i] not in (10, 13) and not 32 <= raw[i] <= 126:
                raise ValueError(f"Unrecognized byte at {i}: {raw[i]:02x}")
            if epoch is None:
                result["prefix"] += chr(raw[i])
            else:
                epoch["text"] += chr(raw[i])
            i += 1
    return result


def compare():
    trial = ROOT / "generated-artifacts/amoeba-retry-image"
    image = (trial / "candidate-le.bin").read_bytes()
    assert sha(image) == IMAGE
    rtl_raw = (trial / "results/uart.bin").read_bytes()
    rtl = parse(rtl_raw)
    model = json.loads((trial / "results/result.json").read_text())
    assert model["imageSha256"] == IMAGE
    boards = {}
    for label, name, digest in CAPTURES:
        raw = (ROOT / "attached_assets" / name).read_bytes()
        assert sha(raw) == digest
        parsed = parse(raw)
        assert len(parsed["epochs"]) == 1 and parsed["incomplete"] is None
        boards[label] = parsed
    assert len(rtl["epochs"]) == 2
    comparisons = {}
    for index, label in enumerate(("startup", "reboot")):
        a = rtl["epochs"][index]
        b = boards[label]["epochs"][0]
        pairs = list(zip(a["trace"], b["trace"]))
        differences = [n for n, (x, y) in enumerate(pairs) if x["raw"] != y["raw"]]
        comparisons[label] = dict(
            rtlCompleteTracePackets=len(a["trace"]), boardCompleteTracePackets=len(b["trace"]),
            pairedPackets=len(pairs), differingPacketIndices=differences,
            sentinelEqual=a["sentinel"] == b["sentinel"],
            applicationTextEqual=a["text"] == b["text"],
            rtlSnapshotCount=len(a["snapshots"]), boardSnapshotCount=len(b["snapshots"]),
            pairedSnapshotsEqual=[
                x["raw"] == y["raw"] for x, y in zip(a["snapshots"], b["snapshots"])])
    assert comparisons["startup"]["differingPacketIndices"] == []
    assert comparisons["startup"]["pairedSnapshotsEqual"] == [True]
    assert comparisons["reboot"]["differingPacketIndices"] == []
    b = boards["reboot"]["epochs"][0]
    a = rtl["epochs"][1]
    tail = bytes.fromhex(rtl["incomplete"]["raw"])
    next_frame = bytes.fromhex(b["trace"][len(a["trace"])]["raw"])
    assert next_frame.startswith(tail)
    comparisons["reboot"]["truncatedNextPacketBytes"] = len(tail)
    comparisons["reboot"]["truncatedNextPacketMatchesBoardPrefix"] = True
    comparisons["reboot"]["boardOnlyTailPackets"] = [
        x["decoded"] for x in b["trace"][len(a["trace"]):]]
    fault = model["faults"][1]
    snapshot = b["snapshots"][0]["decoded"]
    comparisons["reboot"]["internalRtlFaultMatchesBoard"] = (
        fault["code"] == b["trace"][-1]["decoded"]["fault_code"]
        and fault["fetchAddress"] == snapshot["nia"]
        and fault["threadGT"] == snapshot["cr"][12][0]
        and fault["artifactGT"] == snapshot["cr"][14][0]
        and fault["instruction"] == struct.unpack_from("<I", image, snapshot["nia"])[0])
    software = json.loads((ROOT / "generated-artifacts/h19-retry-software/result.json").read_text())
    assert software["imageSha256"] == IMAGE
    sw = software["fault"]
    hw = boards["startup"]["epochs"][0]["snapshots"][0]["decoded"]
    software_comparison = dict(
        faultIdentityMatches=(
            sw["code"] == model["faults"][0]["code"] and sw["niaBytes"] == hw["nia"]
            and sw["threadSlot"] == hw["cr"][12][0] & 65535
            and sw["artifactSlot"] == hw["cr"][14][0] & 65535
            and sw["rawInstruction"] == model["faults"][0]["instruction"]),
        drDifferences=[dict(register=f"DR{i}", software=x, rtlAndBoard=y)
                       for i, (x, y) in enumerate(zip(sw["dr"], hw["dr"])) if x != y],
        flagsMatch=all(not x for x in sw["flags"].values()) and hw["flags"] == 0,
        softwarePostStepSto=software["postStepSto"], boardSnapshotSto=hw["sto"],
        caveat="Different observation boundaries and capability representations; do not normalize away differences or claim state equality.",
        softwareSteps=software["steps"], softwareVisitedThreadSlots=software["threads"],
        softwareSourceFiles=software["sourceSha256"])
    archive = ROOT / "attached_assets/amoeba-retry-vendor-evidence.tar_1793391382023.gz"
    assert sha(archive.read_bytes()) == "1a796051c9e415ee7ec6c4abff7949646fbd6ac6b8298b2c6d80de79d19def2f"
    with tarfile.open(archive, "r:gz") as tar:
        mapped = tar.extractfile("./mapped.v").read()
    sys.path.insert(0, str(FROZEN))
    observer = importlib.import_module("observer")
    words = struct.unpack("<16384I", image)
    pairs = [(i, w) for i, w in enumerate(words) if w]
    testbench = observer.observer(mapped.decode(), len(pairs))
    output = ROOT / "generated-artifacts/h19-retry-comparison"
    output.mkdir(exist_ok=False)
    (output / "candidate-mapped-boot-tb.v").write_text(testbench)
    (output / "pairs.hex").write_text("".join(f"{a:04x}{w:08x}\n" for a, w in pairs))
    report = dict(
        status="H19 remains open", imageSha256=IMAGE,
        sourceInputs={
            "rtlUART": sha(rtl_raw), "rtlResult": sha((trial / "results/result.json").read_bytes()),
            "frozenDecoder": sha((FROZEN / "source-snapshot/hardware/wukong_bridge.py").read_bytes()),
            "boardCaptures": {label: digest for label, _, digest in CAPTURES}},
        rtlVersusBoard=comparisons,
        softwareVersusHardware=software_comparison,
        vendorFeasibility=dict(
            mappedNetlistSha256=sha(mapped), initializerNonzeroPairs=len(pairs),
            existingBootObserverBinds=True,
            candidateBootObserverSha256=sha(testbench.encode()),
            scope="Read-only observer generated, not simulated; stops at boot entry, no UART reboot driver or full-state comparison",
            localTools={n: shutil.which(n) for n in ("iverilog", "vvp", "vivado", "xvlog", "xelab", "xsim")}),
        limitations=[
            "No vendor-mapped full-workload replay was run.",
            "Software first-fault identity matches, but DR/state equality is not established.",
            "Software observation is pre-recovery; hardware UART snapshot is later fault-hold state.",
            "RTL UART capture ends mid-packet before second snapshot; internal fault is available.",
            "Board traces and snapshots do not expose all memory writes or full protected stack memory.",
            "Current JS source is separately frozen; no software reboot replay was attempted.",
            "No hardware, installed artifacts, fault policy or original evidence was changed."])
    (output / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("softwareVersusHardware", "sourceInputs")}, indent=2))
    print("Software differences:", json.dumps(software_comparison["drDifferences"]))
    return report


if __name__ == "__main__":
    compare()
