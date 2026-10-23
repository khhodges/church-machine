"""Admitted private replay of an exact saved ascending design.

This is not candidate approval, installation, or a historical-image adapter.
Only compiler-authenticated artifacts enter this path. Original bytes and
identities are retained; API-only/localized bodies are private derivatives.
"""
import copy
import hashlib
import math
from pathlib import Path
import struct

from server.namespace_design_v1 import validate, FORMAT
from server.simulation_preparation import artifact_bindings, _validate_body, _localize_portable
from server.symbolic_binding import embedded_api
from server.namespace_ascending_image import generate_image, build_fresh_thread_lump


def selected_rows(document):
    validate(document)
    rows = []
    for item in document["rows"]:
        if item["kind"] != "lump":
            continue
        selected = item.get("selection") or {}
        rows.append(dict(slot=item["slot"], name=item["name"], type="Inform",
                         seq=item["sequence"], resident=True, boot_resident=True,
                         load_policy="Resident", filename=selected.get("filename"),
                         binary_hash=selected.get("binaryHash"), token=selected.get("token"),
                         unresolved=item["policy"] != "Resident" or not selected.get("filename"),
                         boot=item.get("boot", False)))
    return rows


def bindings(document, directory):
    from server.lump_integrity import parse_canonical_filename, compute_number
    from server.lump_approvals import read_approvals, compiler_record_verification_key, is_trusted_compiler_record
    # Existing binding snapshots describe the complete selected graph,
    # including Lazy artifacts. Residency controls emission, not graph identity.
    rows = [row for row in selected_rows(document) if row.get("filename")]
    approvals = read_approvals(str(Path(directory) / "approvals.json"))
    available = []
    for row in rows:
        label = f"NS[{row['slot']}] {row['name']}"
        filename = row["filename"]
        if (not isinstance(filename, str) or Path(filename).name != filename
                or (Path(directory) / filename).is_symlink()):
            raise ValueError(f"{label}: select an exact saved local LUMP, then retry.")
        try:
            raw = (Path(directory) / filename).read_bytes()
        except FileNotFoundError:
            # Keep the selected identity in the saved design. No body or
            # authority is invented for an artifact not yet present.
            continue
        words = _validate_body(raw, executable=True, label=label)
        api = embedded_api(words)
        identity = parse_canonical_filename(filename)
        if not identity or api.get("name") != row["name"] or identity[0] != row["name"]:
            raise ValueError(f"{label}: embedded API names {api.get('name')!r}, selected name is "
                             f"{row['name']!r}. Open its source, declare the intended abstraction, "
                             "compile and approve Save LUMP as a new revision, then select that exact revision. "
                             "Historical bytes were not changed.")
        # Catalog tokens can be historical lookup aliases. They are retained
        # verbatim, but never used as canonical identity or runtime authority.
        if compute_number(identity[0], raw) != identity[2]:
            raise ValueError(f"{label}: canonical token differs from selected bytes; select the exact approved revision.")
        actual = hashlib.sha256(raw).hexdigest()
        if actual != row["binary_hash"]:
            raise ValueError(f"{label}: selected binary hash changed; reselect the exact saved revision.")
        approval = approvals.get(actual)
        if api.get("isa_profile") == "IDX1" or (approval or {}).get("isa_profile") == "IDX1":
            raise ValueError(f"{label}: IDX1 is not admitted by the ascending replay path. "
                             "Keep this profile selected but unexecuted; no ISA conversion was performed.")
        try:
            key = compiler_record_verification_key((approval or {}).get("compiler_record"))
        except RuntimeError as exc:
            raise ValueError(f"{label}: compiler evidence unavailable; recompile and approve a new revision.") from exc
        if not approval or not is_trusted_compiler_record(approval, binary=raw, signing_key=key):
            raise ValueError(f"{label}: authenticated compiler approval is required; compile and approve a new revision.")
        available.append(row)
    result = artifact_bindings(available, directory)
    # Bind evidence for non-portable, already localized approved revisions too.
    for binding in result:
        from server.simulation_preparation import digest
        binding["approvalHash"] = digest(approvals[binding["binaryHash"]])
        binding["canonicalToken"] = parse_canonical_filename(binding["filename"])[2]
    return result


def api_only(raw):
    """Strip source only after authentication, preserving API/code/C-list words."""
    words = _validate_body(raw, executable=True)
    cw, cc = (words[0] >> 10) & 8191, words[0] & 255
    length = words[cw + 1] & 65535
    frame_end = cw + 2 + math.ceil(length / 4)
    if words[cw + 1] >> 24 != 0xAB or not length or frame_end > len(words) - cc:
        raise ValueError("Invalid API frame; recompile the selected LUMP.")
    size = max(64, 1 << (frame_end + cc - 1).bit_length())
    out = words[:frame_end] + [0] * (size - frame_end)
    out[0] = (words[0] & ~(15 << 23)) | ((size.bit_length() - 7) << 23)
    out[cw + 1] = 0xAB000000 | length
    if cc:
        out[-cc:] = words[-cc:]
    return struct.pack(f">{size}I", *out)


