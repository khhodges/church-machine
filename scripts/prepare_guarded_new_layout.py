#!/usr/bin/env python3
"""Prepare/verify an isolated approved New Layout guard candidate. No network IO."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.boot_pair_guard import validate_boot_guard
from server import boot_image as boot
from server.namespace_ascending_image import FORMAT, validate_image

SOURCE = ROOT / "docs/phase-1/reload-evidence/new-layout"
SOURCE_HASH = "47966de85a7a8561b838a6c85f3ea6de447a7c54b0ea3b9c198527992ea4c565"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def guarded_image(raw, guard):
    """Change only typed GT fields and boot descriptor versions/seals.

    No scanning data or instruction words for token-looking numbers. The pinned
    input is a fresh prepared image: Thread frame geometry is validated before
    visiting its two populated frames and twelve capability homes.
    """
    validate_boot_guard(guard)
    if len(raw) != 65536 or sha(raw) != SOURCE_HASH:
        raise ValueError("Input is not the retained exact New Layout image")
    validate_image(raw, image_format=FORMAT)
    words = list(struct.unpack("<16384I", raw))
    before = words[:]
    versions = {1: guard >> 9, 2: guard & 511}
    sites = {}
    for slot in range(2, (words[0] >> 10) & 8191):
        base, authority, seal, token = words[slot * 4:slot * 4 + 4]
        if not any((base, authority, seal, token)) or base >= len(words):
            continue
        header = words[base]
        size = 1 << (((header >> 23) & 15) + 6)
        typ, cc = (header >> 8) & 3, header & 255
        if typ == 2:
            layout = boot.thread_layout(size, (header >> 10) & 8191)
            # validate_image already checked fresh continuation semantics.
            indices = list(range(layout["caps_start"], layout["caps_start"] + cc))
            indices += [layout["stack_end"] - 3, layout["stack_end"] - 1]
        elif typ == 0:
            indices = range(size - cc, size)
        else:
            raise ValueError(f"Unsupported resident LUMP type in slot {slot}")
        for relative in indices:
            at = base + relative
            gt = words[at]
            target = gt & 65535
            if ((gt >> 25) & 3) != 1 or target not in versions:
                continue
            if ((gt >> 16) & 511) != 0:
                raise ValueError("Retained boot reference has unexpected generation")
            words[at] = (gt & ~(511 << 16)) | (versions[target] << 16)
            sites[at] = f"NS[{slot}] typed capability referencing NS[{target}]"
    for slot, version in versions.items():
        at = slot * 4
        words[at + 1] = (words[at + 1] & ~(511 << 17)) | (version << 17)
        words[at + 2] = boot.integrity32(words[at], words[at + 1])
        sites[at + 1] = f"NS[{slot}] approved boot version"
        sites[at + 2] = f"NS[{slot}] descriptor integrity"
    patches = [
        dict(word=at, byteOffset=at * 4, before=before[at], after=words[at],
             reason=sites[at])
        for at in sorted(sites) if before[at] != words[at]
    ]
    changed = {i for i, (a, b) in enumerate(zip(before, words)) if a != b}
    if changed != {p["word"] for p in patches}:
        raise ValueError("Unaccounted image mutation")
    return struct.pack("<16384I", *words), patches


def source_inputs():
    raw = (SOURCE / "simulator-image-le.bin").read_bytes()
    report = json.loads((SOURCE / "report.json").read_text())
    inputs = {}
    for binding in report["artifactBindings"]:
        name = binding["filename"]
        if Path(name).name != name:
            raise ValueError("Invalid retained artifact filename")
        data = (SOURCE / "artifacts" / name).read_bytes()
        if sha(data) != binding["binaryHash"]:
            raise ValueError(f"Retained artifact changed: {name}")
        inputs[name] = sha(data)
    return raw, inputs


def evidence(image, patches, inputs):
    words = struct.unpack("<16384I", image)
    source_report = json.loads((SOURCE / "report.json").read_text())
    rows = {row["slot"]: row for row in source_report["preparedRows"]}
    layout = []
    for slot in range(1, 64):
        base, authority, seal, token = words[4 * slot:4 * slot + 4]
        if not any((base, authority, seal, token)):
            continue
        limit = authority & 0x1ffff
        resident = slot != 1 and base < len(words)
        layout.append(dict(slot=slot, name=rows[slot]["name"],
                           location=base, limit=limit,
                           sequence=(authority >> 17) & 511, seal=seal, token=token,
                           resident=resident,
                           residentBytesSha256=sha(image[base * 4:(base + limit + 1) * 4])
                           if resident else None))
    return dict(name="New Layout", format=FORMAT, length=len(image),
                sha256=sha(image), inputSha256=SOURCE_HASH,
                inputReportSha256=sha((SOURCE / "report.json").read_bytes()),
                slots=64, entryThreadSlot=2, entryProgramSlot=20,
                entryProgram="ide.ActorManager", layout=layout,
                entryThread=dict(locationWord=words[8],
                                 header=words[words[8]], indicator=words[words[8] + 17],
                                 capabilityHomes=list(words[words[8] + 244:words[8] + 256])),
                unresolvedSelections=[row["name"] for row in rows.values()
                                      if row.get("unresolved")],
                byteOrder="little-endian words; no transport conversion performed",
                sourceArtifacts=inputs, patches=patches,
                hardwareCompatible=False, uploaded=False,
                status="Offline guard candidate only; full-core and loader integration pending")


def verify(folder):
    raw, inputs = source_inputs()
    record = json.loads((folder / "guard.json").read_text())
    expected, patches = guarded_image(raw, record["guard18"])
    actual = (folder / "candidate-le.bin").read_bytes()
    manifest = json.loads((folder / "evidence.json").read_text())
    if (record["inputSha256"] != SOURCE_HASH or
            record["namespaceVersion"] != record["guard18"] >> 9 or
            record["threadVersion"] != record["guard18"] & 511 or
            record["cr0ChangePolicy"] != "retain" or
            actual != expected or manifest != evidence(expected, patches, inputs)):
        raise ValueError("Guard candidate evidence differs from deterministic reconstruction")
    return manifest


def prepare(folder):
    raw, inputs = source_inputs()
    # Reserve first; an existing/partial candidate is never silently regenerated.
    folder.mkdir(parents=True, exist_ok=False)
    namespace_version, thread_version = secrets.randbelow(511), secrets.randbelow(511)
    guard = (namespace_version << 9) | thread_version
    record = dict(schema="church.isolated-boot-guard/v1", name="New Layout",
                  inputSha256=SOURCE_HASH, namespaceVersion=namespace_version,
                  threadVersion=thread_version, guard18=guard,
                  cr0ChangePolicy="retain",
                  approvalScope="User-approved separate offline hardware candidate; not installation")
    (folder / "guard.json").write_text(json.dumps(record, indent=2) + "\n")
    image, patches = guarded_image(raw, guard)
    (folder / "candidate-le.bin").write_bytes(image)
    manifest = evidence(image, patches, inputs)
    (folder / "evidence.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return verify(folder)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    result = verify(args.output) if args.verify else prepare(args.output)
    print(json.dumps({k: result[k] for k in ("name", "sha256", "length", "status")}, indent=2))
