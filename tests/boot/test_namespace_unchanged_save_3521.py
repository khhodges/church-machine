"""Task 3521 regressions for unchanged Namespace saves.

The boot-image builder owns physical placement.  A projection from older
Namespace state may consequently have different descriptor words, but that is
not an artifact replacement.  Once that projected snapshot is committed,
submitting it again through the real save endpoint must be idempotent.
"""

import base64
import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (
    generate_boot_image,
    integrity32,
    parse_ns_table,
    parse_ns_table_raw,
    read_boot_entry_info,
)


def _descriptor_rows(image, authority_rows):
    """Apply an image's physical descriptor projection to rich state rows."""
    projected = [dict(row) for row in authority_rows]
    by_slot = {row["slot"]: row for row in projected}
    for descriptor in parse_ns_table(image):
        row = by_slot[descriptor["slot"]]
        row.update({
            "location": f"0x{descriptor['location']:08X}",
            "f": descriptor["f"],
            "g": descriptor["g"],
            "limit": f"0x{descriptor['limit17']:05X}",
            "seq": descriptor["seq"],
            "seal": f"0x{descriptor['integrity32']:08X}",
        })
    return projected


def _artifact_and_selection_identity(rows):
    """Return identity fields that descriptor layout must never substitute."""
    return sorted(
        (
            row["slot"],
            row.get("filename"),
            row.get("binary_hash", row.get("binaryHash")),
            row.get("token"),
            row.get("seq"),
            row.get("boot") is True,
        )
        for row in rows
        if row.get("filename") is not None
        or row.get("binary_hash", row.get("binaryHash")) is not None
        or row.get("token") is not None
        or row.get("boot") is True
    )


def _namespace_fingerprint(app_module, rows):
    return app_module._namespace_state_fingerprint(rows)


def test_two_unchanged_namespace_saves_preserve_identity_and_projected_layout(
        tmp_path, isolated_boot_lumps, monkeypatch):
    """A real Save NS commit stores the snapshot; it does not rebuild it.

    All persistence inputs, including boot-config.json, live in this test's
    private directory.  The first candidate is the builder's normalized
    physical layout for the unchanged logical Namespace.  The second request
    submits exactly that committed image/state again.
    """
    import server.app as app_module

    private_dir = tmp_path / "runtime"
    private_lumps = private_dir / "lumps"
    shutil.copytree(isolated_boot_lumps, private_lumps)

    source_config_path = app_module.BOOT_CONFIG_PATH
    private_config_path = private_dir / "boot-config.json"
    shutil.copy2(source_config_path, private_config_path)
    config_before = private_config_path.read_bytes()
    config = json.loads(config_before)

    paths = {
        "LUMPS_DIR": str(private_lumps),
        "LUMPS_MANIFEST_PATH": str(private_lumps / "manifest.json"),
        "NS_STATE_PATH": str(private_lumps / "ns-state.json"),
        "BOOT_CONFIG_PATH": str(private_config_path),
        "BOOT_CONFIG_LEGACY_PATH": str(private_dir / "missing-legacy.json"),
        "BOOT_IMAGE_PATH": str(private_lumps / "boot-image.bin"),
        "BOOT_IMAGE_PROVENANCE_PATH": str(
            private_lumps / "boot-image.provenance.json"),
        "_LUMPS_DIR": str(private_lumps),
    }
    for name, value in paths.items():
        monkeypatch.setattr(app_module, name, value)

    state_path = private_lumps / "ns-state.json"
    initial_rows = json.loads(state_path.read_text(encoding="utf-8"))["abstractions"]
    selected_before = next(row for row in initial_rows if row.get("boot") is True)
    identity_before = _artifact_and_selection_identity(initial_rows)

    image = generate_boot_image(
        config, str(private_lumps),
        boot_entry_slot=selected_before["slot"])
    projected_rows = _descriptor_rows(image, initial_rows)

    # Physical placement is a builder-owned projection.  This fixture includes
    # historical descriptor geometry, so normalization is observable without
    # implying that a selected artifact was replaced.
    descriptor_keys = ("location", "limit", "seal")
    changed_descriptors = {
        row["slot"] for row in projected_rows
        if any(
            row.get(key) != next(
                old.get(key) for old in initial_rows
                if old["slot"] == row["slot"])
            for key in descriptor_keys
        )
    }
    assert changed_descriptors
    assert _artifact_and_selection_identity(projected_rows) == identity_before

    raw = parse_ns_table_raw(image)
    assert raw is not None
    for entry in raw["entries"]:
        assert entry["w2"] == integrity32(entry["w0"], entry["w1"])

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as client:
        first = client.post("/api/boot-image/save-ns", json={
            "data_b64": base64.b64encode(image).decode("ascii"),
            "ns_state": {"abstractions": projected_rows},
            "namespaceFingerprint": _namespace_fingerprint(
                app_module, initial_rows),
            "boot_config": None,
        })
        assert first.status_code == 200, first.get_json()
        assert (private_lumps / "boot-image.bin").read_bytes() == image
        first_rows = json.loads(
            state_path.read_text(encoding="utf-8"))["abstractions"]
        first_image_digest = hashlib.sha256(
            (private_lumps / "boot-image.bin").read_bytes()).hexdigest()

        second = client.post("/api/boot-image/save-ns", json={
            "data_b64": base64.b64encode(image).decode("ascii"),
            "ns_state": {"abstractions": first_rows},
            "namespaceFingerprint": _namespace_fingerprint(
                app_module, first_rows),
            "boot_config": None,
        })
        assert second.status_code == 200, second.get_json()

    second_rows = json.loads(
        state_path.read_text(encoding="utf-8"))["abstractions"]
    committed_image = (private_lumps / "boot-image.bin").read_bytes()

    assert second_rows == first_rows
    assert _artifact_and_selection_identity(first_rows) == identity_before
    assert _artifact_and_selection_identity(second_rows) == identity_before
    assert hashlib.sha256(committed_image).hexdigest() == first_image_digest
    assert committed_image == image
    assert read_boot_entry_info(committed_image)["entry_slot"] == (
        selected_before["slot"])
    assert private_config_path.read_bytes() == config_before