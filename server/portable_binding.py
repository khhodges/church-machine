"""Server-side validation and localization for portable LUMP bindings.

The portable contract deliberately stores no destination GT words.  This module
therefore treats the LUMP bytes as the authority for content, and only mints
local words after the destination namespace is known.
"""
import hashlib
import re

SCHEMA = "church.portable-lump-binding/v1"
_NAME = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*)#([1-9][0-9]*)$")
_HEX8 = re.compile(r"^[0-9a-f]{8}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_RIGHTS = frozenset("RWXLSE")
_TYPES = {"null": 0, "inform": 1, "outform": 2, "abstract": 3}


def _name(value):
    match = _NAME.fullmatch(str(value or "").strip())
    if not match:
        raise ValueError("universal name must be exact dot.name#positive-issue")
    return match.group(1), int(match.group(2))


def _rights(value):
    raw = value if isinstance(value, list) else list(str(value or ""))
    out = []
    for item in raw:
        right = str(item).upper()
        if len(right) != 1 or right not in _RIGHTS:
            raise ValueError("capability rights contain an invalid value")
        if right not in out:
            out.append(right)
    if not out:
        raise ValueError("capability rights must not be empty")
    if any(x in out for x in "RWX") and any(x in out for x in "LSE"):
        raise ValueError("capability rights must not mix Turing and Church domains")
    return out


def _type(value):
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 3:
        return value
    result = _TYPES.get(str("inform" if value is None else value).lower())
    if result is None:
        raise ValueError("capability type must be null, inform, outform, or abstract")
    return result


def validate_portable_binding(binding, cc=None):
    """Return a normalized portable contract or raise ValueError.

    This is intentionally independent of a live Namespace.  A zero/pending
    c-list row is valid here: it is localized only during installation.
    """
    if not isinstance(binding, dict) or binding.get("schema") != SCHEMA:
        raise ValueError("portable_binding must use church.portable-lump-binding/v1")
    dot, issue = _name(binding.get("owner"))
    deps = binding.get("dependencies")
    if not isinstance(deps, list):
        raise ValueError("portable_binding.dependencies must be an array")
    if cc is not None and len(deps) != cc:
        raise ValueError("portable_binding dependency count must equal LUMP header cc")
    compatibility = binding.get("compatibility", "strong")
    if compatibility != "strong":
        raise ValueError("portable_binding compatibility is invalid")
    rows, normalized = set(), []
    for index, raw in enumerate(deps):
        if not isinstance(raw, dict):
            raise ValueError("portable_binding dependency must be an object")
        self_row = (raw.get("symbolic_self") is True or
                    raw.get("compiler_owned_self") is True or
                    str(raw.get("name", "")).upper() == "__SELF__")
        dep_dot, dep_issue = _name(f"{dot}#{issue}" if self_row else
                                   raw.get("N") or raw.get("universal_name") or
                                   raw.get("identity_string") or raw.get("name"))
        row = raw.get("relocation_row", index)
        if isinstance(row, bool) or not isinstance(row, int) or not 0 <= row <= 255:
            raise ValueError("portable_binding relocation row is invalid")
        if row in rows:
            raise ValueError(f"portable_binding has duplicate relocation row {row}")
        rows.add(row)
        token = str(raw.get("T") or raw.get("token") or raw.get("cache_token") or "").lower()
        binary_hash = str(raw.get("binary_hash") or raw.get("content_hash") or "").lower()
        identity_hash = (None if raw.get("identity_hash") is None else
                         str(raw.get("identity_hash")).lower())
        if not self_row and not _HEX8.fullmatch(token):
            raise ValueError(f"{dep_dot}#{dep_issue} requires expected T")
        if not self_row and not _HEX64.fullmatch(binary_hash):
            raise ValueError(f"{dep_dot}#{dep_issue} requires authoritative binary_hash")
        if not self_row and compatibility == "strong" and not _HEX64.fullmatch(identity_hash or ""):
            raise ValueError(f"{dep_dot}#{dep_issue} requires authoritative identity_hash")
        if identity_hash is not None and not _HEX64.fullmatch(identity_hash):
            raise ValueError(f"{dep_dot}#{dep_issue} has malformed identity_hash")
        normalized.append({"N": f"{dep_dot}#{dep_issue}", "dot_name": dep_dot,
                           "issue_n": dep_issue, "T": None if self_row else token,
                           "binary_hash": None if self_row else (binary_hash or None),
                           "identity_hash": identity_hash,
                           "rights": _rights(["E"] if self_row else raw.get("rights", raw.get("grants"))),
                           "capability_type": _type(raw.get("capability_type",
                                                           raw.get("gt_type", raw.get("type")))),
                           "relocation_row": row, "symbolic_self": self_row})
    selves = [d for d in normalized if d["symbolic_self"]]
    if len(selves) != 1:
        raise ValueError("portable_binding requires exactly one symbolic Self")
    self_dep = selves[0]
    if self_dep["relocation_row"] != 0:
        raise ValueError("symbolic Self must be compiler-owned relocation row 0")
    if self_dep["rights"] != ["E"] or self_dep["capability_type"] != 1:
        raise ValueError("symbolic Self must be an Inform capability with exactly E right")
    return {"schema": SCHEMA, "owner": f"{dot}#{issue}", "dependencies": normalized,
            "compatibility": compatibility, "canonical_gt_words": "unresolved"}


def validate_unresolved_clist(contract, lump_words):
    """Require the canonical, destination-independent on-disk c-list form."""
    if not lump_words:
        raise ValueError("portable LUMP body is empty")
    header = int(lump_words[0]) & 0xffffffff
    size = 1 << (((header >> 23) & 0xf) + 6)
    cc = header & 0xff
    if len(lump_words) < size or len(contract.get("dependencies", [])) != cc:
        raise ValueError("portable LUMP c-list geometry is inconsistent")
    start = size - cc
    for dep in contract["dependencies"]:
        word = int(lump_words[start + dep["relocation_row"]]) & 0xffffffff
        if dep["symbolic_self"]:
            if word != 0xFEED5E1F:
                raise ValueError("portable Self row 0 must contain canonical 0xFEED5E1F marker")
        elif word != 0 and (word & 0xffff0000) != 0xfeed0000:
            raise ValueError(
                f"portable external row {dep['relocation_row']} contains an embedded local GT")
    return True


def verify_candidate(dep, candidate, lump_bytes):
    """Verify candidate N/T/hash from actual canonical bytes, never metadata alone."""
    if not isinstance(candidate, dict) or not isinstance(lump_bytes, (bytes, bytearray)):
        return False, "candidate bytes are unavailable"
    dot, issue = _name(candidate.get("N") or candidate.get("universal_name") or
                       candidate.get("identity_string") or
                       f"{candidate.get('dot_name', '')}#{candidate.get('issue_n', '')}")
    if f"{dot}#{issue}" != dep["N"]:
        return False, "exact issued name does not match"
    expected_identity_hash = hashlib.sha256(dep["N"].encode("utf-8")).hexdigest()
    if dep.get("identity_hash") and dep["identity_hash"] != expected_identity_hash:
        return False, "dependency identity hash does not match exact issued name"
    candidate_identity_hash = candidate.get("identity_hash")
    if dep.get("identity_hash") and str(candidate_identity_hash or "").lower() != dep["identity_hash"]:
        return False, "candidate identity hash does not match dependency identity hash"
    if candidate_identity_hash is not None and str(candidate_identity_hash).lower() != expected_identity_hash:
        return False, "candidate identity hash does not match exact issued name"
    actual_t = hashlib.sha256(dot.encode("utf-8") + bytes(lump_bytes)).hexdigest()[:8]
    if not dep["symbolic_self"] and actual_t != dep["T"]:
        return False, "content token does not match actual LUMP bytes"
    actual_hash = hashlib.sha256(bytes(lump_bytes)).hexdigest()
    candidate_hash = str(candidate.get("binary_hash") or "").lower()
    if not _HEX64.fullmatch(candidate_hash):
        return False, "candidate lacks an exact hash-bound approval"
    if candidate_hash != actual_hash:
        return False, "candidate approval hash does not match actual LUMP bytes"
    if not dep["symbolic_self"] and dep["binary_hash"] != actual_hash:
        return False, "authoritative binary hash does not match actual LUMP bytes"
    return True, actual_hash


def mint_gt(sequence, slot, rights, capability_type):
    """Destination-local v2 GT packing."""
    church = any(r in rights for r in "LSE")
    perm = ((4 if "E" in rights else 0) | (2 if "S" in rights else 0) | (1 if "L" in rights else 0)
            if church else (4 if "X" in rights else 0) | (2 if "W" in rights else 0) | (1 if "R" in rights else 0))
    return ((perm << 28) | ((1 if church else 0) << 27) |
            ((capability_type & 3) << 25) | ((sequence & 0x1ff) << 16) | (slot & 0xffff))