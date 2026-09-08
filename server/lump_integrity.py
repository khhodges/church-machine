"""Canonical LUMP naming and hash-bound approval validation."""
import hashlib
import json
import os
import re
from server.lump_approvals import read_approvals
from server.bootstrap_identity import verify_bootstrap_self_gt, resident_inform_egt

_HEX8_RE = re.compile(r"^[0-9a-f]{8}$")
_HEX24_RE = re.compile(r"^[0-9a-f]{24}$")
_CANONICAL_RE = re.compile(r"^(.+)\.([1-9][0-9]*)\.([0-9a-f]{8})\.lump$")


class LumpTokenError(ValueError):
    """A request token is not a supported canonical LUMP token."""


def normalize_lump_token(token_hex):
    if not isinstance(token_hex, str):
        raise LumpTokenError("token must be a string")
    raw = token_hex.strip().lower()
    if _HEX8_RE.fullmatch(raw):
        return {"raw": raw, "kind": "cache", "key8": raw, "ide_token": None}
    if _HEX24_RE.fullmatch(raw):
        return {"raw": raw, "kind": "outform", "key8": raw[-8:], "ide_token": raw}
    raise LumpTokenError(
        f"Invalid lump token {token_hex!r}: expected exactly 8 hex (32-bit "
        f"cache/index) or 24 hex (96-bit Outform IDE token), got {len(raw)} char(s).")


def to_dot_name(name):
    name = name.strip()
    name = re.sub(r"^Abstraction\s*:\s*", "", name).strip()
    name = re.sub(r"\s*\(", ".", name).replace(")", "")
    name = re.sub(r"\.{2,}", ".", name.replace("_", ".").replace(" ", "."))
    return name.strip(".")


def compute_number(dot_name, lump_raw):
    return hashlib.sha256(dot_name.encode("utf-8") + lump_raw).hexdigest()[:8]


def parse_canonical_filename(filename):
    match = _CANONICAL_RE.fullmatch(filename or "")
    return (match.group(1), int(match.group(2)), match.group(3)) if match else None


def _manifest(lumps_dir):
    try:
        with open(os.path.join(lumps_dir, "manifest.json")) as fh:
            value = json.load(fh)
    except (OSError, ValueError) as exc:
        return None, f"Integrity check failed: manifest.json is unreadable ({exc})."
    if not isinstance(value, list):
        return None, "Integrity check failed: manifest.json is not a JSON array."
    return value, None


def _approvals(lumps_dir):
    try:
        return read_approvals(os.path.join(lumps_dir, "approvals.json")), None
    except FileNotFoundError:
        return {}, None
    except (OSError, ValueError) as exc:
        return None, f"Integrity check failed: approvals.json is unreadable ({exc})."


def _frozen_bootstrap_binding(lumps_dir, key8, filename):
    """Find one authoritative static resident binding, or fail closed."""
    try:
        with open(os.path.join(lumps_dir, "ns-state.json")) as source:
            rows = json.load(source).get("abstractions", [])
    except (OSError, ValueError, AttributeError):
        return None
    matches = [row for row in rows if isinstance(row, dict)
               and row.get("token") == key8 and row.get("filename") == filename
               and row.get("resident") is True and row.get("boot_resident") is True
               and row.get("ns_slot_policy") == "static"
               and row.get("load_policy") == "Resident"
               and row.get("type") in ("Inform", "Resident")]
    return matches[0] if len(matches) == 1 else None


