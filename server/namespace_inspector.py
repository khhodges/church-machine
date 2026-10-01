"""Read-only Namespace diagnosis and explicit table-only resolution previews.

No function writes files, selects latest artifacts, allocates slots, or admits
execution. Returned savePayload uses the existing reviewed table-save endpoint.

HTTP contract:
GET /api/namespace/inspect?slot=N -> row, kind, claims, issues, actions,
savedAbstractions, namespaceFingerprint, limitations.
POST /api/namespace/resolve-preview ->
{namespaceFingerprint, slot, action, options}; all options are allowlisted:
keep-design: selection=existing (default), executable, or none;
select-artifact: filename, token, binaryHash, policy;
set-policy: policy=Resident|Preload|Lazy|Empty;
clear-selection: no options (only executable orphan design selections);
edit-geometry: explicit location and/or limit.
Returns before/after, field-level changes (including presence/deletion),
remaining issues, and savePayload. POST that exact savePayload to the normal
/api/namespace/save-table confirmation/CAS flow. Preview never consumes review
consent. Invalid/stale requests return 409 {ok:false,error,dataChanged:false}.
"""
import copy
import hashlib
import json
import re
import struct
from pathlib import Path

from server.namespace_authority import namespace_fingerprint, validate_namespace_design_rows

POLICIES = ("Resident", "Preload", "Lazy", "Empty")
IDENTITY_FIELDS = (
    "token", "filename", "binary_hash", "binaryHash", "identity_hash",
    "identityHash", "cache_token", "cacheToken", "issue_n", "lump_version",
    "artifact_pin", "portable_binding",
)
POLICY_FIELDS = ("resident", "boot_resident", "load_policy", "loadPolicy")


def _number(value):
    try:
        return int(value, 0) if isinstance(value, str) else int(value)
    except (ValueError, TypeError):
        return None


def _kind(row):
    if row.get("slot") in (0, 1):
        return "protected-bootstrap"
    if row.get("type") == "Device" or (_number(row.get("location")) or 0) >= 0xffff0000:
        return "mmio"
    if row.get("slot") in (2, 3, 4, 5, 13) and not row.get("filename"):
        return "mmio"
    if row.get("type") in ("Namespace", "Thread") or (
            not row.get("filename") and row.get("slot") in (11, 12)
            and row.get("name") in ("Thread.2", "Thread.3")):
        return "generated"
    if row.get("symbolic") is True or row.get("implementationMissing") is True:
        return "design-only"
    return "artifact-assignment"


def _artifact(ref, lumps_dir):
    """Report exact-reference evidence, without opening sidecar secrets/proofs."""
    ref = ref if isinstance(ref, dict) else {}
    result = {"reference": copy.deepcopy(ref), "exists": False, "verified": False,
              "status": "unbound", "executionApproved": False}
    filename = ref.get("filename")
    if not filename:
        result["message"] = "No exact saved filename is assigned."
        return result
    root = Path(lumps_dir).resolve()
    if not isinstance(filename, str) or Path(filename).name != filename or "\\" in filename:
        result.update(status="invalid-reference", message="Filename must be a local saved artifact.")
        return result
    path = root / filename
    try:
        if not path.resolve().is_relative_to(root):
            raise ValueError("Artifact reference escapes the saved library.")
        if not path.is_file():
            result.update(status="missing", message="The exact saved artifact is missing.")
            return result
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        result.update(exists=True, actualHash=digest, byteSize=len(data))
        header = struct.unpack(">I", data[:4])[0] if len(data) >= 4 else 0
        words = 1 << (((header >> 23) & 15) + 6)
        result["geometry"] = dict(allocatedWords=words, codeWords=(header >> 10) & 8191,
                                  capabilityWords=header & 255, type=(header >> 8) & 3)
        result["structurallyValid"] = (header >> 27 == 31 and len(data) == words * 4)
        expected = ref.get("binary_hash") or ref.get("binaryHash")
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            result.update(status="missing-digest", message="An exact artifact digest is required.")
        elif digest != expected.lower():
            result.update(status="digest-mismatch", message="Saved bytes differ from the assigned digest.")
        else:
            result.update(status="verified", verified=True,
                          message="Exact bytes match; execution admission is a separate operation.")
    except (OSError, ValueError):
        result.update(status="unreadable", message="The exact artifact cannot be safely read.")
    return result


