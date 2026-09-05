"""Canonical LUMP naming and hash-bound approval validation."""
import hashlib
import json
import os
import re
from server.lump_approvals import read_approvals

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


def check_lump_canonical_integrity(lumps_dir, key8, lump_raw):
    records, error = _manifest(lumps_dir)
    if error:
        return error
    matches = [x for x in records if isinstance(x, dict) and x.get("token") == key8]
    if len(matches) > 1:
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
    if compute_number(dot_name, lump_raw) != number:
        return f"Filename integrity failure for {entry['filename']} (token {key8})."
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
    entries = [e for e in records if isinstance(e, dict) and e.get("token") == key8]
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
    identity = f"{dot_name}#{issue}"
    identity_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    if (approval.get("dot_name") != dot_name or approval.get("issue_n") != issue
            or approval.get("identity_hash") != identity_hash):
        result.update(ok=False, error="Hash-bound approval identity disagrees with binary.",
                      reason="approval-identity-mismatch")
        return result
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
        headers["X-Lump-Identity-Hash"] = f"sha256:{resolution.get('identity_hash', '')}"
    else:
        headers["X-Lump-Trust"] = "untrusted"
    return headers