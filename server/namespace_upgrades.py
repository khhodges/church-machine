"""Read-only, exact-artifact upgrade review for Namespace design saves."""
import copy
import hashlib
import json
from pathlib import Path


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True).encode()).hexdigest()


def identity(row):
    return {key: row.get(key) for key in
            ("filename", "token", "lump_version", "binary_hash")}


def review(rows, directory, prepare_candidate, validate_allocation):
    # Unlike advisory freshness, an unreadable catalogue is a failed check.
    manifest = json.loads((Path(directory) / "manifest.json").read_text())
    if not isinstance(manifest, list) or any(not isinstance(r, dict) for r in manifest):
        raise ValueError("Saved LUMP catalog is invalid; retry after repairing it")
    upgrades = []
    evidence = []
    for selected in rows:
        if not selected.get("filename") or selected.get("symbolic") is True:
            continue
        version = selected.get("lump_version")
        if type(version) is not int:
            # Inspector/design selections may deliberately omit revision order.
            # Recover it only from exact bytes and an unambiguous catalog match;
            # never infer it from the newest entry or from token reuse alone.
            matches = [r for r in manifest
                       if r.get("abstraction") == selected.get("name")
                       and r.get("filename") == selected.get("filename")
                       and r.get("token") == selected.get("token")
                       and r.get("binary_hash") == selected.get("binary_hash")
                       and type(r.get("lump_version")) is int]
            versions = {r["lump_version"] for r in matches}
            filename = selected["filename"]
            exact_bytes = False
            if (isinstance(filename, str) and Path(filename).name == filename
                    and not (Path(directory) / filename).is_symlink()):
                try:
                    exact_bytes = (hashlib.sha256((Path(directory) / filename).read_bytes()).hexdigest()
                                   == selected.get("binary_hash"))
                except OSError:
                    pass
            if len(versions) == 1 and exact_bytes:
                version = versions.pop()
            else:
                upgrades.append({
                    "slot": selected["slot"], "abstraction": selected["name"],
                    "selected": identity(selected), "proposed": None,
                    "blocked": "Revision ordering is unavailable for this exact selection. "
                               "It will be preserved unchanged; select an exact catalog revision "
                               "to check its upgrades.",
                    "replacement": None,
                })
                continue
        candidates = [r for r in manifest
                      if r.get("abstraction") == selected.get("name")
                      and type(r.get("lump_version")) is int
                      and r["lump_version"] > version]
        candidates.sort(key=lambda r: (r["lump_version"], str(r.get("filename"))),
                        reverse=True)
        choices = []
        for candidate in candidates:
            proposed = identity(candidate)
            blocked = None
            updated = None
            try:
                filename = candidate.get("filename")
                if not isinstance(filename, str) or Path(filename).name != filename:
                    raise ValueError("Candidate has no safe exact saved filename")
                path = Path(directory) / filename
                if path.is_symlink():
                    raise ValueError("Mutable artifact aliases cannot be upgraded")
                proposed["binary_hash"] = hashlib.sha256(path.read_bytes()).hexdigest()
                probe = copy.deepcopy(selected)
                probe["boot"] = True  # Reuse exact pin admission, not boot selection.
                _, updated = prepare_candidate([probe], directory, pin={
                    "filename": filename, "token": candidate.get("token"),
                    "revision": candidate["lump_version"],
                })
                if "boot" in selected:
                    updated["boot"] = selected["boot"]
                else:
                    updated.pop("boot", None)
                # Aliases must not retain authority from the previous bytes.
                for alias, key in (("binaryHash", "binary_hash"),
                                   ("cache_token", "token"), ("cacheToken", "token")):
                    if alias in updated:
                        updated[alias] = updated[key]
                for key in ("identity_hash", "identityHash"):
                    if key not in candidate:
                        updated.pop(key, None)
                proposed = identity(updated)
                if proposed["binary_hash"] != hashlib.sha256(path.read_bytes()).hexdigest():
                    raise ValueError("Candidate bytes changed during review")
                validate_allocation([updated if r["slot"] == selected["slot"] else r
                                     for r in rows])
            except (OSError, ValueError, TypeError, KeyError) as exc:
                blocked = str(exc)
            evidence.append({"slot": selected["slot"], "candidate": candidate,
                             "identity": proposed, "blocked": blocked})
            choices.append({
                "slot": selected["slot"], "abstraction": selected["name"],
                "selected": dict(identity(selected), lump_version=version), "proposed": proposed,
                "blocked": blocked, "replacement": updated if not blocked else None,
            })
        if choices:
            # History flags do not disqualify exact, admitted bytes. Token reuse
            # and token changes have identical ancestry (the declared name).
            upgrades.append(next((c for c in choices if not c["blocked"]), choices[0]))
    return {"upgrades": upgrades,
            "reviewFingerprint": fingerprint({"draft": rows, "catalog": manifest,
                                               "evidence": evidence})}


def apply(report, rows, slots):
    if (not isinstance(slots, list) or any(type(s) is not int for s in slots)
            or len(set(slots)) != len(slots)):
        raise ValueError("Upgrade choices must be distinct Namespace slots")
    choices = {item["slot"]: item for item in report["upgrades"]}
    for slot in slots:
        if slot not in choices or choices[slot]["blocked"]:
            raise ValueError(f"NS[{slot}] is not an eligible reviewed upgrade")
    return [copy.deepcopy(choices[row["slot"]]["replacement"]
                          if row["slot"] in slots else row) for row in rows]