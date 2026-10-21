"""Build a private, destination-localized Namespace migration package.

The package is derived from a frozen layout review. It does not edit the saved
Namespace, sign LUMPs, publish approvals, or create an executable image.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import tempfile

from server.namespace_layout_review import FORMAT


SCHEMA = "namespace-migration-artifact/1"
_U32 = 0xFFFFFFFF
_SLOT_MASK = 0xFFFF
_SEQUENCE_MASK = 0x1FF << 16


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _canonical_digest(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _int(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{label} must be an explicit integer")
    return int(value, 0) if isinstance(value, str) else value


def _frozen_inputs(directory, review):
    result = {}
    input_root = (directory / "inputs").resolve()
    for name, expected in review.get("inputs", {}).items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Unsafe frozen review input {name!r}")
        path = directory / "inputs" / relative
        if path.is_symlink() or not path.resolve().is_relative_to(input_root):
            raise ValueError(f"Unsafe frozen review input {name!r}")
        raw = path.read_bytes()
        if _sha(raw) != expected:
            raise ValueError(f"Frozen review input hash mismatch: {name}")
        result[name] = raw
    for required in ("ns-state.json", "boot-config.json"):
        if required not in result:
            raise ValueError(f"Frozen review is missing {required}")
    return result


def _load_review(directory):
    path = directory / "candidate.json"
    if path.is_symlink():
        raise ValueError("Frozen layout review must not be a symlink")
    raw = path.read_bytes()
    review = json.loads(raw)
    review_id = review.get("reviewId")
    body = dict(review)
    body.pop("reviewId", None)
    if (not isinstance(review_id, str) or _canonical_digest(body) != review_id
            or review.get("status") != "review-only"
            or review.get("approvalEligible") is not False
            or review.get("activationAllowed") is not False
            or review.get("proposal", {}).get("format") != FORMAT):
        raise ValueError("Expected an intact, non-activatable ascending layout review")
    return review, raw, _frozen_inputs(directory, review)


def _validate_lump(raw, label):
    if not isinstance(raw, bytes) or len(raw) < 4 or len(raw) % 4:
        raise ValueError(f"{label}: LUMP must be a whole-word byte stream")
    words = list(struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    allocation = 1 << (((header >> 23) & 15) + 6)
    cw, cc = (header >> 10) & 8191, header & 255
    if (header >> 27 != 31 or allocation != len(words)
            or 1 + cw + cc > allocation):
        raise ValueError(f"{label}: malformed LUMP header/allocation")
    return words, cc


def _localized_lump(raw, source_row, target_row, source_by_slot, target_by_source,
                    approval=None):
    """Relocalize only the private derivative's c-list from verified source GTs."""
    from server.boot_image import create_gt

    label = source_row["name"]
    words, cc = _validate_lump(raw, label)
    if cc < 1:
        raise ValueError(f"{label}: resident has no SELF c-list row")
    start = len(words) - cc
    source_slot = _int(source_row["slot"], f"{label} source slot")
    source_seq = _int(source_row.get("seq", 0), f"{label} source sequence")
    target_slot = _int(target_row["slot"], f"{label} destination slot")
    target_seq = _int(target_row["sequence"], f"{label} destination sequence")
    expected_source_self = create_gt(source_seq, source_slot, {"E": 1}, 1)
    expected_target_self = create_gt(target_seq, target_slot, {"E": 1}, 1)
    if words[start] == 0:
        from server.lump_approvals import (
            is_trusted_compiler_record, compiler_record_verification_key)
        from server.symbolic_binding import embedded_api
        try:
            key = compiler_record_verification_key((approval or {}).get("compiler_record"))
            trusted = is_trusted_compiler_record(approval, binary=raw, signing_key=key)
        except RuntimeError:
            trusted = False
        caps = embedded_api(words).get("capabilities", [])
        if (not trusted or len(caps) != cc or not isinstance(caps[0], dict)
                or caps[0].get("name") not in ("SELF", "__SELF__")
                or caps[0].get("rights") != ["E"]):
            raise ValueError(f"{label}: NULL SELF requires authenticated embedded SELF E relocation")
    elif words[start] not in (0xFEED5E1F, expected_source_self):
        raise ValueError(f"{label}: row zero is not its canonical or exact source SELF")

    localized = []
    evidence = [{
        "row": 0, "sourceGT": f"{words[start]:08x}",
        "destinationGT": f"{expected_target_self:08x}",
        "sourceSlot": source_slot, "destinationSlot": target_slot,
        "sourceSequence": source_seq, "destinationSequence": target_seq,
        "kind": "self",
    }]
    localized.append(expected_target_self)
    for index, word in enumerate(words[start + 1:start + cc], 1):
        if word & 0xFFFF0000 == 0xFEED0000:
            raise ValueError(
                f"{label}: c-list row {index} contains an unresolved symbolic binding")
        kind = (word >> 25) & 0x3
        if kind in (1, 2):
            if word >> 31:
                raise ValueError(f"{label}: c-list row {index} is marked free")
            old_slot = word & _SLOT_MASK
            old_sequence = (word >> 16) & 0x1FF
            old_target = source_by_slot.get(old_slot)
            proposed = target_by_source.get(old_slot)
            if old_target is None or proposed is None:
                raise ValueError(
                    f"{label}: c-list row {index} references unmapped Namespace slot {old_slot}")
            expected_sequence = _int(old_target.get("seq", 0),
                                     f"source NS[{old_slot}] sequence")
            if old_sequence != expected_sequence:
                raise ValueError(
                    f"{label}: c-list row {index} has stale source sequence "
                    f"{old_sequence}, expected {expected_sequence}")
            new_slot = _int(proposed["slot"], f"destination NS[{old_slot}] slot")
            new_sequence = _int(proposed["sequence"],
                                f"destination NS[{old_slot}] sequence")
            replacement = (word & ~(_SLOT_MASK | _SEQUENCE_MASK)) | (
                (new_sequence << 16) | new_slot)
            evidence.append({
                "row": index, "sourceGT": f"{word:08x}",
                "destinationGT": f"{replacement:08x}",
                "sourceSlot": old_slot, "destinationSlot": new_slot,
                "sourceSequence": old_sequence,
                "destinationSequence": new_sequence,
                "type": kind, "permissions": (word >> 28) & 0x7,
                "domain": (word >> 27) & 1, "kind": "localized",
            })
        else:
            replacement = word
            evidence.append({
                "row": index, "sourceGT": f"{word:08x}",
                "destinationGT": f"{word:08x}", "kind": "unchanged",
                "type": kind,
            })
        localized.append(replacement)
    words[start:] = localized
    return struct.pack(f">{len(words)}I", *words), evidence


