"""Make the three SYSTEM startup dependencies resident in a private candidate."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from server.design_simulation import api_only
from server.namespace_binding_report import binding_report
from server.namespace_design_v1 import digest

STARTUP = {6: "ide.SelfTest", 7: "ide.WukongCallHome", 10: "ide.CapabilityTest"}


def install(raw, records, bodies):
    """Replace only reserved absent bodies, with exact-size linked executables."""
    if set(bodies) != set(STARTUP):
        raise ValueError("Exactly the selected startup dependencies must be supplied")
    candidate = bytearray(raw)
    updated = copy.deepcopy(records)
    ranges = []
    for slot, name in STARTUP.items():
        matching = [r for r in updated if r["slot"] == slot and r["name"] == name]
        if len(matching) != 1:
            raise ValueError("Missing or ambiguous startup reservation")
        record = matching[0]
        base, size = record["locationWords"] * 4, record["allocationWords"] * 4
        end = base + size
        body = bodies[slot]
        if base < 16 * 64 or end > len(raw) or any(base < b and a < end for a, b in ranges):
            raise ValueError("Invalid or overlapping startup reservation")
        ranges.append((base, end))
        if len(body) != size:
            raise ValueError("Resident body exceeds or differs from its reserved allocation")
        words = struct.unpack(f">{size//4}I", body)
        if ((words[0] >> 8) & 3) != 0 or not ((words[0] >> 10) & 8191):
            raise ValueError("Resident body must contain executable Inform code")
        expected = words[0] & ~(8191 << 10)
        if expected != record["absentHeader"] or struct.unpack_from("<I", raw, base)[0] != expected:
            raise ValueError("Absent header differs from selected executable geometry")
        if any(raw[base+4:end]):
            raise ValueError("Reservation already contains data")
        if list(struct.unpack_from("<4I", raw, slot*16)) != record["descriptor"]:
            raise ValueError("Reserved descriptor changed")
        candidate[base:end] = struct.pack(f"<{len(words)}I", *words)
        record.update(contentInstalled=True, policy="Resident",
                      residentBinarySha256=hashlib.sha256(body).hexdigest())
    allowed = set(i for a, b in ranges for i in range(a, b))
    if any(a != b and i not in allowed for i, (a, b) in enumerate(zip(raw, candidate))):
        raise AssertionError("Changed bytes outside startup bodies")
    return bytes(candidate), updated


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--absent-candidate", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    source, absent, output = args.source.resolve(), args.absent_candidate.resolve(), args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / "generated-artifacts"):
        raise ValueError("Choose a fresh generated-artifacts output")
    manifest = json.loads((source / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        path = (source / name).resolve()
        if not path.is_relative_to(source) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Retained input changed: {name}")
    receipt = json.loads((absent / "preparation.json").read_text())
    raw = (absent / "boot2.bin").read_bytes()
    if hashlib.sha256(raw).hexdigest() != receipt["imageSha256"]:
        raise ValueError("Absent candidate differs from its receipt")
    document = json.loads((source / "resolved-design.json").read_text())
    for row in document["rows"]:
        if row["slot"] in STARTUP:
            if row["name"] != STARTUP[row["slot"]]:
                raise ValueError("Startup selection changed")
            row["policy"] = "Resident"
    with TemporaryDirectory(prefix="boot2-startup-") as temp:
        private = Path(temp) / "lumps"
        shutil.copytree(source / "private-lumps", private)
        report = binding_report(document, private, digest(document), bind_now=True)
        bodies, evidence = {}, []
        for slot, name in STARTUP.items():
            item = next(i for i in report["lists"] if i["slot"] == slot)
            if item["status"] != "bound" or not item.get("boundWords"):
                raise ValueError(f"{name}: authenticated binding failed: {item.get('reason', item['status'])}")
            words = item["boundWords"]
            localized = struct.pack(f">{len(words)}I", *words)
            if hashlib.sha256(localized).hexdigest() != item["derivativeHash"]:
                raise ValueError("Linked body integrity mismatch")
            bodies[slot] = api_only(localized)
            evidence.append({key: item[key] for key in
                             ("slot", "name", "sourceHash", "derivativeHash", "rows", "status")})
        candidate, records = install(raw, receipt["records"], bodies)
    output.mkdir()
    (output / "boot2.bin").write_bytes(candidate)
    (output / "local-design.json").write_text(json.dumps(document, indent=2)+"\n")
    (output / "binding-evidence.json").write_text(json.dumps(evidence, indent=2)+"\n")
    new = dict(sourceSha256=receipt["imageSha256"], imageSha256=hashlib.sha256(candidate).hexdigest(),
               records=records, residentStartup=STARTUP, hardwareOperations=False,
               sourceChanged=False, scope="three resident startup bodies; USER dependencies remain Lazy")
    (output / "preparation.json").write_text(json.dumps(new, indent=2)+"\n")
    print(json.dumps(new))


if __name__ == "__main__":
    main()
