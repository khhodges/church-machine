"""Read-only next-build sizing; never adopts selections into saved designs.

Resolve latest verified saved compilations, not diagnostic fixtures or guessed
sizes. Runtime extents omit the editing source frame using the same sizing rule
as the Namespace projector. These are planning bytes, not an executable image.
"""
import copy
import hashlib
import json
from pathlib import Path

from server.namespace_design_v1 import api_size
from server.development_image_view import add_lump_geometry


def resolve_layout(backend, inspection, document):
    """Use the Namespace allocator itself, not browser-invented placements."""
    from server.namespace_design_v1 import project
    from server.development_image_view import normalize_rows
    result = resolve_inspection(backend, inspection)
    resolved = {r["slot"]: r for r in result["layoutRows"]}
    draft = copy.deepcopy(document)
    for row in draft["rows"]:
        if row["kind"] == "lump":
            row["selection"] = resolved[row["slot"]].get("selection")
    projection = project(draft, Path(backend.LUMPS_DIR))
    for allocation in normalize_rows(projection["rows"]):
        row = resolved[allocation["slot"]]
        row.update(location=allocation["location"],
                   allocationWords=allocation["allocationWords"])
        if allocation.get("limit") is not None:
            row["limit"] = allocation["limit"]
    result["layoutResolved"] = True
    result["planningNote"] = (
        "Latest verified saved LUMPs projected through the Namespace allocator. "
        "Missing resident allocations prevent a complete bitstream layout. "
        "These are proposed addresses, not an installed or prepared image.")
    return result


def resolve_lump(backend, name, manifest):
    candidates = [r for r in manifest if isinstance(r, dict) and r.get("abstraction") == name]
    if not candidates:
        raise ValueError(f"No saved compilation exists for {name}. Implement and save this LUMP, then refresh the plan.")
    newest = max(int(r.get("lump_version") or 0) for r in candidates)
    latest = [r for r in candidates if int(r.get("lump_version") or 0) == newest]
    if len({r.get("filename") for r in latest}) != 1:
        raise ValueError(f"Newest revision of {name} is ambiguous. Correct the library selection, then refresh.")
    try:
        record, inspected = backend._latest_primary_compilation(name, include_system_managed=True)
    except LookupError as exc:
        raise ValueError(f"{name}: no verified saved compilation is available. Compile and save a valid revision, then refresh.") from exc
    if int(record.get("lump_version") or 0) != newest:
        raise ValueError(f"Newest revision of {name} failed verification. Recompile and save it; no older copy was substituted.")
    filename = record["filename"]
    if not isinstance(filename, str) or Path(filename).name != filename or "\\" in filename:
        raise ValueError(f"{name}: invalid artifact filename.")
    selected = dict(filename=filename, revision=newest, token=record.get("token"),
                    binaryHash=inspected["binary_hash"])
    row = dict(kind="lump", name=name, selection=selected)
    words, warning = api_size(row, Path(backend.LUMPS_DIR))
    if warning:
        raise ValueError(warning)
    add_lump_geometry([row], backend.LUMPS_DIR)
    if row.get("geometry") is None:
        raise ValueError(f"{name}: exact binary geometry failed validation. Recompile and save the LUMP.")
    return dict(selection=selected, geometry=row["geometry"], plannedWords=words,
                resolutionSource="latest-verified-compilation")


def resolve_inspection(backend, inspection):
    """Return a separate planning projection and preserve original saved rows."""
    result = copy.deepcopy(inspection)
    path = Path(backend.LUMPS_DIR) / "manifest.json"
    manifest_bytes = path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, list):
        raise ValueError("LUMP library manifest is invalid; nothing was changed.")
    cache, errors = {}, []
    rows = result.get("layoutRows", result["rows"])
    for row in rows:
        if row["kind"] != "lump":
            continue
        name = row["name"]
        if name not in cache:
            try:
                cache[name] = resolve_lump(backend, name, manifest)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                cache[name] = dict(resolutionError=str(exc))
        resolved = copy.deepcopy(cache[name])
        row.update(location=None, allocationWords=None, plannedWords=None,
                   geometry=None, selection=None, unresolved=True)
        # Do not expose stale saved filenames as the resolved planning identity.
        for key in ("filename", "lump_version", "token", "limit"):
            row.pop(key, None)
        row.update(resolved)
        if row.get("resolutionError"):
            errors.append(f"Slot {row['slot']} {name}: {row['resolutionError']}")
        else:
            row["unresolved"] = False
            if (row.get("policy") or row.get("load_policy")) not in ("Lazy", "Empty"):
                row["allocationWords"] = row["plannedWords"]
    if path.read_bytes() != manifest_bytes:
        raise ValueError("LUMP library changed during resolution. Refresh the plan; nothing was changed.")
    result.update(planning=True, planningSource="latest-verified-compilation",
                  planningManifestSha256=hashlib.sha256(manifest_bytes).hexdigest(),
                  layoutRows=rows, warnings=errors, image=None, imageSha256=None,
                  imageBytes=None, readOnly=True, bindingsChanged=False,
                  hardwareError="Planning only: no executable image was generated or installed.",
                  planningNote="Latest verified saved binary sizes; compilation and binding can change the final image. "
                               "Runtime words exclude editing source; binary words include it.")
    return result
