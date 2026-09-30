"""Pure rules for programmer-owned Namespace publication (never repairs data)."""
import hashlib
import json


def namespace_fingerprint(entries):
    """Identity of the complete reviewed row set, including policy and placement."""
    return hashlib.sha256(json.dumps(
        entries, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def validate_namespace_rows(entries, max_slots=256):
    """Reject contradictory assignments; do not infer, hydrate, or mutate rows."""
    if not isinstance(entries, list):
        raise ValueError("Namespace abstractions must be a list")
    seen = set()
    for row in entries:
        if not isinstance(row, dict):
            raise ValueError("Namespace contains a non-object row")
        slot = row.get("slot")
        if type(slot) is not int or not 0 <= slot < max_slots or slot in seen:
            raise ValueError(f"Invalid or duplicate Namespace slot {slot!r}")
        seen.add(slot)
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"NS[{slot}] requires a Pet Name")
        for flag in ("symbolic", "implementationMissing", "resident", "boot_resident", "boot"):
            if flag in row and type(row[flag]) is not bool:
                raise ValueError(f"NS[{slot}] {flag} must be boolean")
        design = row.get("symbolic") is True or row.get("implementationMissing") is True
        if design:
            if row.get("symbolic") is not True or row.get("implementationMissing") is not True:
                raise ValueError(f"NS[{slot}] design placement requires both symbolic and implementationMissing")
            forbidden = ("token", "filename", "binaryHash", "binary_hash",
                         "identityHash", "identity_hash", "cacheToken", "cache_token",
                         "resident", "boot_resident", "boot")
            if any(row.get(key) not in (None, "", False) for key in forbidden):
                raise ValueError(f"NS[{slot}] design placement cannot carry executable or resident identity")
            if row.get("location") not in (None, 0, "0x00000000"):
                raise ValueError(f"NS[{slot}] design placement requires zero physical location")
            if row.get("load_policy") == "Resident":
                raise ValueError(f"NS[{slot}] design placement cannot claim Resident policy")
        elif "selection" in row:
            raise ValueError(f"NS[{slot}] design selection requires a symbolic placement")
    return entries