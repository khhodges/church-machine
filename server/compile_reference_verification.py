"""Read-only verification of exact pinned compiler references.

The manifest locates bytes only. Hash-bound identity verification supplies the
evidence; Namespace membership, slot numbers and name-only alternatives do not.
"""
import hashlib
import json
import os
import re

from .lump_integrity import resolve_canonical_lump, compute_number, parse_canonical_filename
from .lump_approvals import read_approvals
from .idx1_profile import validate_execution


class UnsupportedReferenceError(ValueError):
    """Reference evidence uses an identity scheme this verifier cannot check."""


def _verify_archive(lumps_dir, entry, raw):
    """Verify an immutable archive without treating its active successor as it.

    Reuse the repository's hash-bound approval and canonical content identity
    rules. Bootstrap runtime-GT identities are deliberately unsupported here:
    no live Namespace state may authorize an archived reference.
    """
    digest = hashlib.sha256(raw).hexdigest()
    approval = read_approvals(os.path.join(lumps_dir, "approvals.json")).get(digest)
    if not isinstance(approval, dict):
        raise ValueError("Archive has no exact hash-bound identity evidence")
    if approval.get("bootstrap_t") is not None:
        raise UnsupportedReferenceError("Archived bootstrap runtime-GT identity is unsupported")
    original = approval.get("filename")
    parsed = parse_canonical_filename(original) if isinstance(original, str) else None
    if parsed is None:
        raise ValueError("Archive approval has no canonical original filename")
    filename = entry["filename"]
    # History renaming preserves approval bytes. Only the exact original name
    # or its standard _vN archive name is accepted, never another name/issue.
    if filename != original and not re.fullmatch(
            re.escape(original[:-5]) + r"_v[1-9][0-9]*\.lump", filename):
        raise ValueError("Archive filename disagrees with its original identity")
    dot_name, issue, token = parsed
    identity = f"{dot_name}#{issue}"
    identity_hash = hashlib.sha256(identity.encode()).hexdigest()
    if (approval.get("binary_hash") != digest or
            approval.get("dot_name") != dot_name or approval.get("issue_n") != issue or
            approval.get("identity_hash") != identity_hash or
            compute_number(dot_name, raw) != token or entry.get("token") != token):
        raise ValueError("Archive content or issued identity disagrees with its evidence")
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError("Malformed archive words")
    header = int.from_bytes(raw[:4], "big")
    size = 1 << (((header >> 23) & 15) + 6)
    if header >> 27 != 31 or len(raw) != size * 4:
        raise ValueError("Malformed archive allocation")
    if 1 + ((header >> 10) & 8191) + (header & 255) > size:
        raise ValueError("Archive code and C-list exceed allocation")
    validate_execution(entry, raw)
    validate_execution(approval, raw)
    if entry.get("isa_profile") != approval.get("isa_profile"):
        raise ValueError("Archive execution profile disagrees with its evidence")
    return dict(ok=True, trusted=True, identity_verified=True, dot_name=dot_name,
                issue_n=issue, cache_token=token, binary_hash=digest,
                identity_hash=identity_hash)


def verify_pinned_references(capabilities, lumps_dir):
    evidence = []
    for row, cap in enumerate(capabilities):
        if row == 0 and cap.get("name", "").upper() in ("SELF", "__SELF__"):
            continue
        if not any(key in cap for key in
                   ("N", "T", "token", "binary_hash", "identity_hash", "identity_string")):
            continue  # Explicitly unpinned; never claim verified.
        name = cap.get("N") or cap.get("identity_string")
        token = cap.get("T") or cap.get("token")
        digest = cap.get("binary_hash")
        identity_hash = cap.get("identity_hash")
        prefix = f"C-list row {row} ({cap.get('name', '')})"
        if not all(isinstance(value, str) and value for value in
                   (name, token, digest, identity_hash)):
            raise ValueError(f"{prefix}: incomplete immutable reference")
        with open(os.path.join(lumps_dir, "manifest.json"), encoding="utf-8") as stream:
            manifest = json.load(stream)
        if not isinstance(manifest, list):
            raise ValueError(f"{prefix}: reference index is malformed")
        entries = [entry for entry in manifest if isinstance(entry, dict)
                   and entry.get("token") == token
                   and (entry.get("binary_hash") in (None, digest))
                   and (not entry.get("archived") or entry.get("binary_hash") == digest)]
        if len(entries) != 1:
            raise ValueError(f"{prefix}: exact reference is missing or ambiguous; no alternative selected")
        filename = entries[0].get("filename")
        if not isinstance(filename, str) or os.path.basename(filename) != filename:
            raise ValueError(f"{prefix}: unsafe reference filename")
        path = os.path.join(lumps_dir, filename)
        if os.path.islink(path):
            raise ValueError(f"{prefix}: symlink reference is not permitted")
        with open(path, "rb") as stream:
            raw = stream.read(32768 * 4 + 1)
        if len(raw) > 32768 * 4 or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError(f"{prefix}: exact target binary hash mismatch; no alternative selected")
        checked = (_verify_archive(lumps_dir, entries[0], raw)
                   if entries[0].get("archived")
                   else resolve_canonical_lump(lumps_dir, token, raw))
        actual_name = f"{checked.get('dot_name')}#{checked.get('issue_n')}"
        if not (checked.get("ok") and checked.get("trusted") and
                checked.get("identity_verified") and actual_name == name and
                checked.get("cache_token") == token and
                checked.get("binary_hash") == digest and
                checked.get("identity_hash") == identity_hash):
            raise ValueError(f"{prefix}: exact target identity could not be verified: "
                             f"{checked.get('error') or checked.get('reason') or 'identity mismatch'}")
        evidence.append({"row": row, "N": name, "T": token,
                         "binary_hash": digest, "identity_hash": identity_hash})
    return evidence