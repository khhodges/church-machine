"""Deterministic Namespace inputs, independent of the saved IDE library."""

import hashlib
import json
import struct

from server import boot_image


def artifact(name, slot, *, continuation=None, issue=1):
    """A 64-word Inform with frozen SELF and optional startup continuation."""
    caps = [0x4A000000 | slot]
    if continuation is not None:
        caps.append(0x4A000000 | continuation)
    words = [(0x1F << 27) | (1 << 10) | len(caps), 0x1F000000]
    words += [0] * (64 - len(words) - len(caps))
    raw = struct.pack(">64I", *words, *caps)
    digest = hashlib.sha256(raw).hexdigest()
    token = f"{caps[0]:08x}"
    filename = f"{name}.{issue}.{digest[:8]}.lump"
    record = {
        "filename": filename, "binary_hash": digest, "token": token,
        "abstraction": name, "dot_name": name, "issue_n": issue,
        "lump_version": issue,
    }
    approval = {
        "binary_hash": digest, "filename": filename, "dot_name": name,
        "issue_n": issue, "token": token,
        "bootstrap_t": token, "bootstrap_runtime_gt": caps[0],
    }
    return raw, record, approval


def create_namespace_inputs(root, config):
    """Create the whole physical profile, not a simulation-only approximation."""
    root.mkdir()
    rows = [
        {"slot": 0, "name": "Boot.NS", "type": "Namespace", "location": 0, "seq": 0},
        {"slot": 1, "name": "Boot.Thread", "type": "Thread", "location": 16, "seq": 0},
    ]
    for device in boot_image.architecture_device_catalog().values():
        rows.append({
            "slot": device["slot"], "name": device["name"], "type": "Device",
            "location": device["address"], "limit": device["limit"], "seq": 0,
        })
    manifest, approvals = [], {}
    # The compact layout is explicit: Thread [16,272), WukongCallHome
    # [272,336), CapabilityTest [336,400), SelfTest [400,464).
    for name, slot, location, continuation in (
        ("SelfTest", 6, 400, None),
        ("WukongCallHome", 7, 272, None),
        ("CapabilityTest", 10, 336, 7),
    ):
        raw, record, approval = artifact(
            name, slot, continuation=continuation,
            issue=3 if name == "CapabilityTest" else 1)
        (root / record["filename"]).write_bytes(raw)
        manifest.append(record)
        approvals[record["binary_hash"]] = approval
        rows.append({
            "name": name, "slot": slot, "type": "Inform", "location": location,
            "seq": 0, "filename": record["filename"], "token": record["token"],
            "binary_hash": record["binary_hash"], "issue_n": record["issue_n"],
            "resident": True, "boot_resident": True, "load_policy": "Resident",
            "ns_slot_policy": "static", "boot": slot == 10,
        })
    # Keep both an exact historical migration input and an unapproved candidate.
    raw, record, approval = artifact("CapabilityTest", 2, continuation=7, issue=2)
    (root / record["filename"]).write_bytes(raw)
    manifest.append({**record, "archived": True})
    approvals[record["binary_hash"]] = approval
    raw, record, _ = artifact("ide.Alice", 14)
    (root / record["filename"]).write_bytes(raw)
    manifest.append(record)
    (root / "manifest.json").write_text(json.dumps(manifest))
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": approvals,
    }))
    (root / "ns-state.json").write_text(json.dumps({
        "revision": 7, "abstractions": sorted(rows, key=lambda row: row["slot"]),
    }))
    image = boot_image.generate_boot_image(config, str(root), require_entry_resident=True)
    boot_image.validate_boot_image(image)
    (root / "boot-image.bin").write_bytes(image)
    # Descriptor fields are image projections, not fixture guesses. Placement
    # is checked separately before normalization so repacking is not concealed.
    words = struct.unpack(f"<{len(image) // 4}I", image)
    for row in rows:
        if row.get("filename"):
            base = len(words) - (row["slot"] + 1) * 4
            assert words[base] == row["location"]
            raw = (root / row["filename"]).read_bytes()
            expected = struct.unpack(f">{len(raw) // 4}I", raw)
            assert words[row["location"]:row["location"] + len(expected)] == expected
    from scripts.migrate_bootstrap_residents import (
        _synchronize_namespace_descriptors, _write_generated_provenance,
    )
    _synchronize_namespace_descriptors(root)
    _write_generated_provenance(root, image, config)