def inspect_namespace(rows, slot, lumps_dir):
    if type(slot) is not int:
        raise ValueError("slot must be an integer")
    matches = [r for r in rows if isinstance(r, dict) and r.get("slot") == slot]
    if len(matches) != 1:
        raise ValueError("The selected slot must have exactly one saved assignment.")
    row = copy.deepcopy(matches[0])
    kind = _kind(row)
    issues = []

    def issue(code, message, next_action, severity="error"):
        issues.append(dict(code=code, message=message, nextAction=next_action, severity=severity))

    claims = {
        "design": _artifact(row.get("selection"), lumps_dir),
        "executable": _artifact({k: row[k] for k in IDENTITY_FIELDS if k in row}, lumps_dir),
    }
    design = kind == "design-only"
    if design:
        if row.get("symbolic") is not True or row.get("implementationMissing") is not True:
            issue("incomplete-design-flags", "Design-only flags disagree.", "Review Keep design-only.")
        if any(row.get(k) not in (None, "", False) for k in IDENTITY_FIELDS + POLICY_FIELDS):
            issue("mixed-design-executable", "Design-only entry also claims executable identity or loading policy.",
                  "Compare both claims and explicitly keep design-only or select an executable artifact.")
        if (_number(row.get("location")) or 0) != 0:
            issue("design-location", "A design-only entry claims a physical location.", "Review Keep design-only.")
        if row.get("boot") is True:
            issue("design-boot-marker", "A design-only entry is selected as boot entry.",
                  "Move the boot marker explicitly before converting this entry.")
    elif "selection" in row:
        issue("orphan-design-selection", "An executable entry retains a design-time selection.",
              "Compare the two claims; explicitly clear the orphan selection or keep design-only.")
    policies = [row[k] for k in ("load_policy", "loadPolicy") if k in row]
    if len(set(str(p) for p in policies)) > 1:
        issue("policy-alias-conflict", "Loading-policy aliases disagree.", "Choose one explicit loading policy.")
    if any(p not in POLICIES for p in policies):
        issue("unknown-policy", "An unrecognized loading policy is retained.", "Choose an explicit supported policy.")
    if policies and ((policies[0] == "Resident" and row.get("resident") is False) or
                     (policies[0] != "Resident" and
                      (row.get("resident") is True or row.get("boot_resident") is True))):
        issue("policy-flag-conflict", "Residency flags disagree with loading policy.", "Review Set policy.")
    if "resident" in row and "boot_resident" in row and row["resident"] != row["boot_resident"]:
        issue("residency-alias-conflict", "Resident and boot-resident flags disagree.", "Review Set policy.")
    for label, claim in claims.items():
        if claim["status"] != "unbound" and not claim["verified"]:
            issue(label + "-" + claim["status"], claim["message"],
                  "Choose a verified exact saved artifact; never substitute a newer revision automatically.")
    if row.get("filename") and isinstance(row.get("selection"), dict) and row["selection"].get("filename"):
        if claims["design"]["reference"].get("filename") != row["filename"]:
            issue("different-artifact-claims", "The design and executable claims refer to different saved artifacts.",
                  "Inspect both exact revisions before selecting which claim to retain.")
    if kind == "artifact-assignment" and not row.get("filename"):
        issue("missing-artifact-binding", "No exact saved executable artifact is assigned.",
              "Choose an exact artifact or explicitly keep a code-free design entry.")
    if row.get("binaryHash") and row.get("binary_hash") and row["binaryHash"] != row["binary_hash"]:
        issue("digest-alias-conflict", "Artifact digest aliases disagree.", "Select one verified exact artifact.")
    for label, claim in claims.items():
        if claim.get("verified") and not claim.get("structurallyValid"):
            issue(label + "-invalid-lump", "The hash-matching artifact does not have a complete LUMP allocation.",
                  "Select a structurally valid saved artifact; no execution admission is implied.")
    if row.get("boot") is True and policies and policies[0] != "Resident":
        issue("boot-policy-conflict", "The boot entry selects execution despite its non-resident policy.",
              "Review the boot marker and policy explicitly; the inspector never moves the boot marker.")
    try:
        validate_namespace_design_rows([row])
    except (ValueError, TypeError) as exc:
        issue("invalid-row-format", str(exc), "Correct the named field before saving; unsupported fields remain visible.")
    read_only = kind in ("protected-bootstrap", "mmio", "generated")
    actions = [] if read_only else ["keep-design", "select-artifact", "edit-geometry"]
    if not read_only and not design:
        actions += ["set-policy"]
        if "selection" in row:
            actions += ["clear-selection"]
    return dict(ok=True, namespaceFingerprint=namespace_fingerprint(rows),
                savedAbstractions=copy.deepcopy(rows), row=row, kind=kind,
                claims=claims, issues=issues, actions=actions,
                limitations=[
                    "Inspection and preview do not save, install, generate images or authorize execution.",
                    "Unknown fields are displayed and preserved, not silently normalized.",
                    "Bootstrap, generated and MMIO descriptors require their specialized architecture controls."
                    if read_only else "Geometry edits affect design only; preparation validates complete allocations separately.",
                ])


