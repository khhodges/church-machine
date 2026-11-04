"""Read-only inventory: visibility is independent of executable approval."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def saved_slots(document):
    """Only saved fields; never enrich from today's Namespace or catalog."""
    for key in ("rows", "abstractions", "slot_rules"):
        if isinstance(document.get(key), list):
            return [row for row in document[key] if isinstance(row, dict)]
    ns_map = document.get("ns_map")
    if isinstance(ns_map, dict):
        if isinstance(ns_map.get("slot_rules"), list):
            return saved_slots(ns_map)
        tiers = ns_map.get("tiers") or {}
        return [row for key in ("bootstrap", "resident", "lazy", "unused")
                for row in tiers.get(key, []) if isinstance(row, dict)]
    return None


def catalog(records, snapshots, namespace_path):
    entries = []
    known = set()

    def saved_file(path, name, kind, **extra):
        raw = path.read_bytes()
        identity = hashlib.sha256(raw).hexdigest()
        entry = dict(id=f"{kind}:{identity}", revision_id=identity, name=name,
                     saved_at=datetime.fromtimestamp(
                         path.stat().st_mtime, timezone.utc).isoformat(),
                     approval="Not approved", testing="Not tested",
                     preparation="Needs preparation", **extra)
        try:
            document = json.loads(raw)
            if not isinstance(document, dict):
                raise ValueError("Expected a saved object")
        except (ValueError, UnicodeError) as error:
            entry["preparation"] = f"Unreadable saved data: {error}"
            document = {}
        entry["slots"] = saved_slots(document)
        entries.append(entry)
        return entry, document

    for record in records:
        metadata = record.get("metadata") or {}
        snapshot = metadata.get("snapshot") or {}
        provenance = snapshot.get("provenance") or {}
        revision = record["revision_id"]
        known.add(revision)
        retained_path = Path(snapshots) / "revisions" / "namespace" / revision / "revision.json"
        saved_at = provenance.get("approval_frozen_at") or metadata.get("created_at") or ""
        if not saved_at and retained_path.is_file():
            saved_at = datetime.fromtimestamp(retained_path.stat().st_mtime, timezone.utc).isoformat()
        slots = None
        if "namespace.json" in record.get("files", {}):
            namespace_file = retained_path.parent / "namespace.json"
            raw = namespace_file.read_bytes()
            if hashlib.sha256(raw).hexdigest() != record["files"]["namespace.json"]:
                raise ValueError("Retained Namespace bytes changed; refresh before inspection")
            slots = saved_slots(json.loads(raw))
        entries.append(dict(
            id=revision, revision_id=revision,
            slots=slots,
            name=metadata.get("name") or metadata.get("purpose") or "Namespace build",
            saved_at=saved_at,
            approval=metadata.get("approval_state") or "Not approved",
            testing=metadata.get("test_status") or "Not tested",
            preparation=("Image retained" if "boot-image.bin" in record.get("files", {})
                         else "Simulation image retained — hardware preparation required"
                         if "simulation.bin" in record.get("files", {}) else "Needs preparation")))

    for path in Path(snapshots).glob("build-approval-*.json"):
        entry, document = saved_file(path, path.stem, "snapshot")
        if document.get("namespace_revision_id") in known:
            entries.remove(entry)
            continue
        entry["testing"] = "Not tested"
        if document.get("all_checks_pass") is False:
            entry["preparation"] = "Preparation checks failed"
        entry["approval"] = "Legacy snapshot — approval unverified"

    root = Path(namespace_path).parent / "design-drafts"
    paths = [(Path(namespace_path), "Original", {})]
    paths += [(root / "ascending-v1.json", "New Layout", {}),
              (root / "phase1.json", "Phase 1", {})]
    for path in sorted((root / "copies").glob("*/design.json")):
        name = f"Saved copy {path.parent.name}"
        try:
            name = json.loads((path.parent / "metadata.json").read_text()).get("name") or name
        except (OSError, ValueError):
            pass
        paths.append((path, name, {}))
    for path, name, extra in paths:
        if path.is_file():
            saved_file(path, name, "design", **extra)

    # Compact historical timestamps and ISO timestamps must sort together.
    def date_key(entry):
        digits = "".join(c for c in str(entry["saved_at"]) if c.isdigit())
        return digits[:14].ljust(14, "0"), entry["id"]
    return sorted(entries, key=date_key, reverse=True)
