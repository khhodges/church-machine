"""Local-only absent-LUMP preparation; never edits saved designs or input images."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from server.design_simulation import api_only
from hardware.integrity32 import integrity32

ORIGINAL_SHA = "1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014"


def build(raw, prepared, artifacts):
    """Reserve exact API-only allocation sizes; publish no code or C-list."""
    if len(raw) != 65536:
        raise ValueError("This local profile requires a 64 KiB image")
    memory = list(struct.unpack("<16384I", raw))
    slots = (memory[0] >> 10) & 8191
    ranges = [(r["byteAddress"] // 4, (r["byteAddress"] + r["byteLength"]) // 4)
              for r in prepared["memory_map"]["regions"]
              if r.get("resident") and r.get("byteAddress") is not None]
    cursor = max(end for _, end in ranges)
    records, allowed = [], {2}
    seen = set()
    for row in sorted(prepared["layout_rows"], key=lambda r: r["slot"]):
        if row.get("policy") != "Lazy":
            continue
        slot, sequence = row["slot"], row["seq"]
        if (slot in seen or not 3 <= slot < slots or not 0 <= sequence < 511
                or row.get("type") != "Inform" or row.get("boot")):
            raise ValueError("Invalid Lazy entry identity")
        seen.add(slot)
        if any(memory[slot * 4:slot * 4 + 4]):
            raise ValueError("Lazy entry already has a descriptor; refusing replacement")
        source = artifacts[row["filename"]]
        if hashlib.sha256(source).hexdigest() != row["binary_hash"]:
            raise ValueError("Selected Lazy artifact hash mismatch")
        compact = api_only(source)
        size = len(compact) // 4
        header = struct.unpack_from(">I", compact)[0]
        if ((header >> 8) & 3) != 0 or not ((header >> 10) & 8191):
            raise ValueError("Lazy source must be an executable Inform LUMP")
        end = cursor + size
        if end > len(memory):
            raise ValueError("Lazy reservations exceed image capacity")
        if any(memory[cursor:end]):
            raise ValueError("Lazy reservation would overwrite existing bytes")
        authority = (sequence << 21) | (size - 1)
        descriptor = [cursor, authority, integrity32(cursor, authority), 0]
        memory[slot * 4:slot * 4 + 4] = descriptor
        absent_header = header & ~(8191 << 10)
        memory[cursor] = absent_header
        allowed.update(range(slot * 4, slot * 4 + 4))
        allowed.add(cursor)
        records.append(dict(slot=slot, name=row["name"], sequence=sequence,
            locationWords=cursor, allocationWords=size, descriptor=descriptor,
            absentHeader=absent_header, sourceSha256=row["binary_hash"],
            apiOnlySha256=hashlib.sha256(compact).hexdigest(),
            contentInstalled=False))
        cursor = end
    memory[2] += len(records)
    if memory[2] > slots - 2:
        raise ValueError("Member count exceeds Namespace capacity")
    original = struct.unpack("<16384I", raw)
    if any(a != b and i not in allowed for i, (a, b) in enumerate(zip(original, memory))):
        raise AssertionError("Unrelated image word changed")
    return struct.pack("<16384I", *memory), records


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / "generated-artifacts"):
        raise ValueError("Choose a fresh generated-artifacts output")
    manifest = json.loads((source / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        path = (source / name).resolve()
        if not path.is_relative_to(source) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Retained input changed: {name}")
    raw = (source / "boot2.bin").read_bytes()
    if hashlib.sha256(raw).hexdigest() != ORIGINAL_SHA:
        raise ValueError("Not the retained original Boot2 image")
    prepared = json.loads((source / "prepared.json").read_text())
    artifacts = {}
    for r in prepared["layout_rows"]:
        if r.get("policy") == "Lazy":
            path = (source / "private-lumps" / r["filename"]).resolve()
            if not path.is_relative_to(source / "private-lumps"):
                raise ValueError("Artifact path escapes retained input")
            artifacts[r["filename"]] = path.read_bytes()
    candidate, records = build(raw, prepared, artifacts)
    receipt = dict(sourceSha256=ORIGINAL_SHA,
        imageSha256=hashlib.sha256(candidate).hexdigest(),
        records=records, hardwareOperations=False, sourceChanged=False,
        scope="local absent-LUMP representation; no delivery/publication claim")
    output.mkdir()
    (output / "boot2.bin").write_bytes(candidate)
    (output / "preparation.json").write_text(json.dumps(receipt, indent=2)+"\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