def check_lump_canonical_integrity(lumps_dir, key8, lump_raw):
    records, error = _manifest(lumps_dir)
    if error:
        return error
    matches = [
        x for x in records
        if isinstance(x, dict)
        and not x.get("archived")
        and x.get("token") == key8
    ]
    if len(matches) > 1:
        filenames = {
            entry.get("filename") for entry in matches
            if isinstance(entry.get("filename"), str)
        }
        if len(filenames) != 1:
            return f"Integrity invariant violated: duplicate manifest token {key8}."
    if not matches:
        return None
    entry = matches[0]
    filename = entry.get("filename")
    if not isinstance(filename, str):
        return f"Integrity invariant violated: token {key8} has no filename locator."
    try:
        with open(os.path.join(lumps_dir, filename), "rb") as fh:
            stored = fh.read()
    except OSError as exc:
        return f"Integrity check failed: located binary is unreadable ({exc})."
    if stored != lump_raw:
        return f"Integrity invariant violated: located bytes disagree for token {key8}."
    if len(lump_raw) < 4 or len(lump_raw) % 4:
        return f"Integrity invariant violated: malformed LUMP bytes for token {key8}."
    header = int.from_bytes(lump_raw[:4], "big")
    if ((header >> 27) & 0x1f) != 0x1f or len(lump_raw) != (1 << (((header >> 23) & 0xf) + 6)) * 4:
        return f"Integrity invariant violated: malformed LUMP allocation for token {key8}."
    approvals, error = _approvals(lumps_dir)
    if error:
        return error
    approval = approvals.get(hashlib.sha256(lump_raw).hexdigest())
    if not isinstance(approval, dict):
        return None
    if approval.get("filename") != filename:
        return f"Integrity invariant violated: hash-bound approval filename disagrees for token {key8}."
    parsed = parse_canonical_filename(entry.get("filename", ""))
    if parsed is None:
        return f"Integrity invariant violated: canonical token {key8} has an invalid filename."
    dot_name, issue, number = parsed
    if dot_name != approval.get("dot_name") or issue != approval.get("issue_n"):
        return f"Integrity invariant violated: canonical filename identity disagrees for token {key8}."
    binding = _frozen_bootstrap_binding(lumps_dir, key8, filename)
    if binding is None and compute_number(dot_name, lump_raw) != number:
        return f"Filename integrity failure for {entry['filename']} (token {key8})."
    if binding is not None:
        cc = header & 0xff
        if cc < 1:
            return f"Bootstrap identity failure for token {key8}: c-list row 0 is absent."
        allocation = 1 << (((header >> 23) & 0xf) + 6)
        row0 = int.from_bytes(
            lump_raw[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
        try:
            verify_bootstrap_self_gt(
                binding,
                row0, approval.get("bootstrap_t"))
        except ValueError as exc:
            return f"Bootstrap identity failure for token {key8}: {exc}"
        if approval.get("bootstrap_runtime_gt") != row0:
            return f"Bootstrap identity failure for token {key8}: approval GT differs from row 0."
    return True


def resolve_canonical_lump(lumps_dir, key8, lump_raw):
    """Resolve bytes only through their manifest record and exact SHA-256 approval."""
    digest = hashlib.sha256(lump_raw).hexdigest()
    result = {"ok": True, "trusted": False, "identity_verified": False,
              "error": None, "dot_name": None, "issue_n": None,
              "identity_hash": None, "binary_hash": digest,
              "cache_token": key8, "reason": ""}
    if not _HEX8_RE.fullmatch((key8 or "").lower()):
        result.update(ok=False, error="Integrity check failed: invalid cache token.",
                      reason="bad-cache-token")
        return result
    records, error = _manifest(lumps_dir)
    if error:
        result.update(ok=False, error=error, reason="manifest-unreadable")
        return result
    entries = [
        e for e in records
        if isinstance(e, dict)
        and not e.get("archived")
        and e.get("token") == key8
    ]
    if len(entries) != 1:
        result.update(ok=False, error="Canonical manifest record is missing or ambiguous.",
                      reason="manifest-ambiguous")
        return result
    entry = entries[0]
    canonical = check_lump_canonical_integrity(lumps_dir, key8, lump_raw)
    if canonical is not True:
        result.update(ok=False, error=canonical or "No exact hash-bound canonical approval exists.",
                      reason="canonical-invalid" if canonical else "approval-missing")
        return result
    approvals, error = _approvals(lumps_dir)
    if error:
        result.update(ok=False, error=error, reason="approvals-unreadable")
        return result
    approval = approvals.get(digest)
    if not isinstance(approval, dict) or approval.get("binary_hash") != digest:
        result.update(ok=False, error="No exact hash-bound canonical approval exists.",
                      reason="approval-missing")
        return result
    parsed = parse_canonical_filename(entry["filename"])
    if parsed is None:
        result.update(ok=False, error="Canonical filename is invalid.",
                      reason="canonical-invalid")
        return result
    dot_name, issue, number = parsed
    binding = _frozen_bootstrap_binding(lumps_dir, key8, entry["filename"])
    identity = f"{dot_name}#{issue}"
    identity_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    bootstrap_t = approval.get("bootstrap_t")
    bootstrap_gt = approval.get("bootstrap_runtime_gt")
    is_bootstrap = binding is not None
    if (approval.get("dot_name") != dot_name or approval.get("issue_n") != issue
            or (not is_bootstrap and approval.get("identity_hash") != identity_hash)):
        result.update(ok=False, error="Hash-bound approval identity disagrees with binary.",
                      reason="approval-identity-mismatch")
        return result
    if is_bootstrap:
        header = int.from_bytes(lump_raw[:4], "big")
        allocation, cc = 1 << (((header >> 23) & 0xF) + 6), header & 0xFF
        if cc < 1 or len(lump_raw) < allocation * 4:
            result.update(ok=False, error="Bootstrap LUMP lacks c-list row-0 SELF GT.",
                          reason="bootstrap-row0-missing")
            return result
        row0 = int.from_bytes(lump_raw[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
        try:
            verify_bootstrap_self_gt(
                binding,
                row0, bootstrap_t)
        except ValueError as exc:
            result.update(ok=False, error=f"Bootstrap identity disagrees with row 0: {exc}",
                          reason="bootstrap-row0-mismatch")
            return result
        if row0 != bootstrap_gt:
            result.update(ok=False, error="Bootstrap approval GT disagrees with row 0.",
                          reason="bootstrap-row0-mismatch")
            return result
    if is_bootstrap:
        result.update(trusted=True, identity_verified=True, dot_name=dot_name,
                      issue_n=issue, cache_token=key8, reason="bootstrap-t-verified")
    else:
        result.update(trusted=(key8 == number), identity_verified=True, dot_name=dot_name,
                      issue_n=issue, identity_hash=identity_hash,
                      cache_token=number,
                      reason="canonical-verified" if key8 == number else "lookup-alias-untrusted")
    return result


def canonical_binding_headers(resolution):
    headers = {"X-Lump-Cache-Token": resolution.get("cache_token", ""),
               "X-Lump-Binary-Hash": f"sha256:{resolution.get('binary_hash', '')}"}
    if resolution.get("trusted"):
        headers["X-Lump-Trust"] = "canonical"
        headers["X-Lump-Dot-Name"] = resolution.get("dot_name", "")
        headers["X-Lump-Issue-N"] = str(resolution.get("issue_n", ""))
        if resolution.get("identity_hash"):
            headers["X-Lump-Identity-Hash"] = f"sha256:{resolution.get('identity_hash', '')}"
    else:
        headers["X-Lump-Trust"] = "untrusted"
    return headers