def _verified_choice(options, row, lumps_dir):
    reference = {k: options[k] for k in ("filename", "token", "binaryHash") if k in options}
    if set(reference) != {"filename", "token", "binaryHash"}:
        raise ValueError("Choose filename, token and binaryHash for one exact saved artifact.")
    evidence = _artifact(reference, lumps_dir)
    if not evidence["verified"]:
        raise ValueError("The selected exact artifact is missing, unreadable or has a different digest.")
    if not evidence.get("structurallyValid"):
        raise ValueError("The selected saved artifact is not a complete LUMP allocation.")
    with (Path(lumps_dir) / "manifest.json").open(encoding="utf-8") as source:
        catalog = json.load(source)
    matches = [r for r in catalog if isinstance(r, dict)
               and r.get("filename") == reference["filename"]
               and r.get("token") == reference["token"]
               and (r.get("abstraction") or r.get("name")) == row.get("name")]
    if len(matches) != 1:
        raise ValueError("Exact artifact token and Pet Name must identify one saved record; no latest/name fallback.")
    selected = matches[0]
    known_hash = selected.get("binary_hash") or selected.get("binaryHash")
    if known_hash and known_hash != reference["binaryHash"]:
        raise ValueError("Selected artifact metadata has a different digest.")
    return dict(token=reference["token"], filename=reference["filename"],
                binary_hash=reference["binaryHash"],
                **{k: selected[k] for k in ("issue_n", "lump_version") if k in selected})


def preview_resolution(rows, payload, lumps_dir):
    if not isinstance(payload, dict) or set(payload) - {"namespaceFingerprint", "slot", "action", "options"}:
        raise ValueError("Expected namespaceFingerprint, slot, action and options only.")
    if payload.get("namespaceFingerprint") != namespace_fingerprint(rows):
        raise ValueError("Namespace changed since inspection; reload before reviewing a correction.")
    view = inspect_namespace(rows, payload.get("slot"), lumps_dir)
    action = payload.get("action")
    if action not in view["actions"]:
        raise ValueError("This action is not available for this entry kind; inspect its limitations.")
    options = payload.get("options", {})
    if not isinstance(options, dict):
        raise ValueError("options must be an object")
    allowed = {"keep-design": {"selection"}, "select-artifact": {"filename", "token", "binaryHash", "policy"},
               "clear-selection": set(), "set-policy": {"policy"}, "edit-geometry": {"location", "limit"}}
    if set(options) - allowed[action]:
        raise ValueError("Unexpected action options; no fields were changed.")
    after = copy.deepcopy(view["row"])
    if action == "keep-design":
        if after.get("boot") is True:
            raise ValueError("Move the boot marker explicitly before keeping this entry design-only.")
        selection = options.get("selection", "existing")
        if selection not in ("existing", "executable", "none"):
            raise ValueError("selection must be existing, executable or none")
        retained = copy.deepcopy(after.get("selection"))
        if selection == "existing" and retained is not None and not isinstance(retained, dict):
            raise ValueError("Existing design selection is malformed; explicitly choose none or executable.")
        if selection == "executable":
            if not view["claims"]["executable"]["verified"]:
                raise ValueError("The executable claim must have verified exact bytes before retaining it as design.")
            retained = {"filename": after["filename"], "token": after.get("token"),
                        "binaryHash": after.get("binary_hash") or after.get("binaryHash"),
                        "status": "unresolved", "diagnostic": "Design-only selection; execution is not authorized."}
        elif selection == "none":
            retained = None
        for key in IDENTITY_FIELDS + POLICY_FIELDS:
            after.pop(key, None)
        after.update(symbolic=True, implementationMissing=True, location="0x00000000", limit="0x00000")
        after.pop("selection", None)
        if retained is not None:
            after["selection"] = retained
    elif action in ("select-artifact", "set-policy"):
        policy = options.get("policy")
        if policy not in POLICIES:
            raise ValueError("Choose Resident, Preload, Lazy or Empty explicitly.")
        if action == "select-artifact":
            selected = _verified_choice(options, after, lumps_dir)
            for key in IDENTITY_FIELDS + ("symbolic", "implementationMissing", "selection"):
                after.pop(key, None)
            after.update(selected)
        for key in POLICY_FIELDS:
            after.pop(key, None)
        after.update(load_policy=policy, resident=policy == "Resident")
    elif action == "clear-selection":
        after.pop("selection", None)
    else:
        if not options:
            raise ValueError("Provide location and/or limit explicitly.")
        after.update(options)
    validate_namespace_design_rows([after])
    proposed = [copy.deepcopy(after if r.get("slot") == after["slot"] else r) for r in rows]
    changes = [dict(field=k, beforePresent=k in view["row"], afterPresent=k in after,
                    before=view["row"].get(k), after=after.get(k))
               for k in sorted(set(view["row"]) | set(after))
               if (k in view["row"]) != (k in after) or view["row"].get(k) != after.get(k)]
    return dict(ok=True, dataChanged=False, before=view["row"], after=after, changes=changes,
                issues=inspect_namespace(proposed, after["slot"], lumps_dir)["issues"],
                namespaceFingerprint=view["namespaceFingerprint"],
                savePayload={"namespaceFingerprint": view["namespaceFingerprint"],
                             "ns_state": {"abstractions": proposed}})