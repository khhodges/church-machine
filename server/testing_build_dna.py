"""Read-only build DNA from integrity-checked immutable revisions, never live state."""
import hashlib
import json
import os
import re
import struct
import tarfile

from flask import jsonify, request
from hardware.thread_design import thread_layout
from server.boot_image import parse_ns_table_raw
from server.testing_dna_evidence import InspectionEvidence, BIT_ID, NS_ID, is_bitstream


INSTALLED = {"status": "unverified",
             "reason": "A selected build is not proof of the bitstream installed on the board."}


def summary(record):
    meta = record["metadata"]
    rid = record["revision_id"]
    hashes = record["files"]
    return {
        "id": rid,
        "label": f"Bitstream {rid[:12]} · HW {meta.get('hardware_version', 'unknown')}",
        "sha256": hashes.get("bitstream.bit"),
        "namespaceRevisionId": meta.get("namespace_revision_id"),
        "hardwareVersion": meta.get("hardware_version"),
        "sourceCommit": meta.get("source_commit"),
    }


def records(store, kind, issues):
    """Keep corrupt records visible as issues without hiding healthy history."""
    parent = os.path.join(store.root, kind)
    if not os.path.isdir(parent):
        return []
    result = []
    for name in sorted(os.listdir(parent)):
        if not re.fullmatch(r"[0-9a-f]{64}", name):
            continue
        try:
            result.append(store.read(kind, name))
        except (ValueError, OSError, KeyError, json.JSONDecodeError):
            issues.append(f"{kind} revision {name}: integrity verification failed; excluded.")
    return result


def decode_gt(value, source, register, entries, ordinal, portable=False):
    typ = (value >> 25) & 3
    slot, sequence = value & 65535, (value >> 16) & 511
    domain = (value >> 27) & 1
    permissions = [name for bit, name in enumerate(("L", "S", "E") if domain else ("R", "W", "X"), 28)
                   if value & (1 << bit)]
    target, status = None, ("null", "unresolved", "outform", "abstract")[typ]
    if typ == 1:
        if portable:
            status = "portable-unbound"
        elif slot not in entries:
            status = "slot-missing"
        elif sequence != ((entries[slot]["w1"] >> 21) & 511):
            status = "generation-mismatch"
        else:
            target, status = f"slot-{slot}", "resolved"
    return {"id": f"gt-{ordinal}", "source": source, "target": target,
            "raw": value, "register": register, "kind": ("NULL", "Inform", "Outform", "Abstract")[typ],
            "permissions": permissions, "sequence": sequence, "status": status,
            "targetSlot": slot if typ == 1 else None}


def read_bytes(store, kind, revision, name):
    if hasattr(store, "read_bytes"):
        return store.read_bytes(kind, revision, name)
    with open(store.file_path(kind, revision, name), "rb") as stream:
        return stream.read()