def stage(cfg, document, directory, entry_slot):
    from server import boot_image
    source_bindings = bindings(document, directory)
    # Linkers may attach diagnostics to their binding objects. Keep a separate
    # working graph so those reports can never become approval-comparison input.
    runtime_bindings = copy.deepcopy(source_bindings)
    rows = selected_rows(document)
    from server.namespace_binding_targets import non_lump_rows
    rows.extend(non_lump_rows(document))
    # Binding identity belongs to the saved graph, never to derivatives emitted
    # while walking it. Keep lookup inputs separate from mutable output rows.
    binding_rows = copy.deepcopy(rows)
    artifacts, prepared = {}, []
    by_slot = {row["slot"]: row for row in rows}
    available_slots = {binding["slot"] for binding in source_bindings}
    for row in rows:
        if row.get("type") == "Inform" and row["slot"] not in available_slots:
            row["unresolved"] = True
    for binding in source_bindings:
        runtime_binding = next(item for item in runtime_bindings if item["slot"] == binding["slot"])
        row = by_slot[binding["slot"]]
        if row.get("unresolved"):
            continue
        raw = (Path(directory) / binding["filename"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != binding["binaryHash"]:
            raise ValueError("Selected artifact changed during preparation; retry.")
        # No new linker authority: use only authenticated existing contracts.
        if "portableBinding" in binding:
            raw, _ = _localize_portable(
                raw, runtime_binding, copy.deepcopy(binding_rows),
                copy.deepcopy(source_bindings), directory)
        else:
            raw, _ = boot_image.materialize_compiler_self(raw, row, directory, row["name"])
        raw = api_only(raw)
        if binding["filename"] in artifacts:
            raise ValueError("Private simulation requires one destination per selected artifact.")
        artifacts[binding["filename"]] = raw
        row.update(binary_hash=hashlib.sha256(raw).hexdigest(), limit=len(raw)//4-1,
                   simulationBinding=dict(sourceArtifact=copy.deepcopy(binding),
                                          derivativeHash=hashlib.sha256(raw).hexdigest()))
        if "symbolicReport" in runtime_binding:
            row["simulationBinding"]["localizationReport"] = copy.deepcopy(runtime_binding["symbolicReport"])
    for item in document["rows"]:
        slot = item["slot"]
        row = dict(slot=slot, name=item["name"], seq=item["sequence"])
        if item["kind"] == "lump":
            row = by_slot[slot]
        elif item["kind"] == "namespace":
            row.update(type="Inform", location=0)
        elif item["kind"] == "mmio":
            row.update(type="Data", backing="mmio", location=item["address"], limit=item["limit"])
        else:
            row.update(type="Thread", allocationWords=item["words"], stackWords=32, limit=item["words"]-1)
            if slot != 2:
                explicit = item.get("preparedThread")
                # This is the existing codec's fresh-thread contract, not an
                # inferred arbitrary continuation or Amobea implementation.
                ordinal = item["name"].removeprefix("Thread.")
                if not explicit and not ordinal.isdigit():
                    raise ValueError(f"NS[{slot}]: unsupported fresh Thread name; keep this design unexecuted.")
                entry_name = "explicit driver" if explicit else ("CapabilityTest" if int(ordinal) <= 3 else "SelfTest")
                targets = ([by_slot[explicit["entrySlot"]]] if explicit else
                           [r for r in rows if r["name"] in (entry_name, "ide." + entry_name)])
                if len(targets) != 1:
                    row.update(unresolved=True, unresolvedReason=f"Missing named Thread entry {entry_name}")
                    prepared.append(row)
                    continue
                target = targets[0]
                actor = by_slot[explicit["actorSlot"]] if explicit else None
                entry_nia = explicit.get("entryNia", 0) if explicit else 0
                if explicit and "entryNia" in explicit:
                    target_bytes = artifacts.get(target.get("filename"))
                    if not target_bytes:
                        raise ValueError(f"NS[{slot}]: fresh startup entry must be resident")
                    target_header = struct.unpack_from(">I", target_bytes)[0]
                    if entry_nia >= ((target_header >> 10) & 0x1fff):
                        raise ValueError(f"NS[{slot}]: entry NIA is outside the selected entry LUMP code")
                raw = build_fresh_thread_lump(allocation_words=item["words"], stack_words=32,
                                             entry_slot=target["slot"], entry_sequence=target["seq"],
                                             entry_nia=entry_nia,
                                             actor_slot=actor["slot"] if actor else None,
                                             actor_sequence=actor["seq"] if actor else 0)
                filename = f"private-thread-{slot}.lump"
                artifacts[filename] = raw
                row.update(filename=filename, binary_hash=hashlib.sha256(raw).hexdigest(),
                           freshThreadImage=dict(format="fresh-thread-continuation-v1",
                               destinationSlot=slot, destinationSequence=row["seq"],
                               entryName=target["name"], entrySlot=target["slot"],
                               entrySequence=target["seq"], sha256=hashlib.sha256(raw).hexdigest()))
                if actor:
                    row["freshThreadImage"].update(format="prepared-thread-actor-v2",
                        actorSlot=actor["slot"], actorSequence=actor["seq"], actorName=actor["name"])
                if explicit and "entryNia" in explicit:
                    row["freshThreadImage"]["entryNia"] = entry_nia
        prepared.append(row)
    image, _ = generate_image(dict(namespaceFormat=FORMAT, abstractions=prepared), cfg, directory,
                              image_format=FORMAT, artifacts=artifacts)
    words = struct.unpack(f"<{len(image)//4}I", image)
    for row in prepared:
        row["location"] = words[row["slot"] * 4]
    return image, prepared, source_bindings


def configuration(document):
    validate(document)
    return dict(step1=dict(totalNamespaceWords=document["capacityWords"],
                           nsSlotsMax=document["slotCount"], threadLumpWords=256,
                           threadStackWords=32))
