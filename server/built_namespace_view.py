"""Read-only projection of a committed image, never of a mutable catalog."""
import hashlib
import json
from pathlib import Path
from server.built_thread_view import inspect_threads


def _read_json(path):
    try:
        value = json.loads(Path(path).read_text())
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def read_built_namespace(image_path, provenance_path, state_path, parse_raw,
                         namespace_fingerprint):
    # Read once: every descriptor and the reported identity refer to these bytes.
    image = Path(image_path).read_bytes()
    if not image or len(image) % 4:
        raise ValueError("Committed image is empty or not word-aligned")
    raw = parse_raw(image)
    if not raw:
        raise ValueError("Committed image has no recognizable Namespace table")
    digest = hashlib.sha256(image).hexdigest()
    provenance = _read_json(provenance_path)
    verified = bool(provenance and provenance.get("image_sha256") == digest)
    bindings = {}
    if verified:
        records = provenance.get("resident_bindings")
        for item in records if isinstance(records, list) else []:
            if not isinstance(item, dict) or type(item.get("slot")) is not int:
                continue
            slot = item["slot"]
            # Ambiguous evidence supplies no display identity.
            bindings[slot] = None if slot in bindings else item
    built_fingerprint = provenance.get("namespace_fingerprint") if verified else None
    saved = _read_json(state_path)
    matches = None
    if built_fingerprint and saved and isinstance(saved.get("abstractions"), list):
        try:
            matches = namespace_fingerprint(saved["abstractions"]) == built_fingerprint
        except (ValueError, TypeError, KeyError):
            pass
    # Names are annotations only. The complete row fingerprint must match the
    # image-bound build record before saved labels can describe these bytes.
    saved_rows = {}
    if matches is True:
        for row in saved["abstractions"]:
            if not isinstance(row, dict) or type(row.get("slot")) is not int:
                continue
            slot = row["slot"]
            saved_rows[slot] = None if slot in saved_rows else row
    entries = []
    for entry in raw["entries"]:
        binding = bindings.get(entry["slot"]) or {}
        row = saved_rows.get(entry["slot"]) or {}
        name = row.get("name") or binding.get("name") or binding.get("abstraction")
        filename = binding.get("filename")
        # Device windows do not have a standalone file. Do not make this
        # assertion for unidentified entries or infer identity from slot numbers.
        device = (isinstance(row.get("name"), str)
                  and row["name"].endswith("_DEV")
                  and entry["w0"] >= 0x40000000)
        w1 = entry["w1"]
        entries.append({
            **entry,
            "name": name,
            "nameSource": ("matched-namespace" if row.get("name") else
                           "build-record" if name else None),
            "filename": filename,
            "artifactSha256": binding.get("artifact_sha256"),
            "artifactStatus": ("recorded" if filename else
                               "not-applicable" if device else "unavailable"),
            # Canonical NS W1: limit[20:0], sequence[29:21], G[30], F[31].
            # W3 is retained verbatim, not used to invent a type for W1.
            "decoded": {
                "location": entry["w0"], "limit": w1 & 0x1FFFFF,
                "sequence": (w1 >> 21) & 0x1FF,
                "g": (w1 >> 30) & 1, "f": (w1 >> 31) & 1,
                "seal": entry["w2"], "accessGt": entry["w3"],
            },
        })
    return {
        **raw,
        "entries": entries,
        "threads": inspect_threads(
            image, entries, raw.get("nsTableBase", len(image) // 4),
            provenance.get("thread_tuple_evidence") if verified else None),
        "imageSha256": digest,
        "bytes": len(image),
        "provenanceStatus": "verified" if verified else (
            "mismatch" if provenance else "missing"),
        "builtNamespaceFingerprint": built_fingerprint,
        "savedNamespaceMatchesBuilt": matches,
        "readOnly": True,
    }
