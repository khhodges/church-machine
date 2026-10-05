"""Read-only evidence checks for approvals whose historical bytes were deleted.

This is not artifact admission authority and never authorizes a deletion.
"""
import json
import math
import os
from pathlib import Path
import re


def _filename(value):
    return (isinstance(value, str) and value.endswith(".lump")
            and "/" not in value and "\\" not in value and "\0" not in value)


def _references(value, filename, digest):
    if isinstance(value, dict):
        return any(_references(k, filename, digest) or _references(v, filename, digest)
                   for k, v in value.items())
    if isinstance(value, list):
        return any(_references(v, filename, digest) for v in value)
    return isinstance(value, str) and (
        value == digest or value == filename or value.endswith("/" + filename))


def documented_approval_deletion(root, digest, approval, manifest):
    """Require exact completed evidence; never excuse a missing live selection.

    Legacy completed ledger entries omit status. They still require deleted_at,
    an absent filename, removed manifest row, and no outstanding journal.
    Malformed evidence raises ValueError instead of silently permitting absence.
    """
    root = Path(root)
    ledger_path = root / "history-retention.json"
    if not ledger_path.exists():
        return False
    if ledger_path.is_symlink():
        raise ValueError("Retention ledger must not be a symlink")
    ledger = json.loads(ledger_path.read_text())
    if not isinstance(ledger, dict):
        raise ValueError("Retention ledger must be an object")
    candidates = []
    pending_filename = False
    for token, rows in ledger.items():
        if not re.fullmatch(r"[0-9a-f]{8}", token) or not isinstance(rows, list):
            raise ValueError("Invalid retention ledger group")
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("Invalid retention entry")
            if (not _filename(row.get("filename"))
                    or not isinstance(row.get("binary_hash"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", row["binary_hash"])
                    or type(row.get("version")) is not int or row["version"] < 0):
                raise ValueError("Invalid retention identity")
            if row.get("status") == "pending":
                pending_filename |= row["filename"] == approval.get("filename")
                continue
            timestamp = row.get("deleted_at")
            if (row.get("status") not in (None, "deleted")
                    or type(timestamp) not in (int, float)
                    or not math.isfinite(timestamp) or timestamp <= 0):
                raise ValueError("Invalid retention completion")
            if row["filename"] == approval.get("filename") and row["binary_hash"] == digest:
                candidates.append((token, row))
    if (not candidates or pending_filename
            or os.path.lexists(root / ".history-retention-pending.json")):
        return False
    filename = approval.get("filename")
    if not _filename(filename) or os.path.lexists(root / filename):
        return False
    for row in manifest:
        if row.get("filename") == filename:
            return False
        if row.get("archived") is not True and _references(row, filename, digest):
            return False
    # Input inventories are historical provenance, not executable selections.
    # Do not ignore artifactBindings, boot selections, or Namespace descriptors.
    for name in ("ns-state.json", "boot-config.json", "boot-image.provenance.json"):
        path = root / name
        if path.exists():
            document = json.loads(path.read_text())
            if not isinstance(document, dict):
                raise ValueError(f"Invalid selection document: {name}")
            if name == "boot-image.provenance.json":
                document = {k: v for k, v in document.items()
                            if k not in ("inputs", "sourceInputs")}
            if _references(document, filename, digest):
                return False
    approval_token = approval.get("token", approval.get("bootstrap_t"))
    return any(approval_token is None or token == approval_token
               for token, _ in candidates)
