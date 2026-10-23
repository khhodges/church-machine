"""Fresh, non-activating C-list binding evidence for a saved design.

Only the existing authenticated portable linker may generate destination GTs.
Legacy local GTs are inspection evidence, never a substitute for declared locks.
"""
import hashlib
import json
import struct
import os
import tempfile
from pathlib import Path

from server.simulation_preparation import artifact_bindings, _localize_portable, _validate_body
from server.binding_cleanup import serialized


@serialized("directory")
def binding_report(document, directory, fingerprint, *, bind_now=True):
    directory = Path(directory)
    lists, candidates, rows, bodies = [], [], [], {}
    for placement in document["rows"]:
        if placement["kind"] != "lump":
            continue
        selection = placement.get("selection") or {}
        item = dict(slot=placement["slot"], name=placement["name"],
                    filename=selection.get("filename"), sourceHash=selection.get("binaryHash"),
                    sourceToken=selection.get("token"), generation=placement["sequence"],
                    status="blocked", rows=[])
        lists.append(item)
        row = dict(slot=placement["slot"], name=placement["name"], type="Inform",
                   seq=placement["sequence"], resident=True, boot_resident=True,
                   load_policy="Resident", filename=selection.get("filename"),
                   binary_hash=selection.get("binaryHash"), token=selection.get("token"))
        rows.append(row)
        try:
            filename = row["filename"]
            if not filename:
                raise ValueError("No exact saved LUMP selected. Select an artifact, then bind again.")
            if Path(filename).name != filename or (directory / filename).is_symlink():
                raise ValueError("The selected artifact must be an exact local file, not an alias.")
            raw = (directory / filename).read_bytes()
            if hashlib.sha256(raw).hexdigest() != row["binary_hash"]:
                raise ValueError("Selected artifact hash changed. Review the exact selection and bind again.")
            words = _validate_body(raw)
            item["sourceWords"] = words
            bodies[row["slot"]] = raw
            cc, cw = words[0] & 255, (words[0] >> 10) & 8191
            # Names are only displayed from the inspected binary. They confer
            # no authority; authenticated relocation locks below govern binding.
            names = {}
            try:
                frame = words[cw + 1]
                length = frame & 65535
                if frame >> 24 == 0xAB and length and (cw + 2) * 4 + length <= (len(words) - cc) * 4:
                    api = json.loads(raw[(cw + 2) * 4:(cw + 2) * 4 + length])
                    for index, capability in enumerate(api.get("capabilities", [])):
                        if isinstance(capability, dict):
                            names[index] = capability.get("name") or capability.get("petName")
            except (ValueError, IndexError, TypeError, AttributeError):
                pass
            item["rows"] = [dict(index=i, name=names.get(i) or "Declared name unavailable",
                                 previousGT=words[len(words)-cc+i], newGT=None,
                                 targetSlot=None, permissions=None, status="blocked")
                            for i in range(cc)]
            binding = artifact_bindings([row], directory)[0]
            candidates.append(binding)
            if not binding.get("portableBinding"):
                raise ValueError("No authenticated dot-name relocation contract. Existing GTs were not reused; recompile with portable binding evidence.")
            for dep in binding["portableBinding"]["dependencies"]:
                item["rows"][dep["relocation_row"]].update(
                    name=dep.get("N") or dep.get("name"), permissions="".join(dep["rights"]))
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            item["reason"] = str(exc)

    from server.namespace_binding_targets import non_lump_rows
    rows.extend(non_lump_rows(document))
    by_slot = {binding["slot"]: binding for binding in candidates}
    for item in lists:
        binding = by_slot.get(item["slot"])
        if item.get("reason") or not binding:
            continue
        try:
            symbolic = binding["portableBinding"].get("schema") == "church.symbolic-lump-binding/v1"
            if symbolic:
                from server.simulation_preparation import _localize_symbolic, symbolic_snapshot_key
                item["snapshotKey"] = symbolic_snapshot_key(binding, rows, candidates)
                localized, _ = _localize_symbolic(
                    bodies[item["slot"]], binding, rows, candidates, directory,
                    bind_now=bind_now, require_snapshot=not bind_now)
                if bind_now:
                    localized, _ = _localize_symbolic(
                        bodies[item["slot"]], binding, rows, candidates, directory,
                        require_snapshot=True)
            else:
                # Portable bindings predate symbolic snapshots. Persist their exact
                # result too; inspection must never invoke the linker.
                from server.simulation_preparation import portable_snapshot_key
                key = portable_snapshot_key(
                    bodies[item["slot"]], binding, rows, candidates)
                path = directory / ".binding-previews" / (key + ".json")
                item["snapshotKey"] = key
                if bind_now:
                    localized, _ = _localize_portable(
                        bodies[item["slot"]], binding, rows, candidates, directory, bind_now=True)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    fd, temporary = tempfile.mkstemp(dir=path.parent)
                    try:
                        with os.fdopen(fd, "w") as out:
                            json.dump(dict(bytes=localized.hex(),
                                hash=hashlib.sha256(localized).hexdigest()), out)
                        os.replace(temporary, path)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
                else:
                    if not path.exists():
                        raise ValueError("No exact binding snapshot. Bind explicitly first.")
                    record = json.loads(path.read_text())
                    localized = bytes.fromhex(record["bytes"])
                    if hashlib.sha256(localized).hexdigest() != record["hash"]:
                        raise ValueError("Binding snapshot integrity failed. Bind again.")
            words = _validate_body(localized)
            cc = words[0] & 255
            for row in item["rows"]:
                gt = words[len(words)-cc+row["index"]]
                row.update(newGT=gt, word=gt, targetSlot=(gt & 65535) if gt else None,
                           status="bound" if gt else "unresolved")
            item.update(status="bound", words=words, derivativeHash=hashlib.sha256(localized).hexdigest(),
                        boundWords=words, namespaceFingerprint=fingerprint,
                        sequence=item["generation"],
                        reason="Freshly bound for this design only; not activated.")
            if not symbolic and any(row["status"] == "unresolved" for row in item["rows"]):
                item.update(status="unresolved",
                            reason="Private derivative retains unresolved NULL references; they HardFault only if executed. Not activated.")
            if symbolic:
                report = binding["symbolicReport"]
                for row, resolved in zip(item["rows"], report["rows"]):
                    row.update(resolved)
                item.update(status=report["status"], calls=report["calls"],
                            reason=("All references bound for this selected design. Not activated."
                                    if report["status"] == "bound" else
                                    "Binding snapshot saved; unresolved references HardFault only if executed. Not activated."))
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            item["reason"] = str(exc)
    status = ("complete" if lists and all(item["status"] == "bound" for item in lists)
              else "unresolved" if lists and all(item["status"] in ("bound", "unresolved") for item in lists)
              else "blocked")
    return dict(fingerprint=fingerprint, status=status,
        installed=False, lists=lists)
