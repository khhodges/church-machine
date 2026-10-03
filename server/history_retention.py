"""Conservative, deterministic archive retention; never use filesystem mtime."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import time


def recover_pending(root, write_json):
    """Complete deletion bookkeeping on an authorized write, never on a read.

    Caller holds the shared Namespace/history lock. Files still present are
    never deleted here; the normal policy and reference checks must run again.
    """
    root = Path(root)
    ledger_path = root / "history-retention.json"
    if not ledger_path.exists():
        return []
    ledger = json.loads(ledger_path.read_text())
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    recovered = []
    for entries in ledger.values():
        for entry in entries:
            if entry.get("status") != "pending":
                continue
            filename = entry["filename"]
            if Path(filename).name != filename or not filename.endswith(".lump"):
                raise ValueError("Unsafe pending retention filename")
            path = root / filename
            if path.is_symlink():
                raise ValueError("Pending retention artifact became a symlink")
            if path.exists():
                if hashlib.sha256(path.read_bytes()).hexdigest() != entry["binary_hash"]:
                    raise ValueError("Pending retention artifact changed; review required")
                continue
            if any(row.get("filename") == filename and row.get("archived") is not True
                   for row in manifest):
                raise ValueError("Missing pending archive is now a live locator; review required")
            manifest = [row for row in manifest if not (
                row.get("filename") == filename and row.get("archived") is True)]
            write_json(str(manifest_path), manifest)
            entry.update(status="deleted", deleted_at=time.time())
            write_json(str(ledger_path), ledger)
            recovered.append(filename)
    return recovered


def expired_archives(history, now):
    """Keep the three highest revision numbers (including ties), plus 30 days."""
    versions = sorted({int(row["version"]) for row in history}, reverse=True)
    newest = set(versions[:3])
    result = []
    for row in history:
        if row.get("current") or int(row["version"]) in newest:
            continue
        timestamp = row.get("compiled_at")
        try:
            if isinstance(timestamp, str):
                date = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                if date.tzinfo is None:
                    continue
                timestamp = date.timestamp()
            if isinstance(timestamp, bool) or timestamp is None:
                continue
            timestamp = float(timestamp)
            if not 0 < timestamp < now - 30 * 86400:
                continue
        except (ValueError, TypeError, OverflowError):
            continue
        filename = row.get("archive_filename") or row.get("record_filename")
        if filename:
            result.append(row)
    return result