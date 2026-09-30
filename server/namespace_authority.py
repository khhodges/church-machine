"""Pure rules for programmer-owned Namespace publication (never repairs data)."""
import hashlib
import json
import re


def validate_namespace_design_rows(entries, max_slots=256):
    """Validate serialization/field formats, not executable or layout authority.

    Missing artifacts, contradictory design policies, overlaps and absent boot
    targets are editable design diagnostics, not reasons to rewrite a table.
    Build publication continues to use validate_namespace_rows and admission.
    """
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
        if (not isinstance(name, str) or not name.strip() or len(name) > 128
                or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            raise ValueError(f"NS[{slot}] requires a bounded Pet Name")
        for key in ("symbolic", "implementationMissing", "resident",
                    "boot_resident", "boot", "archived"):
            if key in row and type(row[key]) is not bool:
                raise ValueError(f"NS[{slot}] {key} must be boolean")
        for key, maximum in (("location", 0xffffffff), ("seal", 0xffffffff),
                             ("limit", 0x1fffff), ("seq", 511),
                             ("f", 1), ("g", 1)):
            if key not in row:
                continue
            value = row[key]
            if isinstance(value, str) and re.fullmatch(r"(?:0[xX][0-9a-fA-F]+|[0-9]+)", value):
                value = int(value, 16 if value.lower().startswith("0x") else 10)
            if type(value) is not int or not 0 <= value <= maximum:
                raise ValueError(f"NS[{slot}] {key} must be an unsigned field value")
        for key in ("issue_n", "lump_version"):
            if key in row and (type(row[key]) is not int or row[key] < 0):
                raise ValueError(f"NS[{slot}] {key} must be a non-negative integer")
        for key in ("type", "load_policy", "loadPolicy", "ns_slot_policy"):
            if key in row and (not isinstance(row[key], str) or len(row[key]) > 128):
                raise ValueError(f"NS[{slot}] {key} must be a bounded string")
        selection = row.get("selection")
        if "selection" in row and not isinstance(selection, dict):
            raise ValueError(f"NS[{slot}] selection must be an object")
        for fields in (row, selection or {}):
            for key in ("token", "cache_token", "cacheToken", "binary_hash",
                        "binaryHash", "identity_hash", "identityHash"):
                if key in fields:
                    width = 8 if key in ("token", "cache_token", "cacheToken") else 64
                    if not isinstance(fields[key], str) or not re.fullmatch(
                            r"[0-9a-fA-F]{%d}" % width, fields[key]):
                        raise ValueError(f"NS[{slot}] {key} has an invalid format")
            if "filename" in fields:
                filename = fields["filename"]
                if (not isinstance(filename, str) or not filename
                        or len(filename) > 255 or "/" in filename or "\\" in filename
                        or filename in (".", "..")
                        or any(ord(c) < 32 for c in filename)):
                    raise ValueError(f"NS[{slot}] filename must be a local filename")
    # Reject non-finite values even in retained extension metadata.
    json.dumps(entries, allow_nan=False)
    return entries


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