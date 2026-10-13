"""Frozen, non-executable review of the approved ascending Namespace cutover.

This does not publish a Namespace, sign a LUMP, or produce an executable image.
The existing image-refresh/approval stores understand the historical layout.
Keep this review separate until generation and validation support the new ABI.
"""
from __future__ import annotations

import copy
import hashlib
import html
import json
from pathlib import Path
import struct


FORMAT = "ascending-nst-metadata-slot0-v1"
ROOT = Path(__file__).resolve().parents[1]
STAGING_ROOT = ROOT / "generated-artifacts"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def integer(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Expected an integer or integer string")
    return int(value, 0) if isinstance(value, str) else value


def plan(state, config, artifacts):
    """Describe explicit moves, never reinterpret or modify source LUMP bytes."""
    rows = copy.deepcopy(state["abstractions"])
    step = config["step1"]
    capacity, slots = integer(step["totalNamespaceWords"]), integer(step["nsSlotsMax"])
    if not 8192 <= capacity <= 4194304 or capacity & (capacity - 1):
        raise ValueError("Namespace capacity must be a power of two from 8K to 4M words")
    if not 3 <= slots <= 8191 or slots * 4 > capacity:
        raise ValueError("Namespace slot capacity does not fit the approved header")
    by_slot = {}
    for row in rows:
        slot = integer(row["slot"])
        if slot in by_slot or not 0 <= slot < slots:
            raise ValueError("Duplicate or out-of-range source Namespace slot")
        by_slot[slot] = row
    for slot, name in ((0, "Boot.NS"), (1, "Boot.Thread"), (2, "UART_DEV")):
        if by_slot.get(slot, {}).get("name") != name:
            raise ValueError(f"Expected historical {name} at slot {slot}; no guessed migration")
    if integer(by_slot[1]["seq"]) != 0:
        raise ValueError("Boot.Thread is not version 0; management review is required")
    uart_slot = next((i for i in range(3, slots) if i not in by_slot), None)
    if uart_slot is None:
        raise ValueError("No free slot for UART; no occupied slot will be overwritten")
    uart_seq = integer(state.get("freeSlotSequences", {}).get(str(uart_slot), 0))
    if not 0 <= uart_seq <= 511:
        raise ValueError("Invalid retained generation for proposed UART slot")
    moves = {0: 1, 1: 2, 2: uart_slot}
    proposed = []
    bodies = []
    bindings = []
    selected = []
    for old_slot, row in sorted(by_slot.items()):
        new_slot = moves.get(old_slot, old_slot)
        entry = {"name": row["name"], "sourceSlot": old_slot, "slot": new_slot,
                 "sourceSequence": integer(row["seq"]),
                 "sequence": uart_seq if old_slot == 2 else integer(row["seq"]),
                 "sourceLocation": integer(row["location"]),
                 "location": integer(row["location"]),
                 "limit": integer(row["limit"]), "boot": row.get("boot") is True}
        proposed.append(entry)
        filename = row.get("filename")
        if filename:
            raw = artifacts[filename]
            if digest(raw) != row.get("binary_hash"):
                raise ValueError(f"{row['name']}: exact saved binary hash mismatch")
            if len(raw) < 4 or len(raw) % 4:
                raise ValueError(f"{row['name']}: malformed word-aligned LUMP")
            words = struct.unpack(f">{len(raw) // 4}I", raw)
            header, cc = words[0], words[0] & 255
            size = 1 << (((header >> 23) & 15) + 6)
            if header >> 27 != 31 or size != len(words) or cc > len(words) - 1:
                raise ValueError(f"{row['name']}: unsupported LUMP header")
            selected.append({"name": row["name"], "filename": filename,
                             "sha256": digest(raw), "slot": new_slot,
                             "boot_resident": row.get("boot_resident") is True})
            for index, gt in enumerate(words[-cc:] if cc else []):
                source_slot = gt & 65535
                # NULL rows and Abstract identities are not local Inform GTs.
                if ((gt >> 25) & 3) != 1 or source_slot not in moves:
                    continue
                bindings.append({"name": row["name"], "filename": filename,
                                 "clistRow": index, "sourceGT": f"{gt:08x}",
                                 "sourceSlot": source_slot,
                                 "destinationSlot": moves[source_slot],
                                 "action": "rebuild-or-verified-localization-required"})
            bodies.append((entry, size))
        elif old_slot == 0:
            entry.update(location=0, limit=slots * 4 - 1)
        elif entry["sourceLocation"] < capacity:
            if row["name"] != "Boot.Thread" and not row["name"].startswith("Thread."):
                raise ValueError(f"{row['name']}: no exact artifact or generated Thread definition")
            size = entry["limit"] + 1
            if size < 64 or size & (size - 1):
                raise ValueError(f"{row['name']}: invalid generated Thread allocation")
            entry["requiresFreshThreadImage"] = True
            bodies.append((entry, size))
    cursor = slots * 4
    source_end = 16
    for entry, size in sorted(bodies, key=lambda item: item[0]["sourceLocation"]):
        if entry["sourceLocation"] < source_end:
            raise ValueError("Source resident allocations overlap")
        source_end = entry["sourceLocation"] + size
        if source_end > capacity - slots * 4:
            raise ValueError("Source resident allocation overlaps the historical table")
        entry.update(location=cursor, allocationWords=size)
        cursor += size
    if cursor > capacity:
        raise ValueError("Proposed residents do not fit after the ascending NST")
    if sum(row["boot"] for row in proposed) != 1:
        raise ValueError("Exactly one saved boot selection is required")
    if sum(row["boot_resident"] for row in selected) != 3:
        raise ValueError("The exact three selected boot-resident artifacts must be preserved")
    header = (31 << 27) | ((capacity.bit_length() - 1 - 13) << 23) | (slots << 10) | (1 << 8)
    return {
        "format": FORMAT, "base": 0, "capacityWords": capacity, "slotCount": slots,
        "metadataWords": [header, 0, len(rows) - 1, 0],
        "cr15WordLimit": slots * 4 - 1,
        "entryThread": {"slot": 2, "version": 0, "gt": "02000002"},
        "descriptors": sorted(proposed, key=lambda row: row["slot"]),
        "selectedArtifacts": selected, "affectedBindings": bindings,
        "residentWordsEnd": cursor,
        "blockers": [
            "This review is not an already-migrated target state; the separate ascending-v1 generator requires explicit target rows.",
            "The existing approval/activation path still accepts the historical layout only.",
            "Changed resident bindings require recompilation or verified localization; saved source bytes are never patched.",
            "Private entry-Thread startup is checked, but combined Namespace SWITCH/context handoff remains unproved.",
            "No new-format image is approved, installed, or activated by this review.",
        ],
    }


def review_html(record):
    p = record["proposal"]
    esc = lambda value: html.escape(str(value))
    rows = "".join(
        f"<tr><td>{esc(r['name'])}</td><td>{r['sourceSlot']} → {r['slot']}</td>"
        f"<td>{r['sourceSequence']} → {r['sequence']}</td>"
        f"<td>{r['sourceLocation']} → {r['location']}</td></tr>"
        for r in p["descriptors"])
    blockers = "".join(f"<li>{esc(b)}</li>" for b in p["blockers"])
    bindings = "".join(
        f"<li>{esc(b['name'])}, C-list row {b['clistRow']}: "
        f"slot {b['sourceSlot']} → {b['destinationSlot']}</li>"
        for b in p["affectedBindings"])
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Namespace layout candidate review</title>
<style>body{{font:16px/1.5 system-ui;max-width:1000px;margin:40px auto;padding:0 20px;color:#18202a}}
table{{border-collapse:collapse;width:100%}}th,td{{padding:8px;text-align:left;border-bottom:1px solid #ddd}}
aside{{padding:16px;background:#fff4d8;border-left:4px solid #a36600}}code{{overflow-wrap:anywhere}}</style>
<h1>Boot Namespace layout candidate</h1>
<aside><strong>Review only — not approved or executable.</strong>
This legacy-to-new-layout review does not emit a candidate binary. The separate
ascending-v1 generator requires a completed, explicitly migrated target state.
Live Namespace, catalogs, selected boot image, and saved LUMPs were not changed.
This report cannot authorize activation.</aside>
<p>Review digest: <code>{esc(record['reviewId'])}</code></p>
<h2>Geometry</h2><p>{p['capacityWords']} words; {p['slotCount']} ascending four-word slots.
Slot 0 is the physical header; self is slot 1; entry Thread is slot 2, version 0.
CR15 word limit is {p['cr15WordLimit']}. There is no separate 16-word header.</p>
<h2>Explicit assignments</h2><table><tr><th>Object</th><th>Slot</th><th>Version</th>
<th>Word address</th></tr>{rows}</table>
<p>New body locations are proposed, not installed. Hardware device addresses are unchanged.
The three selected resident artifact hashes and saved boot selection are retained.</p>
<h2>Bindings requiring work</h2><ul>{bindings}</ul>
<h2>Execution-approval blockers</h2><ul>{blockers}</ul>
<p>Hardware never changes versions. This is a fresh-format preparation, not live slot
reassignment or permission to carry old capabilities into the new Namespace.</p></html>"""


def prepare(directory, config_path, output, *, staging_root=STAGING_ROOT):
    directory, config_path, output = Path(directory), Path(config_path), Path(output)
    root = Path(staging_root).resolve()
    resolved = output.resolve()
    if not resolved.is_relative_to(root) or resolved == root:
        raise ValueError("Review output must be a new directory under generated-artifacts")
    if resolved.is_relative_to(directory.resolve()):
        raise ValueError("Review output cannot be inside the live catalog")
    if output.exists():
        raise ValueError("Refusing to replace an existing frozen review")
    state_raw, config_raw = (directory / "ns-state.json").read_bytes(), config_path.read_bytes()
    state, config = json.loads(state_raw), json.loads(config_raw)
    inputs = {"ns-state.json": state_raw, "boot-config.json": config_raw}
    paths = {"ns-state.json": directory / "ns-state.json", "boot-config.json": config_path}
    artifacts = {}
    for row in state["abstractions"]:
        name = row.get("filename")
        if not name:
            continue
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("Selected artifact must be a plain filename")
        path = directory / name
        if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Selected artifact must remain within the saved library")
        raw = path.read_bytes()
        artifacts[name] = raw
        inputs[f"lumps/{name}"] = raw
        paths[f"lumps/{name}"] = path
        for sidecar in (path.with_suffix(".json"), path.with_suffix(".meta.json")):
            if sidecar.is_file():
                if sidecar.is_symlink():
                    raise ValueError("Refusing a symlinked sidecar")
                key = f"lumps/{sidecar.name}"
                inputs[key], paths[key] = sidecar.read_bytes(), sidecar
    for name in ("manifest.json", "approvals.json", "boot-image.bin", "boot-image.provenance.json"):
        path = directory / name
        if path.is_file():
            if path.is_symlink():
                raise ValueError("Refusing a symlinked approval input")
            inputs[f"lumps/{name}"], paths[f"lumps/{name}"] = path.read_bytes(), path
    proposal = plan(state, config, artifacts)
    record = {"status": "review-only", "approvalEligible": False, "activationAllowed": False,
              "proposal": proposal,
              "inputs": {name: digest(raw) for name, raw in sorted(inputs.items())}}
    record["reviewId"] = digest(json.dumps(record, sort_keys=True, separators=(",", ":")).encode())
    if any(path.read_bytes() != inputs[name] for name, path in paths.items()):
        raise ValueError("Saved inputs changed during preparation; no review was created")
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in inputs.items():
        target = output / "inputs" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    (output / "candidate.json").write_text(json.dumps(record, indent=2) + "\n")
    (output / "review.html").write_text(review_html(record))
    return record
