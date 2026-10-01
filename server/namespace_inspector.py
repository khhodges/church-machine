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
repair-binding: no options; verified legacy owning SELF only.
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
        result["structurallyValid"] = (header >> 27 == 31 and len(data) == words * 4
                                      and 1 + ((header >> 10) & 8191) + (header & 255) <= words)
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


def _binding(row, claim, lumps_dir):
    """Read-only simulator binding evidence; never generate or authorize an image."""
    from server.simulation_preparation import _validate_body, artifact_bindings
    from server.lump_approvals import read_approvals
    result = {"status": "unverified", "repairable": False}
    if not claim.get("verified") or not claim.get("structurallyValid"):
        result["message"] = "Exact hash-matching complete bytes are required to inspect SELF."
        return result
    try:
        hashes = [row[k].lower() for k in ("binary_hash", "binaryHash")
                  if isinstance(row.get(k), str)]
        if len(set(hashes)) > 1:
            raise ValueError("Artifact digest aliases conflict; explicitly select one exact artifact first.")
        raw = (Path(lumps_dir) / row["filename"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != claim["actualHash"]:
            raise ValueError("Artifact changed during inspection.")
        approvals_path = Path(lumps_dir) / "approvals.json"
        approvals = read_approvals(str(approvals_path)) if approvals_path.exists() else {}
        approval = approvals.get(claim["actualHash"], {})
        if approval.get("portable_binding") is not None:
            selected = dict(row, resident=True, load_policy="Resident")
            selected.pop("symbolic", None)
            selected.pop("implementationMissing", None)
            artifact_bindings([selected], lumps_dir)
            return dict(status="portable", repairable=False,
                        message="Authenticated portable binding: SELF is localized only in a private prepared image; do not replace the saved token.")
        words = _validate_body(raw, executable=True)
        if row.get("type") not in ("Inform", "Resident"):
            raise ValueError("Only Inform/Resident executable assignments support legacy SELF repair.")
        seq, slot = row.get("seq"), row.get("slot")
        if type(seq) is not int or not 0 <= seq <= 511 or type(slot) is not int or not 0 <= slot <= 255:
            raise ValueError("Owning slot and sequence must be exact valid integers.")
        cc = words[0] & 255
        if cc < 1:
            raise ValueError("Legacy executable has no complete SELF row 0.")
        actual, expected = words[len(words) - cc], 0x4A000000 | (seq << 16) | slot
        result.update(selfGT=f"{actual:08x}", expectedGT=f"{expected:08x}")
        if actual != expected:
            raise ValueError("Immutable SELF does not match this slot/sequence (or is unresolved). Recompile/select a suitable artifact; saved bytes cannot be repaired here.")
        tokens = [row[k] for k in ("token", "cache_token", "cacheToken") if k in row]
        mismatch = not tokens or any(not isinstance(t, str) or t.lower() != f"{actual:08x}" for t in tokens)
        result.update(status="descriptor-mismatch" if mismatch else "legacy-bound",
                      repairable=mismatch, token=f"{actual:08x}",
                      message="Immutable SELF matches the owner, but the Namespace token differs. Review Repair binding."
                      if mismatch else "Legacy SELF and saved descriptor token agree; this is not execution approval.")
    except (ValueError, OSError, KeyError, TypeError, RuntimeError) as exc:
        result.update(status="binding-invalid", message=str(exc), repairable=False)
    return result


def _geometry_issues(rows, row, lumps_dir, issue):
    """Saved design ranges only. Never borrow physical bounds from an old image."""
    from server.boot_image import image_artifact_selected
    if not image_artifact_selected(row) or _kind(row) == "mmio":
        return
    intervals, unknown = [], []
    for other in rows:
        if not isinstance(other, dict) or _kind(other) == "mmio":
            continue
        if other.get("slot") == 0:
            # Current V2 private generator reserves sixteen header words.
            intervals.append((0, 16, 0))
            unknown.append("NS[0] table capacity/location")
            continue
        if not image_artifact_selected(other):
            continue
        claim = _artifact(other, lumps_dir)
        start = _number(other.get("location"))
        if start is None or start < 0 or not claim.get("verified") or not claim.get("structurallyValid"):
            unknown.append(f"NS[{other.get('slot')}] full allocation")
            continue
        intervals.append((start, start + claim["geometry"]["allocatedWords"], other["slot"]))
    own = next((r for r in intervals if r[2] == row["slot"]), None)
    if own:
        for start, end, slot in intervals:
            if slot != row["slot"] and own[0] < end and start < own[1]:
                issue("saved-allocation-overlap",
                      f"Saved design NS[{row['slot']}] [{own[0]:#x},{own[1]:#x}) overlaps NS[{slot}] [{start:#x},{end:#x}) (word addresses, full allocations).",
                      "Review saved placement. Private simulation generates a separate reviewed layout; this is not evidence about that layout or the old committed image.")
    if unknown:
        issue("saved-geometry-incomplete", "Saved layout cannot be certified: " + ", ".join(unknown) + " is not established by exact retained bodies.",
              "Review architectural geometry in preparation. Old disk-image geometry is separate evidence, not saved-design authority.", "warning")


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
    if not design and not read_only and row.get("filename"):
        binding = _binding(row, claims["executable"], lumps_dir)
        claims["executable"]["binding"] = binding
        if binding["status"] not in ("portable", "legacy-bound"):
            issue("simulation-" + binding["status"], binding["message"],
                  "Review Repair binding when offered; otherwise select/recompile a valid exact artifact. No LUMP bytes are changed.")
        if binding["repairable"]:
            actions.append("repair-binding")
    _geometry_issues(rows, row, lumps_dir, issue)
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
    from server.lump_integrity import parse_canonical_filename
    canonical = parse_canonical_filename(reference["filename"])
    if canonical and "issue_n" in selected and selected["issue_n"] != canonical[1]:
        raise ValueError("Catalog issue differs from the exact canonical filename; no issue substitution.")
    issue_n = {"issue_n": canonical[1]} if canonical else (
        {"issue_n": row["issue_n"]} if row.get("filename") == reference["filename"] and "issue_n" in row else {})
    return dict(token=reference["token"], filename=reference["filename"],
                binary_hash=reference["binaryHash"],
                **{k: selected[k] for k in ("issue_n", "lump_version") if k in selected},
                **({} if "issue_n" in selected else issue_n))


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
               "clear-selection": set(), "repair-binding": set(), "set-policy": {"policy"}, "edit-geometry": {"location", "limit"}}
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
        if selection == "existing" and retained is None:
            raise ValueError("No existing design selection is present. Explicitly retain the executable reference or choose no artifact selection.")
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
    elif action == "repair-binding":
        binding = _binding(after, view["claims"]["executable"], lumps_dir)
        if not binding.get("repairable"):
            raise ValueError("Exact immutable owning legacy SELF is required; reopen inspection.")
        after["token"] = binding["token"]
        for key in ("cache_token", "cacheToken"):
            if key in after:
                after[key] = binding["token"]
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