"""Read-only handoff for the separate development-image artifact.

Never binds, regenerates, activates or queues hardware commands. Only retained
hardware revisions can be handed to the existing authenticated UART installer.
"""
import hashlib
import json
import re
from pathlib import Path

from flask import jsonify, request, send_from_directory, redirect

from server.saved_namespace_catalog import catalog, saved_slots


def integer(value):
    if type(value) is int:
        return value
    if isinstance(value, str):
        try:
            return int(value, 16 if value.lower().startswith("0x") else 10)
        except ValueError:
            pass
    return None


def normalize_rows(rows):
    """Expose saved geometry without projection or catalog substitution."""
    normalized = []
    for original in rows:
        row = dict(original)
        name = row.get("name", "")
        kind = row.get("kind")
        if not kind:
            kind = ("namespace" if name == "Boot.NS" else
                    "thread" if name.startswith(("Boot.Thread", "Thread.")) else
                    "mmio" if name.endswith("_DEV") else "lump")
        start = integer(row.get("location", row.get("address")))
        limit = integer(row.get("limit"))
        # Namespace descriptors express an inclusive last-word offset.
        words = limit + 1 if limit is not None and limit >= 0 else None
        row.update(kind=kind, location=start, allocationWords=words,
                   policy=row.get("policy", row.get("load_policy",
                       "Hardware" if kind == "mmio" else
                       "Resident" if row.get("resident") is True else None)))
        normalized.append(row)
    return normalized


def retained_document(backend, identifier, record):
    store = backend._artifact_revision_store()
    if record:
        if "namespace.json" not in record.get("files", {}):
            raise ValueError("This retained revision has no Namespace table. No other table was substituted.")
        path = Path(store.file_path("namespace", identifier, "namespace.json"))
        return json.loads(path.read_bytes())
    root = Path(backend.NS_STATE_PATH).parent / "design-drafts"
    paths = [Path(backend.NS_STATE_PATH), root / "ascending-v1.json", root / "phase1.json"]
    paths.extend(sorted((root / "copies").glob("*/design.json")))
    for path in paths:
        if path.is_file():
            raw = path.read_bytes()
            if identifier == "design:" + hashlib.sha256(raw).hexdigest():
                return json.loads(raw)
    for path in sorted(Path(backend._BUILD_SNAPSHOTS_DIR).glob("build-approval-*.json")):
        raw = path.read_bytes()
        if identifier == "snapshot:" + hashlib.sha256(raw).hexdigest():
            return json.loads(raw)
    raise ValueError("Saved Namespace changed or is unavailable. Reload the Namespace list; nothing was changed.")


def inventory(backend):
    store = backend._artifact_revision_store()
    records, warnings = [], []
    parent = Path(store.root) / "namespace"
    for path in sorted(parent.glob("*/revision.json")):
        if not re.fullmatch("[0-9a-f]{64}", path.parent.name):
            continue
        try:
            records.append(store.read("namespace", path.parent.name))
        except (OSError, ValueError, KeyError) as error:
            warnings.append(f"Retained revision {path.parent.name[:12]}: {error}")
    # The shared catalog includes the named saved designs, not current drafts.
    entries = catalog(records, backend._BUILD_SNAPSHOTS_DIR, backend.NS_STATE_PATH)
    return entries, {r["revision_id"]: r for r in records}, warnings