def graph(store, revision):
    record = store.read("namespace", revision)
    files, meta = record["files"], record["metadata"]
    image_name = next((name for name in ("boot-image.bin", "simulation.bin") if name in files), None)
    if not image_name:
        return {"status": "unavailable", "reason": "Frozen Namespace has no retained image bytes.",
                "nodes": [], "edges": [], "issues": []}
    image = read_bytes(store, "namespace", revision, image_name)
    if len(image) % 4:
        raise ValueError("Frozen image is not word-aligned")
    parsed = parse_ns_table_raw(image)
    words = struct.unpack(f"<{len(image)//4}I", image)
    image_layout = "descending"
    # Older retained native images use four metadata words followed by the
    # ascending table. Inspect them as that format, never rewrite/activate them.
    if not parsed and len(words) >= 12 and words[0] >> 27 == 31 and ((words[0] >> 8) & 3) == 1:
        table_words = (words[5] & 0x1FFFFF) + 1
        if words[4] == 0 and table_words % 4 == 0 and 64 <= table_words // 4 <= 1024 and table_words <= len(words):
            rows = []
            for slot in range(1, table_words // 4):
                raw = words[slot * 4:slot * 4 + 4]
                if any(raw):
                    rows.append(dict(slot=slot, **{f"w{i}": v for i, v in enumerate(raw)}))
            parsed = {"nsTableBase": len(words), "entries": rows}
            image_layout = "ascending-native"
    if not parsed:
        raise ValueError("Frozen image Namespace layout is not supported; no live image substituted")
    state = json.loads(read_bytes(store, "namespace", revision, "namespace.json"))
    labels = {row["slot"]: row for row in state.get("abstractions", state.get("rows", []))
              if isinstance(row, dict) and isinstance(row.get("slot"), int) and not row.get("archived")}
    entries = {e["slot"]: e for e in parsed["entries"]}
    selected = {r["slot"]: dict(r, binary_hash=r.get("binary_hash", r.get("binaryHash")))
                for r in meta.get("selected_lumps", meta.get("provenance", {}).get("artifactBindings", []))
                if isinstance(r, dict) and isinstance(r.get("slot"), int)}
    nodes, edges, issues = [], [], []
    for slot, entry in entries.items():
        row = labels.get(slot, {})
        base, limit = entry["w0"], entry["w1"] & 0x1FFFFF
        node = {"id": f"slot-{slot}", "slot": slot, "name": row.get("name") or f"NS[{slot}]",
                "kind": "Unclassified", "location": base, "sizeWords": limit + 1,
                "binaryHash": None, "availability": "descriptor-only",
                "rawDescriptor": [entry[f"w{i}"] for i in range(4)],
                "initialDataRegisters": []}
        nodes.append(node)
        body, portable = None, False
        # Physical Namespace at zero is valid; other zero locations are not
        # evidence that a lazy object contains the Namespace's bytes.
        if (slot == (1 if image_layout == "ascending-native" else 0) or base > 0) and base < parsed["nsTableBase"]:
            header = words[base]
            if header >> 27 == 31:
                size = 1 << (((header >> 23) & 15) + 6)
                # Namespace headers encode different geometry; do not decode
                # their slot-count fields as an Abstraction C-list.
                typ = (header >> 8) & 3
                if typ == 1:
                    node.update(kind="Namespace", availability="in-image", binaryHash=files[image_name])
                    continue
                if base + size <= parsed["nsTableBase"] and size <= limit + 1:
                    body = list(words[base:base + size])
                    node.update(availability="in-image", sizeWords=size,
                                binaryHash=hashlib.sha256(struct.pack(f"<{size}I", *body)).hexdigest())
        selection = selected.get(slot, row.get("selection", row))
        selection = dict(selection, binary_hash=selection.get("binary_hash", selection.get("binaryHash")))
        retained_hash = selection.get("binary_hash")
        filename = next((name for name in (
            f"{retained_hash}.lump", selection.get("filename"))
            if name and name in files and (not retained_hash or files[name] == retained_hash)), None)
        node["artifactHash"] = retained_hash
        if body is None and filename:
            data = read_bytes(store, "namespace", revision, filename)
            if len(data) >= 4 and len(data) % 4 == 0:
                body = list(struct.unpack(f"<{len(data)//4}I", data))
                portable = True
                node.update(availability="retained-not-resident", binaryHash=files[filename])
        if not body:
            if row.get("kind") == "mmio" or base >= len(words):
                node.update(kind="Hardware", availability="hardware-address")
                continue
            issues.append(f"NS[{slot}] has no inspectable body in this frozen record.")
            continue
        header = body[0]
        size, typ, count = 1 << (((header >> 23) & 15) + 6), (header >> 8) & 3, header & 255
        node["kind"] = {0: "Abstraction", 1: "Namespace", 2: "Thread"}.get(typ, "Unknown")
        if header >> 27 != 31 or size != len(body):
            issues.append(f"NS[{slot}] malformed or incomplete body; GT decoding withheld.")
            continue
        homes = []
        if typ == 0 and count <= size and ((header >> 10) & 8191) + 1 <= size - count:
            homes = [(f"C-list[{i}]", size - count + i) for i in range(count)]
        elif typ == 2:
            layout = thread_layout(size, (header >> 10) & 8191)
            if not layout["valid"]:
                issues.append(f"NS[{slot}] invalid Thread geometry.")
                continue
            homes = [(f"CR{i}", layout["caps_start"] + i) for i in range(12)]
            node["initialDataRegisters"] = body[layout["dr_start"]:layout["dr_start"] + 16]
            # Follow only the canonical saved frame chain, never scan heap
            # integers and pretend they are capabilities.
            sto, seen = body[17] & 8191, set()
            while layout["stack_start"] <= sto and sto + 2 <= layout["stack_end"] and sto not in seen:
                seen.add(sto)
                homes.append((f"Frame[{sto}].EnterGT", sto + 1))
                sto = body[sto + 2] & 8191
        elif typ == 0:
            issues.append(f"NS[{slot}] invalid C-list geometry.")
        for register, offset in homes:
            edges.append(decode_gt(body[offset], node["id"], register, entries, len(edges), portable))
    # Frozen metadata selections absent from the table remain visible but never
    # gain local target resolution by pretending an occupied slot exists.
    for slot, row in {**labels, **selected}.items():
        if slot not in entries:
            nodes.append({"id": f"selected-{slot}", "slot": slot, "name": row.get("name") or f"NS[{slot}]",
                          "kind": "Selection", "availability": "not-in-image", "binaryHash": row.get("binary_hash"),
                          "location": None, "sizeWords": None, "rawDescriptor": [], "initialDataRegisters": []})
            issues.append(f"Selected NS[{slot}] is absent from the frozen image table.")
    return {"status": "available", "reason": "Decoded frozen image, not live runtime memory.",
            "imageHash": files[image_name], "imageKind": image_name, "imageLayout": image_layout,
            "nodes": nodes, "edges": edges, "issues": issues,
            "scope": "GT fields in retained C-lists, Thread homes and saved continuation frames. "
                     "Arbitrary data/heap words are not assumed to be GTs. Namespace table membership is not a GT edge."}


def install(app, store_factory, authorize=None, evidence_factory=InspectionEvidence):
    @app.get("/api/testing/build-dna")
    def testing_build_dna():
        if authorize is not None:
            ok, error = authorize()
            if not ok:
                return error
        try:
            store = store_factory()
            bit_id, ns_id = request.args.get("bitstream"), request.args.get("namespace")
            if bit_id and ns_id:
                raise ValueError("Select a bitstream or inspect a Namespace separately, not both")
            result = {"ok": True, "installed": INSTALLED}
            if bit_id == BIT_ID or ns_id == NS_ID:
                evidence = evidence_factory()
                result.update(graph(evidence, NS_ID), namespaceRevisionId=NS_ID,
                              inspectionOnly=True, releaseApproved=False,
                              association="receipt-backed" if bit_id else "unassociated",
                              bitstream=evidence.summary() if bit_id else None)
                result["issues"].append("EXPERIMENTAL — inspection only; not approved for installation or release. "
                                        "Archived authoring labels use a different layout; objects are identified by exact image slots.")
            elif bit_id:
                if not is_bitstream(read_bytes(store, "bitstream", bit_id, "bitstream.bit")):
                    raise ValueError("Not a structurally valid bitstream")
                bit = summary(store.read("bitstream", bit_id))
                result["bitstream"] = bit
                ns_id = bit["namespaceRevisionId"]
                if not ns_id:
                    result.update(status="unavailable", reason="Build DNA unavailable: this bitstream has no frozen Namespace linkage.",
                                  namespaceRevisionId=None, nodes=[], edges=[], issues=[])
                else:
                    result.update(graph(store, ns_id), namespaceRevisionId=ns_id)
            elif ns_id:
                result.update(graph(store, ns_id), namespaceRevisionId=ns_id,
                              association="unassociated", bitstream=None)
            else:
                issues = []
                valid_bits = []
                for r in records(store, "bitstream", issues):
                    if is_bitstream(read_bytes(store, "bitstream", r["revision_id"], "bitstream.bit")):
                        valid_bits.append(summary(r))
                result["bitstreams"] = valid_bits
                result["namespaces"] = [
                    {"id": r["revision_id"], "label": f"{r['metadata'].get('purpose', 'Frozen Namespace')} · {r['revision_id'][:12]}",
                     "imageAvailable": any(k in r["files"] for k in ("boot-image.bin", "simulation.bin"))}
                    for r in records(store, "namespace", issues)]
                result["issues"] = issues
                try:
                    evidence = evidence_factory()
                    result["bitstreams"].append(evidence.summary())
                    result["namespaces"].insert(0, {"id": NS_ID, "label": "Amoeba retry — receipt-backed experimental image (inspection only)",
                                                    "imageAvailable": True})
                except (OSError, ValueError, KeyError, TypeError, tarfile.TarError):
                    issues.append("Experimental archive unavailable or failed verification; no image substituted.")
            response = jsonify(result)
            response.headers["Cache-Control"] = "no-store"
            return response
        except (ValueError, OSError, KeyError, TypeError, struct.error, tarfile.TarError) as exc:
            app.logger.warning("Build DNA unavailable: %s", type(exc).__name__)
            return jsonify(ok=False, error="Frozen build evidence unavailable, invalid, or failed integrity verification. No live image was substituted."), 409
