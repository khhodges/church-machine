"""Fail-closed checks for the separate, synthesized-boot-tested continuation."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

PINNED = {
    "mapped.v": "288f6ccdb6cc0db596af7adb4ce2631049be5e3c3b8d09b3e2cc7a9e2eb57792",
    "mapped-boot-tb.v": "2e2cfbabda4eb0efd29f45a0f9899dc7c3d9bf2101dcced8445bedcc012deb70",
    "synthesized.dcp": "16a3795f07b5008f012c1b035c5221df07f30df47682f50b1c275f0f3d7da629",
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def timing_summary(text):
    lines = text.splitlines()
    headers = [i for i, line in enumerate(lines)
               if line.strip().startswith("WNS(ns)") and "TPWS Total Endpoints" in line]
    if len(headers) != 1:
        raise ValueError("Missing/ambiguous design-wide timing summary")
    fields = lines[headers[0] + 2].split()
    if len(fields) != 12 or any(not re.fullmatch(r"-?\d+(?:\.\d+)?", v) for v in fields):
        raise ValueError("Malformed timing summary")
    values = list(map(float, fields))
    if any(v < 0 for v in values):
        raise ValueError("Negative timing evidence")
    for i in (1, 2, 5, 6, 9, 10):
        if values[i] != 0:
            raise ValueError("Failing timing endpoints or total slack")
    for i in (3, 7, 11):
        if not values[i].is_integer() or values[i] <= 0:
            raise ValueError("Missing timed endpoints")
    return dict(zip(("WNS", "TNS", "setupFail", "setupTotal", "WHS", "THS",
                     "holdFail", "holdTotal", "WPWS", "TPWS", "pulseFail", "pulseTotal"), values))


def verify(root):
    meta = json.loads((root / "continuation.json").read_text())
    source = Path(meta["sourceDirectory"])
    if sha(source / "inputs.sha256") != meta["sourceInputsSha256"]:
        raise ValueError("Original package checksum list changed")
    subprocess.run(["sha256sum", "-c", "inputs.sha256"], cwd=source,
                   check=True, stdout=subprocess.DEVNULL)
    for name, expected in PINNED.items():
        if sha(source / name) != expected:
            raise ValueError(f"Tested input changed: {name}")
    for name, expected in meta["files"].items():
        if Path(name).name != name or sha(root / name) != expected:
            raise ValueError(f"Continuation input changed: {name}")
    if sha(root / "input.dcp") != PINNED["synthesized.dcp"]:
        raise ValueError("Checkpoint differs from tested synthesis")
    return meta


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    if len(sys.argv) == 2 and sys.argv[1] == "--timing":
        print(json.dumps(timing_summary((root / "timing.txt").read_text())))
    elif len(sys.argv) == 3 and sys.argv[1] == "--record":
        meta = verify(root)
        receipt = dict(
            schema="church.experimental-initializer-route/v1",
            vivado=sys.argv[2], inputCheckpointSha256=PINNED["synthesized.dcp"],
            files={n: sha(root / n) for n in (
                "candidate-EXPERIMENTAL.bit", "routed.dcp", "timing.txt", "drc.txt",
                "precise-slack.txt", "continuation.json")},
            timing=timing_summary((root / "timing.txt").read_text()),
            physicalTested=False, fullProgramTested=False, releaseApproved=False,
        )
        with (root / "build-receipt.json").open("x") as stream:
            json.dump(receipt, stream, indent=2)
        print("EXPERIMENTAL_BITSTREAM_READY")
    elif len(sys.argv) == 1:
        verify(root)
        print("TESTED_INPUTS_VERIFIED")
    else:
        raise SystemExit("No overrides supported")