def _target_state(review, source_state, config, inputs, output_lumps):
    proposal = review["proposal"]
    source_rows = source_state.get("abstractions")
    if not isinstance(source_rows, list):
        raise ValueError("Frozen source Namespace rows are missing")
    source_by_slot = {_int(row["slot"], "source slot"): row for row in source_rows}
    descriptors = proposal.get("descriptors")
    if not isinstance(descriptors, list) or len(descriptors) != len(source_rows):
        raise ValueError("Review proposal does not explicitly map every source row")
    target_by_source = {}
    seen_destinations = set()
    for descriptor in descriptors:
        old = _int(descriptor.get("sourceSlot"), "proposal source slot")
        new = _int(descriptor.get("slot"), "proposal target slot")
        source = source_by_slot.get(old)
        if source is None or source.get("name") != descriptor.get("name"):
            raise ValueError("Review proposal row identity differs from frozen source Namespace")
        if new in seen_destinations:
            raise ValueError("Review proposal has duplicate target slots")
        seen_destinations.add(new)
        target_by_source[old] = descriptor

    selected = {item["name"]: item for item in proposal.get("selectedArtifacts", [])}
    localized_records = []
    result_rows = []
    for descriptor in descriptors:
        old_slot = _int(descriptor["sourceSlot"], "proposal source slot")
        source = copy.deepcopy(source_by_slot[old_slot])
        source_raw = None
        selected_item = selected.get(descriptor["name"])
        if selected_item:
            key = f"lumps/{selected_item['filename']}"
            source_raw = inputs.get(key)
            if source_raw is None or _sha(source_raw) != selected_item["sha256"]:
                raise ValueError(
                    f"{descriptor['name']}: selected source artifact differs from frozen review")
            derivative, clist = _localized_lump(
                source_raw, source_by_slot[old_slot], descriptor,
                source_by_slot, target_by_source,
                approval=json.loads(inputs.get("lumps/approvals.json", b"{}")).get(
                    "approvals", {}).get(_sha(source_raw)))
            filename = f"{descriptor['name']}.ascending-migration.lump"
            if filename in output_lumps:
                raise ValueError("Duplicate localized candidate filename")
            output_lumps[filename] = derivative
            source["filename"] = filename
            source.pop("token", None)
            source.pop("cache_token", None)
            source.pop("cacheToken", None)
            source.pop("binaryHash", None)
            source["binary_hash"] = _sha(derivative)
            localized_records.append({
                "name": descriptor["name"], "sourceSlot": old_slot,
                "destinationSlot": _int(descriptor["slot"], "target slot"),
                "sourceFilename": selected_item["filename"],
                "sourceSha256": selected_item["sha256"],
                "filename": filename, "sha256": _sha(derivative),
                "words": len(derivative) // 4, "clist": clist,
                "codeAndDataUnchanged": derivative[:-(len(clist) * 4)] ==
                    source_raw[:-(len(clist) * 4)],
                "disposition": "private-verified-localization",
            })
        else:
            source.pop("filename", None)
            source.pop("binary_hash", None)
            source.pop("binaryHash", None)
            source.pop("token", None)
            source.pop("cache_token", None)
            source.pop("cacheToken", None)

        source["slot"] = _int(descriptor["slot"], "target slot")
        source["seq"] = _int(descriptor["sequence"], "target sequence")
        source["location"] = _int(descriptor["location"], "target location")
        source["limit"] = _int(descriptor["limit"], "target limit")
        if descriptor.get("requiresFreshThreadImage"):
            source["type"] = "Thread"
            source["allocationWords"] = _int(
                descriptor["allocationWords"], "fresh Thread allocation")
            source["requiresFreshThreadImage"] = True
            source["stackWords"] = _int(
                config["step1"].get("threadStackWords", 32), "Thread stack words")
        elif source["name"] == "Boot.NS":
            source["type"] = "Inform"
        if source.get("location", 0) >= _int(
                config["step1"]["totalNamespaceWords"], "Namespace capacity"):
            source["backing"] = "mmio"
        result_rows.append(source)

    return {
        "namespaceFormat": FORMAT,
        "abstractions": sorted(result_rows, key=lambda row: row["slot"]),
    }, localized_records


