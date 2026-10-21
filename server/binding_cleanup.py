"""Delete unreachable derived bindings on authorized writes, never on GET."""
import contextlib
import fcntl
import functools
import inspect
import json
from pathlib import Path
import re
import threading
import tempfile
import hashlib

_mutex = threading.RLock()
_local = threading.local()


@contextlib.contextmanager
def binding_lock(root):
    root = Path(root)
    with _mutex:
        held = getattr(_local, "held", set())
        key = str(root.resolve())
        if key in held:
            yield
            return
        lock_path = Path(tempfile.gettempdir()) / (
            "binding-cleanup-" + hashlib.sha256(key.encode()).hexdigest() + ".lock")
        with lock_path.open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            _local.held = held | {key}
            try:
                yield
            finally:
                _local.held = held


def serialized(parameter):
    def decorate(fn):
        signature = inspect.signature(fn)
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            root = signature.bind(*args, **kwargs).arguments[parameter]
            if parameter == "self":
                root = root.lumps
            with binding_lock(root):
                return fn(*args, **kwargs)
        return wrapped
    return decorate


def cleanup_bindings(root, *, reference_paths=(), frozen_root=None, dry_run=False):
    """Mark exact saved-design keys and explicit references before sweeping.

    Prepared/running images contain their own bytes. Snapshot readers and
    writers share this lock, so an in-flight load completes before deletion.
    Invalid legacy selections cannot consume snapshots; prepared images retain
    their own exact bytes and explicitly recorded keys remain protected.
    """
    from server.history_retention import archive_references
    from server.namespace_binding_report import binding_report
    from server.namespace_design_v1 import FORMAT, PHASE1_FORMAT, digest
    from server.simulation_preparation import artifact_bindings, symbolic_snapshot_key

    root = Path(root)
    with binding_lock(root):
        documents = archive_references(
            root, reference_paths=reference_paths, frozen_root=frozen_root)
        keys = set()
        def visit(value):
            if isinstance(value, dict):
                if value.get("format") in (FORMAT, PHASE1_FORMAT):
                    report = binding_report(value, root, digest(value), bind_now=False)
                    keys.update(item["snapshotKey"] for item in report["lists"]
                                if item.get("snapshotKey"))
                # Legacy executable Namespace uses the same symbolic key.
                if isinstance(value.get("abstractions"), list):
                    rows = value["abstractions"]
                    try:
                        selected = artifact_bindings(rows, root)
                    except (ValueError, KeyError, FileNotFoundError):
                        selected = []  # This document cannot load a binding.
                    for binding in selected:
                        if (binding.get("portableBinding") or {}).get("schema") == "church.symbolic-lump-binding/v1":
                            keys.add(symbolic_snapshot_key(binding, rows, selected))
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        for text in documents.values():
            visit(json.loads(text))
            keys.update(re.findall(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])", text))
        candidates = []
        for name in (".symbolic-bindings", ".binding-previews"):
            folder = root / name
            if folder.is_symlink():
                raise ValueError("Binding cleanup refused a linked snapshot directory")
            for path in folder.glob("*.json"):
                if (re.fullmatch(r"[0-9a-f]{64}", path.stem)
                        and path.stem not in keys
                        and not path.is_symlink() and path.stat().st_nlink == 1):
                    candidates.append(path)
        deleted = []
        for path in candidates:
            if not dry_run:
                try:
                    path.unlink()
                except OSError as exc:
                    return dict(ok=False, deleted=deleted, reason=str(exc), dryRun=False)
            deleted.append(str(path.relative_to(root)))
        return dict(ok=True, deleted=deleted, dryRun=dry_run)
