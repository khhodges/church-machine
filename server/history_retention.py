"""Conservative, deterministic archive retention; never use filesystem mtime."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import time
import os
import tempfile

JOURNAL = ".history-retention-pending.json"
LEDGER = "history-retention.json"


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

def _sync_directory(root):
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def record_retention_intent(root, token, entry):
    durable_json(Path(root) / JOURNAL, {"token": token, "entry": entry})

def recover_retention(root):
    """Under the transition lock, finish evidence for an already unlinked file.

    A surviving file is never deleted by recovery: discard the intent and let
    the next authorized maintenance run recheck age, identity and references.
    Approvals and sidecars are deliberately retained.
    """
    root = Path(root)
    journal = root / JOURNAL
    if not journal.exists():
        return
    pending = json.loads(journal.read_text())
    row = pending["entry"]
    filename = row["filename"]
    if (Path(filename).name != filename or not filename.endswith(".lump")
            or not isinstance(pending["token"], str)):
        raise ValueError("Invalid retention recovery evidence")
    if not os.path.lexists(root / filename):
        manifest_path = root / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        if any(r.get("filename") == filename and r.get("archived") is not True
               for r in manifest):
            raise ValueError("Retention recovery conflicts with a live artifact")
        durable_json(manifest_path, [
            r for r in manifest
            if not (r.get("archived") is True and r.get("filename") == filename)
        ])
        ledger_path = root / LEDGER
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
        entries = ledger.setdefault(pending["token"], [])
        if row not in entries:
            entries.append(row)
        durable_json(ledger_path, ledger)
    journal.unlink()
    _sync_directory(root)

def durable_json(path, value):
    """Retention evidence must reach disk before an irreversible unlink."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def reference_documents(root, *, excluded=()):
    """Unlike rglob, surface unreadable directories rather than skip them."""
    documents = {}
    root = Path(root)
    if root.is_symlink():
        raise ValueError("Linked reference directory cannot be verified")
    try:
        root.stat()
    except FileNotFoundError:
        return documents

    def fail(error):
        raise error

    for directory, directories, names in os.walk(root, onerror=fail):
        if any((Path(directory) / name).is_symlink() for name in directories):
            raise ValueError("Linked reference directory cannot be verified")
        for name in names:
            if name.endswith(".json") and name not in excluded:
                path = Path(directory) / name
                documents[str(path)] = path.read_text(encoding="utf-8")
    return documents