def _verify_localized_derivative(raw, owner, target_by_slot):
    """Independently verify each private resident against final target rows."""
    from server.boot_image import create_gt

    label = owner["name"]
    words, cc = _validate_lump(raw, label)
    if cc < 1:
        raise ValueError(f"{label}: localized resident has no SELF row")
    start = len(words) - cc
    owner_slot = _int(owner["slot"], f"{label} target slot")
    owner_sequence = _int(owner["seq"], f"{label} target sequence")
    expected_self = create_gt(owner_sequence, owner_slot, {"E": 1}, 1)
    if words[start] != expected_self:
        raise ValueError(f"{label}: localized row zero does not match its target SELF")
    for row_index, word in enumerate(words[start + 1:start + cc], 1):
        if ((word >> 25) & 0x3) not in (1, 2):
            continue
        slot = word & _SLOT_MASK
        sequence = (word >> 16) & 0x1FF
        target = target_by_slot.get(slot)
        if target is None or sequence != _int(
                target.get("seq", 0), f"target NS[{slot}] sequence"):
            raise ValueError(
                f"{label}: localized c-list row {row_index} does not match a live "
                "destination Namespace row")
        if word >> 31:
            raise ValueError(f"{label}: localized c-list row {row_index} is marked free")


def prepare_migration(review_directory, output, *, compiler_candidates=None,
                      staging_root=None):
    """Write a new migration package without changing any reviewed input."""
    review_directory = Path(review_directory)
    output = Path(output)
    root = Path(staging_root) if staging_root is not None else (
        Path(__file__).resolve().parents[1] / "generated-artifacts")
    root = root.resolve()
    resolved_output = output.resolve()
    if (not resolved_output.is_relative_to(root) or resolved_output == root
            or resolved_output.parent != root):
        raise ValueError("Migration output must be a new direct child of generated-artifacts")
    if output.exists() or output.is_symlink():
        raise ValueError("Refusing to replace an existing migration package")
    resolved_review = review_directory.resolve()
    if not resolved_review.is_relative_to(root):
        raise ValueError("Frozen review must remain under generated-artifacts")
    if resolved_output.is_relative_to(resolved_review):
        raise ValueError("Migration package cannot be inside its frozen layout review")
    review, review_raw, inputs = _load_review(review_directory)
    source_state = json.loads(inputs["ns-state.json"])
    config = json.loads(inputs["boot-config.json"])
    localized_lumps = {}
    target_state, localized_records = _target_state(
        review, source_state, config, inputs, localized_lumps)
    target_by_slot = {row["slot"]: row for row in target_state["abstractions"]}
    target_by_name = {row["name"]: row for row in target_state["abstractions"]}
    from server.namespace_ascending_image import build_fresh_thread_lump

    fresh_thread_records = []
    for row in target_state["abstractions"]:
        if not row.get("requiresFreshThreadImage") or row["name"] == "Boot.Thread":
            continue
        ordinal_text = row["name"].removeprefix("Thread.")
        if not ordinal_text.isdigit() or int(ordinal_text) < 2:
            raise ValueError(f"{row['name']}: fresh Thread destination identity is not explicit")
        entry_name = "CapabilityTest" if int(ordinal_text) <= 3 else "SelfTest"
        entry = target_by_name.get(entry_name)
        if entry is None or entry.get("type") not in ("Inform", "Resident"):
            raise ValueError(f"{row['name']}: fresh Thread requires a live {entry_name} target")
        destination_slot = _int(row["slot"], f"{row['name']} destination slot")
        destination_sequence = _int(row["seq"], f"{row['name']} destination sequence")
        entry_slot = _int(entry["slot"], f"{entry_name} destination slot")
        entry_sequence = _int(entry["seq"], f"{entry_name} destination sequence")
        raw = build_fresh_thread_lump(
            allocation_words=_int(row["allocationWords"], f"{row['name']} allocation"),
            stack_words=_int(row["stackWords"], f"{row['name']} stack"),
            entry_slot=entry_slot, entry_sequence=entry_sequence)
        filename = f"{row['name']}.ascending-thread.lump"
        if filename in localized_lumps:
            raise ValueError(f"{row['name']}: duplicate fresh Thread image filename")
        localized_lumps[filename] = raw
        binding = {
            "format": "fresh-thread-continuation-v1",
            "destinationSlot": destination_slot,
            "destinationSequence": destination_sequence,
            "entryName": entry_name,
            "entrySlot": entry_slot,
            "entrySequence": entry_sequence,
            "sha256": _sha(raw),
        }
        row["filename"] = filename
        row["binary_hash"] = _sha(raw)
        row["freshThreadImage"] = binding
        fresh_thread_records.append({
            "name": row["name"], "filename": filename, "sha256": _sha(raw),
            "destinationSlot": destination_slot,
            "destinationSequence": destination_sequence,
            "entryName": entry_name, "entrySlot": entry_slot,
            "entrySequence": entry_sequence,
            "allocationWords": row["allocationWords"],
            "stackWords": row["stackWords"],
            "zeroInitialized": True,
            "approvalEligible": False, "activationAllowed": False,
        })
    for record in localized_records:
        raw = localized_lumps[record["filename"]]
        target_row = next(
            row for row in target_state["abstractions"]
            if row["name"] == record["name"])
        if _sha(raw) != target_row["binary_hash"]:
            raise ValueError(f"{record['name']}: target Namespace hash does not bind its derivative")
        _verify_localized_derivative(raw, target_row, target_by_slot)
        record["destinationCListVerified"] = True
    localized_by_name = {item["name"]: item for item in localized_records}
    affected_binding_evidence = []
    for binding in review["proposal"].get("affectedBindings", []):
        resident = localized_by_name.get(binding["name"])
        row_number = binding["clistRow"]
        match = (next((row for row in resident["clist"]
                       if row["row"] == row_number), None) if resident else None)
        if (match is None or match["sourceGT"] != binding["sourceGT"].lower()
                or match.get("sourceSlot") != binding["sourceSlot"]
                or match.get("destinationSlot") != binding["destinationSlot"]
                or match["kind"] != "localized"):
            raise ValueError(
                f"{binding['name']} C-list row {row_number} does not match the review relocation")
        affected_binding_evidence.append({
            "name": binding["name"], "clistRow": row_number,
            "sourceGT": match["sourceGT"], "destinationGT": match["destinationGT"],
            "sourceSlot": match["sourceSlot"],
            "destinationSlot": match["destinationSlot"], "verified": True,
        })

    compiler_summary = None
    compiler_record_raw = None
    if compiler_candidates is not None:
        candidate_dir = Path(compiler_candidates)
        record_path = candidate_dir / "candidates.json"
        if record_path.is_symlink():
            raise ValueError("Compiler candidate record must not be a symlink")
        compiler_record_raw = record_path.read_bytes()
        compiler_record = json.loads(compiler_record_raw)
        if (compiler_record.get("activationAllowed") is not False
                or compiler_record.get("approvalEligible") is not False
                or compiler_record.get("layoutReviewSha256") != _sha(review_raw)):
            raise ValueError("Compiler candidates are not tied to this frozen layout review")
        compiler_summary = {
            "status": compiler_record.get("status"),
            "authorizedNames": compiler_record.get("authorizedNames", []),
            "candidates": compiler_record.get("candidates", []),
            "failures": compiler_record.get("failures", []),
            "usedForLocalizedResidents": False,
            "approvalEligible": False, "activationAllowed": False,
        }

    unresolved_threads = [
        {"name": row["name"], "slot": row["slot"],
         "reason": "fresh Thread image is required before image generation"}
        for row in target_state["abstractions"]
        if row.get("requiresFreshThreadImage") and row["name"] != "Boot.Thread"
        and not row.get("freshThreadImage")
    ]
    report = {
        "schema": SCHEMA,
        "status": "private-migration-rows-prepared",
        "format": FORMAT,
        "reviewId": review["reviewId"],
        "layoutReviewSha256": _sha(review_raw),
        "sourceNamespaceSha256": review["inputs"]["ns-state.json"],
        "targetNamespaceSha256": _canonical_digest(target_state),
        "localizedResidents": localized_records,
        "freshThreadImages": fresh_thread_records,
        "affectedBindingsVerified": affected_binding_evidence,
        "unbuiltThreadRows": unresolved_threads,
        "compilerCandidates": compiler_summary,
        "approvalEligible": False,
        "activationAllowed": False,
        "imageGenerated": False,
        "blockers": [
            "This package is a private migration artifact; no saved Namespace, LUMP, approval, or active image was changed.",
            "Fresh Thread images are private destination derivatives and carry no approval authority.",
            "Compiler outputs are not selected automatically; localized copies are private derivatives with no approval authority.",
        ],
    }
    report["migrationId"] = _canonical_digest(report)

    # Re-read every frozen input immediately before publishing the package.
    if _frozen_inputs(review_directory, review) != inputs:
        raise ValueError("A frozen review input changed during migration; no package was written")
    if _load_review(review_directory)[1] != review_raw:
        raise ValueError("Frozen layout review changed during migration; no package was written")

    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".namespace-migration-", dir=output.parent))
    try:
        (stage / "inputs").mkdir()
        for name, raw in inputs.items():
            target = stage / "inputs" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        (stage / "layout-review.json").write_bytes(review_raw)
        (stage / "target-state.json").write_text(
            json.dumps(target_state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        (stage / "localized-lumps").mkdir()
        for filename, raw in localized_lumps.items():
            (stage / "localized-lumps" / filename).write_bytes(raw)
        if compiler_record_raw is not None:
            (stage / "compiler-candidates.json").write_bytes(compiler_record_raw)
        (stage / "migration.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(stage, output)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return report
