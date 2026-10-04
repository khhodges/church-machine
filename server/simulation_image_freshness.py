"""Read-only freshness evidence for an exact simulation image."""
import hashlib
import struct


def image_freshness(image, provenance, image_hash, state, manifest, compare, read_artifact):
    unknown = {"status": "unknown", "warnings": [],
               "reason": "The loaded image's artifact identity could not be verified."}
    if (hashlib.sha256(image).hexdigest() != image_hash
            or provenance.get("image_sha256") != image_hash
            or len(image) % 4):
        return unknown
    words = struct.unpack(f"<{len(image) // 4}I", image)
    bindings = provenance.get("artifactBindings")
    if not isinstance(bindings, list) or not bindings:
        return unknown
    rows = []
    try:
        for binding in bindings:
            slot = binding["slot"]
            if type(slot) is not int or slot < 0 or (slot + 1) * 4 > len(words):
                return unknown
            base = words[len(words) - (slot + 1) * 4]
            header = words[base]
            count = 1 << (((header >> 23) & 15) + 6)
            if header >> 27 != 31 or base + count > len(words):
                return unknown
            body = struct.pack(f">{count}I", *words[base:base + count])
            if hashlib.sha256(body).hexdigest() != binding.get("derivativeHash"):
                return unknown
            original = read_artifact(binding["filename"])
            if hashlib.sha256(original).hexdigest() != binding.get("binaryHash"):
                return unknown
            matches = [entry for entry in manifest
                       if entry.get("filename") == binding["filename"]]
            if not matches:
                return unknown
            artifact = matches[0]
            authority = words[len(words) - (slot + 1) * 4 + 1]
            # These are resident bodies proved by frozen image provenance.
            # No identity or policy fields come from mutable Namespace state.
            rows.append({"slot": slot, "seq": (authority >> 21) & 0x1ff,
                         "location": base, "limit": authority & 0x1fffff,
                         "resident": True, "boot_resident": True,
                         "type": "Inform", "load_policy": "Resident",
                         "ns_slot_policy": "static",
                         "name": artifact["abstraction"],
                         "filename": binding["filename"], "token": artifact["token"],
                         "binary_hash": binding["binaryHash"],
                         "lump_version": artifact.get("lump_version")})
    except (OSError, KeyError, IndexError, TypeError, ValueError, struct.error):
        return unknown
    result = compare({"abstractions": rows})
    return {**result, "imageHash": image_hash, "basis": "verified-image"}