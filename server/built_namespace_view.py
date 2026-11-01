"""Read-only projection of a committed image, never of a mutable catalog."""
import hashlib
import json
from pathlib import Path


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
    entries = []
    for entry in raw["entries"]:
        binding = bindings.get(entry["slot"]) or {}
        entries.append({
            **entry,
            "name": binding.get("name") or binding.get("abstraction"),
            "filename": binding.get("filename"),
            "artifactSha256": binding.get("artifact_sha256"),
        })
    built_fingerprint = provenance.get("namespace_fingerprint") if verified else None
    saved = _read_json(state_path)
    matches = None
    if built_fingerprint and saved and isinstance(saved.get("abstractions"), list):
        try:
            matches = namespace_fingerprint(saved["abstractions"]) == built_fingerprint
        except (ValueError, TypeError, KeyError):
            pass
    return {
        **raw,
        "entries": entries,
        "imageSha256": digest,
        "bytes": len(image),
        "provenanceStatus": "verified" if verified else (
            "mismatch" if provenance else "missing"),
        "builtNamespaceFingerprint": built_fingerprint,
        "savedNamespaceMatchesBuilt": matches,
        "readOnly": True,
    }
