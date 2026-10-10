#!/usr/bin/env python3
"""Read-only inventory of current memory-map inputs; writes reports only.

Header/payload checks are not a full LUMP admission or hardware-release test.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "server"))
from boot_image import parse_ns_table_raw


def sha(data):
    return hashlib.sha256(data).hexdigest()


def words(data, endian):
    return list(struct.unpack(f"{endian}{len(data)//4}I", data))


def rol(x, n):
    return ((x << n) | (x >> (32-n))) & 0xffffffff


def header(w):
    typ = (w >> 8) & 3
    field = (w >> 23) & 15
    return dict(raw=f"{w:08x}", magic=w >> 27, typ=typ, size_field=field,
                count=(w >> 10) & 8191, cc=w & 255,
                allocation_words=1 << (field + (13 if typ == 1 else 6)))


def run():
    hashes = {}

    def read(path):
        data = path.read_bytes()
        hashes[str(path.relative_to(ROOT))] = sha(data)
        return data

    for name in ["docs/instruction-set.md", "reports/isa-seven-items-review-proposals.md",
                 "shared/architecture_contracts.json", "shared/namespace_header.py",
                 "simulator/simulator.js", "simulator/app-memory.js", "simulator/app-lumps.js",
                 "simulator/lump-audit.js", "simulator/thread_design.js",
                 "shared/thread_design.json", "server/boot_image.py",
                 "hardware/integrity32.py", "scripts/audit_memory_map_review.py",
                 "scripts/audit_memory_map_lumps.js"]:
        read(ROOT / name)
    directory = ROOT / "server/lumps"
    manifest = json.loads(read(directory / "manifest.json"))
    state = json.loads(read(directory / "ns-state.json"))
    raw = read(directory / "boot-image.bin")
    mem = words(raw, "<")
    parsed = parse_ns_table_raw(raw)
    if not parsed:
        raise ValueError("Committed image cannot be decoded by current parser")
    records = manifest if isinstance(manifest, list) else manifest["lumps"]
    inventory = []
    byfile = {}
    for record in records:
        filename = record.get("filename")
        if not filename:
            inventory.append(dict(name=record.get("abstraction"), issue="no filename"))
            continue
        path = directory / filename
        if path.resolve().parent != directory.resolve():
            inventory.append(dict(filename=filename, issue="not a direct catalog file"))
            continue
        if filename in byfile:
            continue
        item = dict(filename=filename, archived=bool(record.get("archived")))
        if not path.is_file():
            item["issue"] = "missing"
        else:
            data = read(path)
            item.update(bytes=len(data), sha256=sha(data))
            if not data or len(data) % 4:
                item["issue"] = "empty or unaligned byte length"
            else:
                ws = words(data, ">")
                item["header"] = header(ws[0])
                item["allocation_matches_file"] = len(ws) == item["header"]["allocation_words"]
                if item["header"]["magic"] != 31:
                    item["issue"] = "invalid header magic"
        byfile[filename] = item
        inventory.append(item)
    state_slots = {int(x["slot"]): x for x in state["abstractions"]}
    rows, regions = [], [dict(name="Namespace Header V2", start=0, end=16)]
    for entry in parsed["entries"]:
        slot = entry["slot"]
        saved = state_slots.get(slot, {})
        w0, w1, w2, w3 = [entry[f"w{i}"] for i in range(4)]
        row = dict(slot=slot, name=saved.get("name"), table_word=len(mem)-4*(slot+1),
                   raw=[f"{w:08x}" for w in (w0, w1, w2, w3)],
                   limit=w1 & 0x1fffff, generation=(w1 >> 21) & 511,
                   integrity_ok=(rol(w0, 7) ^ rol(w1 & 0x3fffffff, 13) ^ 0xdeadbeef) == w2,
                   saved_descriptor_differences=[])
        for field, value in [("location", w0), ("limit", w1 & 0x1fffff),
                             ("seq", (w1 >> 21) & 511), ("seal", w2)]:
            if field in saved:
                v = saved[field]
                v = int(v, 0) if isinstance(v, str) else int(v)
                if value != v:
                    row["saved_descriptor_differences"].append(field)
        if 0 < w0 < len(mem) and mem[w0] >> 27 == 31:
            h = header(mem[w0])
            row["resident_header"] = h
            end = w0 + h["allocation_words"]
            regions.append(dict(name=row["name"], start=w0, end=end))
            row["fits_before_table"] = end <= parsed["nsTableBase"]
            filename = saved.get("filename")
            if filename and (directory / filename).is_file():
                data = read(directory / filename)
                ws = words(data, ">")
                # Exclude destination-localized c-list; do not call this whole-artifact equality.
                stop = len(ws) - h["cc"]
                mismatch = [i for i in range(min(stop, len(mem)-w0))
                            if ws[i] != mem[w0+i]]
                row["artifact_comparison"] = dict(filename=filename,
                    artifact_sha256=sha(data), pre_clist_words_compared=max(0, min(stop, len(mem)-w0)),
                    pre_clist_mismatch_count=len(mismatch), first_mismatches=mismatch[:16],
                    clist_excluded_words=h["cc"],
                    saved_binary_hash_matches=saved.get("binary_hash") == sha(data))
        elif w0 >= len(mem):
            row["classification"] = "external/MMIO address; not an image word offset"
        rows.append(row)
    regions.append(dict(name="Namespace table", start=parsed["nsTableBase"], end=len(mem)))
    regions.sort(key=lambda r: r["start"])
    overlaps = [(a["name"], b["name"]) for i, a in enumerate(regions)
                for b in regions[i+1:] if b["start"] < a["end"]]
    changed = [p for p, h in hashes.items() if sha((ROOT / p).read_bytes()) != h]
    if changed:
        raise RuntimeError(f"Inputs changed during audit: {changed}")
    result = dict(scope="Read-only structural audit; not full admission, execution, synthesis or release evidence",
                  image_sha256=sha(raw), image_bytes=len(raw), raw_namespace=parsed,
                  slots=rows, word_regions=regions, overlaps=overlaps,
                  catalog=inventory, input_sha256=hashes, inputs_unchanged=True)
    out = ROOT / "reports/memory-map-audit-evidence.json"
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(dict(image_words=len(mem), slots=len(rows), catalog_files=len(byfile),
                         catalog_issues=[x for x in inventory if x.get("issue") or x.get("allocation_matches_file") is False],
                         overlaps=overlaps, slots_detail=rows), indent=2))


if __name__ == "__main__":
    run()