def inspect(backend, identifier):
    entries, records, warnings = inventory(backend)
    entry = next((item for item in entries if item["id"] == identifier), None)
    if entry is None:
        raise ValueError("Selected Namespace is no longer available. Reload the list; no replacement was selected.")
    record = records.get(identifier)
    document = retained_document(backend, identifier, record)
    rows = saved_slots(document)
    if rows is None:
        raise ValueError("Selected Namespace has no saved slot table.")
    rows = normalize_rows(rows)
    layout_rows = rows
    layout_source = "saved-locations"
    from server.namespace_design_v1 import FORMAT, PHASE1_FORMAT, project
    if not record and document.get("format") in (FORMAT, PHASE1_FORMAT):
        # Same read-only allocation calculation as Namespace Table. This reads
        # exact hash-pinned selections; it does not link or create binding bytes.
        layout = project(document, Path(backend.NS_STATE_PATH).parent)
        layout_rows = normalize_rows(layout["rows"])
        layout_source = "saved-design-layout"
        warnings.extend(layout["warnings"])
    capacity = integer(document.get("capacityWords"))
    image = None
    if record and "boot-image.bin" in record.get("files", {}):
        image = Path(backend._artifact_revision_store().file_path(
            "namespace", identifier, "boot-image.bin")).read_bytes()
        capacity = len(image) // 4
    # Original has no explicit capacity; the current retained image is not
    # adopted as its identity. A reference scale is labelled as such.
    capacity_source = "saved-image" if image is not None else "saved-table" if capacity else "reference"
    hardware_error = ("No retained hardware-ready binary is attached to this exact saved selection. "
                      "Open the existing Namespace image workflow to prepare or select its retained build. "
                      "Existing bindings were not changed.")
    prepared = None
    if record:
        try:
            backend._require_hardware_namespace_revision(record)
            from server.uart_profile_install import prepare_image
            raw, _config = backend._approved_namespace_upload_source(identifier)
            prepared = prepare_image(raw)
            prepared["namespace_revision_id"] = identifier
            hardware_error = None
        except (OSError, ValueError, KeyError) as error:
            hardware_error = str(error)
    for row in layout_rows:
        start, words = row["location"], row["allocationWords"]
        if row["kind"] != "mmio" and start is not None and words is not None:
            if start < 0 or start + words > (capacity or 16384):
                warnings.append(f"Slot {row['slot']} ({row.get('name')}): saved allocation is outside the displayed address space.")
    return dict(ok=True, id=identifier, name=entry["name"], rows=rows,
                layoutRows=layout_rows, layoutSource=layout_source,
                fingerprint=entry["revision_id"], capacityWords=capacity or 16384,
                capacitySource=capacity_source, image=prepared,
                imageSha256=hashlib.sha256(image).hexdigest() if image is not None else None,
                imageBytes=len(image) if image is not None else None,
                hardwareError=hardware_error, warnings=warnings,
                metadata={k: v for k, v in document.items()
                          if k not in ("rows", "abstractions")},
                readOnly=True, bindingsChanged=False)


def register(app, backend):
    @app.get("/api/development-image/open")
    def development_image_open():
        try:
            with backend._namespace_commit_guard():
                profile = request.args.get("profile", "")
                identifier = request.args.get("design", "")
                if profile == "legacy" and not identifier:
                    path = Path(backend.NS_STATE_PATH)
                else:
                    from server.namespace_design_copies import resolve_store
                    store = resolve_store(profile, identifier,
                                          Path(backend.NS_STATE_PATH).parent,
                                          Path(backend.NS_STATE_PATH))
                    path = store.path
                raw = path.read_bytes()
                if profile != "legacy":
                    from server.namespace_design_v1 import digest
                    if request.args.get("fingerprint") != digest(json.loads(raw)):
                        raise ValueError("The saved Namespace changed. Reload its Namespace page before opening Prepare & Load. Nothing was changed.")
                identity = "design:" + hashlib.sha256(raw).hexdigest()
            response = redirect("/development-image/?namespace=" + identity)
        except (OSError, ValueError, KeyError, TypeError) as error:
            response = jsonify(ok=False, error=str(error), dataChanged=False)
            response.status_code = 409
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/development-image/catalog")
    def development_image_catalog():
        try:
            with backend._namespace_commit_guard():
                entries, _records, warnings = inventory(backend)
            response = jsonify(ok=True, entries=[
                {k: item.get(k) for k in ("id", "name", "saved_at", "preparation")}
                for item in entries], warnings=warnings)
        except (OSError, ValueError, KeyError, TypeError) as error:
            response = jsonify(ok=False, error=str(error), dataChanged=False)
            response.status_code = 409
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/development-image/inspect")
    def development_image_inspect():
        try:
            with backend._namespace_commit_guard():
                result = inspect(backend, request.args.get("id", ""))
            response = jsonify(result)
        except (OSError, ValueError, KeyError, TypeError) as error:
            response = jsonify(ok=False, error=str(error), dataChanged=False)
            response.status_code = 409
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/development-image/prepare")
    def development_image_prepare():
        # Offline, memory-only assembly. No queue or persisted artifact is written.
        from server.development_image_prepare import build_saved_design
        data = request.get_json(silent=True)
        try:
            if not isinstance(data, dict) or set(data) != {"id"} or not re.fullmatch(
                    r"design:[0-9a-f]{64}", str(data.get("id", ""))):
                raise ValueError("Select an exact saved Namespace design.")
            _raw, prepared = build_saved_design(backend, data["id"])
            response = jsonify(prepared)
        except (OSError, ValueError, KeyError, TypeError) as error:
            response = jsonify(ok=False, error=str(error), dataChanged=False, queued=False)
            response.status_code = 409
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/development-image/")
    @app.get("/development-image/<path:asset>")
    def development_image_static(asset="index.html"):
        root = Path(backend.__file__).resolve().parents[1] / "artifacts/development-image/dist/public"
        return send_from_directory(root, asset)
