"""Fresh, non-activating C-list binding evidence for a saved design.

Only the existing authenticated portable linker may generate destination GTs.
Legacy local GTs are inspection evidence, never a substitute for declared locks.
"""
import hashlib
import json
import struct
from pathlib import Path

from server.simulation_preparation import artifact_bindings, _localize_portable, _validate_body


def binding_report(document, directory, fingerprint):
    directory = Path(directory)
    lists, candidates, rows, bodies = [], [], [], {}
    for placement in document["rows"]:
        if placement["kind"] != "lump":
            continue
        selection = placement.get("selection") or {}
        item = dict(slot=placement["slot"], name=placement["name"],
                    filename=selection.get("filename"), status="blocked", rows=[])
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
                    name=dep["N"], permissions="".join(dep["rights"]))
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            item["reason"] = str(exc)

    by_slot = {binding["slot"]: binding for binding in candidates}
    for item in lists:
        binding = by_slot.get(item["slot"])
        if item.get("reason") or not binding:
            continue
        try:
            localized, _ = _localize_portable(
                bodies[item["slot"]], binding, rows, candidates, directory)
            words = _validate_body(localized)
            cc = words[0] & 255
            for row in item["rows"]:
                gt = words[len(words)-cc+row["index"]]
                row.update(newGT=gt, targetSlot=gt & 65535, status="bound")
            item.update(status="bound", derivativeHash=hashlib.sha256(localized).hexdigest(),
                        reason="Freshly bound for this design only; not activated.")
        except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
            item["reason"] = str(exc)
    return dict(fingerprint=fingerprint, status="complete" if lists and all(
        item["status"] == "bound" for item in lists) else "blocked",
        installed=False, lists=lists)
