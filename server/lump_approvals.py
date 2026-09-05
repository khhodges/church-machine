"""Dependency-free canonical LUMP approval-ledger contract."""
import json
import os
import re
import tempfile

VERSION = 1
ALGORITHM = "sha256"
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
RECORD_FIELDS = frozenset({
    "binary_hash", "filename", "dot_name", "issue_n", "identity_hash", "token",
    "abstraction", "author", "version", "compiled_at", "display_name",
    "documentation", "annotations", "portable_binding", "pet_name", "pet_names",
    "history_note", "release_notes", "grants", "capability_type",
})
INTRINSIC_FIELDS = frozenset({
    "cw", "cc", "typ", "lump_size", "source", "api_definition",
    "sourceStorageTier", "binary", "clist_entries", "methods", "capabilities",
    "content_type", "profile", "language",
})


def validate_record(digest, record):
    if not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest):
        raise ValueError("approval digest must be lowercase SHA-256")
    if not isinstance(record, dict) or record.get("binary_hash") != digest:
        raise ValueError("approval record must be bound to its digest key")
    unknown = set(record) - RECORD_FIELDS
    if unknown:
        raise ValueError(f"approval record contains unsupported fields: {sorted(unknown)}")
    return dict(record)


def validate_envelope(value):
    if (not isinstance(value, dict) or value.get("version") != VERSION
            or value.get("algorithm") != ALGORITHM
            or not isinstance(value.get("approvals"), dict)
            or set(value) != {"version", "algorithm", "approvals"}):
        raise ValueError("approval ledger must use the strict version-1 sha256 envelope")
    return {digest: validate_record(digest, record)
            for digest, record in value["approvals"].items()}


def read_approvals(path, missing_ok=True):
    try:
        with open(path, encoding="utf-8") as source:
            return validate_envelope(json.load(source))
    except FileNotFoundError:
        if missing_ok:
            return {}
        raise


def envelope(records):
    checked = {digest: validate_record(digest, record)
               for digest, record in records.items()}
    return {"version": VERSION, "algorithm": ALGORITHM, "approvals": checked}


def write_approvals(path, records):
    value = envelope(records)
    directory = os.path.dirname(path) or "."
    fd, temporary = tempfile.mkstemp(prefix=".approvals.", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)