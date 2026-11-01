"""Read-only Phase 1 queue placement check; never emits an installable image."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.namespace_ascending_image import FORMAT, validate_image

REFERENCE_SHA = "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d"
ARCHIVE = ROOT / "generated-artifacts/pre-cloomcpp-abi-frozen-bootstrap.tar.gz"


def proposed_layout():
    objects = []
    cursor, slot = 7168, 32
    for size, count in ((64, 4), (128, 2), (256, 2)):
        for _ in range(count):
            objects.append(dict(slot=slot, startWord=cursor, words=size,
                                limit=size - 1, queue=f"Free{size}"))
            cursor += size
            slot += 1
    queues = [
        dict(name=name, slot=40 + i, startWord=8704 + 64 * i,
             words=64, capacity=capacity, initialCount=initial)
        for i, (name, capacity, initial) in enumerate((
            ("Free64", 4, 4), ("Free128", 2, 2),
            ("Free256", 2, 2), ("Returned", 8, 0)))
    ]
    return objects, queues


def check_ranges(words, rows, occupied):
    """Check both descriptor extents and bytes: zero does not mean unowned."""
    slots, ranges = set(), []
    for row in rows:
        slot, start, size = row["slot"], row["startWord"], row["words"]
        if slot in slots or not 2 <= slot < 64:
            raise ValueError("Duplicate or invalid slot")
        slots.add(slot)
        if any(words[slot * 4:slot * 4 + 4]):
            raise ValueError(f"NS[{slot}] is occupied")
        if size < 64 or size & (size - 1) or start % size:
            raise ValueError(f"NS[{slot}] allocation size/alignment is invalid")
        end = start + size
        if start < 256 or end > len(words):
            raise ValueError(f"NS[{slot}] allocation is out of RAM")
        for a, b in occupied + ranges:
            if start < b and a < end:
                raise ValueError(f"NS[{slot}] allocation overlaps reserved storage")
        if any(words[start:end]):
            raise ValueError(f"NS[{slot}] allocation contains nonzero words")
        ranges.append((start, end))


def check_image(raw):
    if hashlib.sha256(raw).hexdigest() != REFERENCE_SHA:
        raise ValueError("Reference image hash mismatch")
    baseline = validate_image(raw, image_format=FORMAT)
    words = struct.unpack(f"<{len(raw) // 4}I", raw)
    occupied = [(0, baseline["tableWords"])]
    for slot in baseline["liveSlots"]:
        base, authority = words[slot * 4:slot * 4 + 2]
        if slot != 1 and base < len(words):
            occupied.append((base, base + (authority & 0x1FFFFF) + 1))
    occupied.extend((r["startWord"], r["endWord"]) for r in baseline["ownedRanges"])
    # Preserve prior service/state/caller reservations, even though not installed.
    occupied.extend(((5120, 6976), (8192, 8704)))
    objects, queues = proposed_layout()
    check_ranges(words, objects + queues, occupied)
    if words[255] != 0:
        raise ValueError("UART scheduling word 255 must remain zero")
    return dict(
        status="offline-placement-checked-not-an-image",
        referenceImageSha256=REFERENCE_SHA,
        origin="fresh disposable candidate only; not live slot history",
        objects=objects, queues=queues,
        objectWords=sum(r["words"] for r in objects),
        queueReservedWords=sum(r["words"] for r in queues),
        totalReservedBytes=4 * sum(r["words"] for r in objects + queues),
        bootTargetUnchanged=baseline["bootTarget"],
        installationAllowed=False, activationAllowed=False,
        hardwareProgrammingAllowed=False,
        limitations=[
            "Queue word format and capability-load bindings are not implemented.",
            "No descriptors, GT entries, caller code or boot image were written.",
            "No dequeue, return, version-reuse or hardware execution was tested.",
            "Background Mint refill remains deferred.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    args = parser.parse_args()
    with tarfile.open(args.archive, "r:gz") as archive:
        member = archive.getmember("candidate-le.bin")
        if not member.isfile() or member.size != 65536:
            raise ValueError("Expected a regular 64 KiB frozen image")
        with archive.extractfile(member) as source:
            raw = source.read()
    print(json.dumps(check_image(raw), indent=2))


if __name__ == "__main__":
    main()
