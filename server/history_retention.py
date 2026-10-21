"""Archive retention with explicit age evidence and conservative reference guards."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import time
import os
import tempfile

JOURNAL = ".history-retention-pending.json"
LEDGER = "history-retention.json"

def archive_references(root, *, frozen_root=None, reference_paths=()):
    """Collect all retention roots; approval registries are audit evidence."""
    root = Path(root)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    live = {row.get("filename") for row in manifest if row.get("archived") is not True}
    archived_metadata = {
        str((root / row["filename"]).with_suffix(".json"))
        for row in manifest if row.get("archived") is True
        and row.get("filename") and row["filename"] not in live}
    ledger_path = root / LEDGER
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text())
        if not isinstance(ledger, dict) or any(not isinstance(entries, list) for entries in ledger.values()):
            raise ValueError("Invalid archive deletion ledger")
        for entries in ledger.values():
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ValueError("Invalid archive deletion evidence")
                if entry.get("filename") and entry["filename"] not in live:
                    archived_metadata.add(str((root / entry["filename"]).with_suffix(".json")))
    documents = reference_documents(
        root, excluded=("manifest.json", "approvals.json", JOURNAL, LEDGER),
        excluded_directories=(".symbolic-bindings", ".binding-previews"))
    completed_candidates = {
        value.get("candidate_id") for name, text in documents.items()
        if Path(name).parent.name == "save-operations"
        and isinstance((value := json.loads(text)), dict)
        and value.get("outcome") == "committed"}
    for name, text in list(documents.items()):
        value = json.loads(text)
        path = Path(name)
        # Retained historical metadata is evidence, not an active selection.
        if name in archived_metadata:
            del documents[name]
        elif path.parent.name == "save-operations" and isinstance(value, dict) and "response" in value:
            del documents[name]
        elif path.parent.name == "save-candidates" and path.stem in completed_candidates:
            del documents[name]
        elif path.parent.name == "save-candidates" and isinstance(value, dict):
            # The candidate's own token identifies the proposed output, not an
            # input archive. Keep exact filenames/hashes and dependency tokens:
            # an unfinished plan may genuinely require those saved inputs.
            payload = value.get("payload")
            metadata = payload.get("metadata") if isinstance(payload, dict) else None
            if isinstance(metadata, dict):
                metadata.pop("token", None)
                documents[name] = json.dumps(value)
        elif ".image-refresh" in path.parts and isinstance(value, dict):
            expiry = value.get("expires")
            if value.get("status") == "committed" or (
                    isinstance(expiry, (int, float)) and expiry < time.time()):
                del documents[name]
    if frozen_root:
        documents.update(reference_documents(frozen_root, excluded=("approvals.json",)))
    for path in reference_paths:
        if path and Path(path).exists():
            documents[str(path)] = Path(path).read_text(encoding="utf-8")
    return {name: json.dumps(json.loads(text)) for name, text in documents.items()}


def archive_deletion_evidence(root, filename, manifest, documents, token):
    """Fail closed on aliases and saved references. Caller holds transition lock."""
    root = Path(root)
    path = root / filename
    if (path.name != filename or not filename.endswith(".lump") or
            path.is_symlink() or not path.is_file() or path.stat().st_nlink > 1):
        raise ValueError("Archive is missing or linked to another file")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    references = json.dumps([
        row for row in manifest if row.get("archived") is not True
    ]) + "".join(text for name, text in documents.items()
                if name != str(path.with_suffix(".json")))
    old_tokens = {
        str(row.get("token") or "").lower() for row in manifest
        if row.get("filename") == filename and row.get("archived") is True
    }
    linked = any(other.is_symlink() and other.resolve() == path.resolve()
                 for other in root.glob("*.lump"))
    if (linked or filename in references or digest in references.lower() or
            any(old and old != token.lower() and old in references.lower()
                for old in old_tokens)):
        raise ValueError("Archive is referenced by a live or saved artifact")
    return digest


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


def recorded_timestamp(value):
    try:
        if isinstance(value, str):
            date = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if date.tzinfo is None:
                return None
            value = date.timestamp()
        if isinstance(value, bool) or value is None:
            return None
        value = float(value)
        return value if 0 < value < float("inf") else None
    except (ValueError, TypeError, OverflowError):
        return None


def expired_archives(history, now, root=None):
    """Complete: 30 days/newest three. Incomplete: three days, mtime fallback."""
    versions = sorted({int(row["version"]) for row in history}, reverse=True)
    newest = set(versions[:3])
    result = []
    for row in history:
        if row.get("current"):
            continue
        timestamp = recorded_timestamp(row.get("compiled_at"))
        incomplete = (timestamp is None or not row.get("abstraction")
                      or not row.get("binary_hash") or row.get("metadata_only") is True)
        if not incomplete and int(row["version"]) in newest:
            continue
        filename = row.get("archive_filename") or row.get("record_filename")
        if not filename or Path(filename).name != filename:
            continue
        basis = "compiled_at"
        if timestamp is None and root is not None:
            path = Path(root) / filename
            if path.is_symlink():
                continue
            try:
                timestamp = path.stat().st_mtime
                basis = "file_mtime"
            except FileNotFoundError:
                continue
        days = 3 if incomplete else 30
        if timestamp is not None and 0 < timestamp < now - days * 86400:
            result.append({**row, "retention_evidence": {
                "days": days, "incomplete": incomplete, "age_basis": basis,
                "age_timestamp": timestamp,
            }})
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

def reference_documents(root, *, excluded=(), excluded_directories=()):
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
        directories[:] = [name for name in directories if name not in excluded_directories]
        if any((Path(directory) / name).is_symlink() for name in directories):
            raise ValueError("Linked reference directory cannot be verified")
        for name in names:
            if name.endswith(".json") and name not in excluded:
                path = Path(directory) / name
                documents[str(path)] = path.read_text(encoding="utf-8")
    return documents
