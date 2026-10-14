"""Task 3521 regressions for unchanged Namespace saves.

The boot-image builder owns physical placement.  A projection from older
Namespace state may consequently have different descriptor words, but that is
not an artifact replacement.  Once that projected snapshot is committed,
submitting it again through the real save endpoint must be idempotent.
"""

import base64
import hashlib
import inspect
import json
import os
import shutil
import sys
from pathlib import Path
import pytest

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


def _confirmed_post(client, path, **kwargs):
    response = client.post(path, **kwargs)
    assert response.status_code == 428, response.get_json()
    confirmation = response.get_json()["change_confirmation"]["id"]
    return client.post(path, headers={"X-Change-Confirmation": confirmation},
                       **kwargs)


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
    hook = next(h for h in app_module.app.before_request_funcs[None]
                if h.__name__ == "review")
    store = inspect.getclosurevars(hook).nonlocals["store"]
    private_store = type(store)(tmp_path / "reviews.sqlite")
    monkeypatch.setattr(store, "path", private_store.path)

    state_path = private_lumps / "ns-state.json"
    fixture_state = json.loads(state_path.read_text(encoding="utf-8"))
    # The shared fixture adds a non-image Step2 allocation for unrelated
    # tests. Approval fixtures must describe exactly the image's occupants.
    fixture_state["abstractions"] = [
        row for row in fixture_state["abstractions"]
        if row.get("name") != "Step2Fixture"
    ]
    state_path.write_text(json.dumps(fixture_state))
    initial_rows = fixture_state["abstractions"]
    selected_before = next(row for row in initial_rows if row.get("boot") is True)
    identity_before = _artifact_and_selection_identity(initial_rows)

    image = generate_boot_image(
        config, str(private_lumps),
        boot_entry_slot=selected_before["slot"])
    projected_rows = _descriptor_rows(image, initial_rows)

    # A normalized live fixture may already match the generated descriptors.
    # The contract below is exact identity and byte preservation across saves,
    # not a requirement that every input first undergo relocation.
    assert _artifact_and_selection_identity(projected_rows) == identity_before

    raw = parse_ns_table_raw(image)
    assert raw is not None
    for entry in raw["entries"]:
        assert entry["w2"] == integrity32(entry["w0"], entry["w1"])

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as client:
        first = _confirmed_post(client, "/api/boot-image/save-ns", json={
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

        second = _confirmed_post(client, "/api/boot-image/save-ns", json={
            "data_b64": base64.b64encode(image).decode("ascii"),
            "ns_state": {"abstractions": first_rows},
            "namespaceFingerprint": _namespace_fingerprint(
                app_module, first_rows),
            "boot_config": None,
        })
        assert second.status_code == 200, second.get_json()
        saved_state = json.loads(state_path.read_text(encoding="utf-8"))
        assert saved_state["committed_raw_fingerprint"] == (
            app_module._raw_namespace_fingerprint(parse_ns_table_raw(image)))

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

    # Prepare/Run must retain the same binding that Save NS establishes.
    # Exercise the real confirmation hook, staging, publication, and capture.
    monkeypatch.setattr(app_module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(app_module, "_load_boot_ns_lump", lambda: None)
    with app_module.app.test_client() as client:
        prepared = _confirmed_post(client, "/api/boot-image/generate", json={
            "prepareRun": True,
            "namespaceFingerprint": _namespace_fingerprint(
                app_module, second_rows),
        })
    assert prepared.status_code == 200, prepared.get_json()
    prepared_bytes = (private_lumps / "boot-image.bin").read_bytes()
    prepared_state = json.loads(state_path.read_text())
    binding = app_module._raw_namespace_fingerprint(
        parse_ns_table_raw(prepared_bytes))
    assert prepared_state["committed_raw_fingerprint"] == binding
    assert _artifact_and_selection_identity(
        prepared_state["abstractions"]) == identity_before
    captured = app_module._capture_committed_namespace_snapshot()
    assert captured["provenance"]["committed_raw_fingerprint"] == binding
    provenance = json.loads(
        (private_lumps / "boot-image.provenance.json").read_text())
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(
        state_path.read_bytes()).hexdigest()

    # Supply private, hash-bound elaboration fixtures (not release evidence)
    # and exercise real immutable revision publication after preparation.
    fpga_paths = {}
    for key, name in (
            ("verilog", "church_wukong_xc7a100t.v"),
            ("rtlil", "church_wukong_xc7a100t.il"),
            ("xdc", "wukong_xc7a100t.xdc"),
            ("tcl", "wukong_xc7a100t.tcl")):
        path = private_dir / name
        path.write_bytes(("fixture-" + key).encode())
        fpga_paths[key] = str(path)
    digests = {
        os.path.basename(path): hashlib.sha256(Path(path).read_bytes()).hexdigest()
        for path in fpga_paths.values()
    }
    (private_dir / "church_wukong_xc7a100t.provenance.json").write_text(
        json.dumps({
            "schema_version": 1, "source_tree_clean": True,
            "source_commit": "a" * 40,
            "boot_inputs_sha256": {
                "server/lumps/boot-image.bin": hashlib.sha256(prepared_bytes).hexdigest()},
            "artifacts": {name: {"sha256": digest}
                          for name, digest in digests.items()},
            "input_files_sha256": {
                "hardware/" + name: digest for name, digest in digests.items()},
        }))
    monkeypatch.setattr(app_module, "_fpga_paths",
                        lambda _: (fpga_paths, None, None, None, None))
    monkeypatch.setattr(app_module, "_git_full_head", lambda: "a" * 40)
    monkeypatch.setattr(app_module, "_BUILD_SNAPSHOTS_DIR",
                        str(private_dir / "snapshots"))
    revision, frozen = app_module._freeze_namespace_revision("binding-regression")
    record = app_module._artifact_revision_store().read("namespace", revision)
    assert frozen["fingerprint"] == captured["fingerprint"]
    assert record["files"]["boot-image.bin"] == hashlib.sha256(prepared_bytes).hexdigest()
    assert record["files"]["namespace.json"] == hashlib.sha256(
        json.dumps(prepared_state, sort_keys=True).encode()).hexdigest()

    # Missing or stale binding must still fail closed; never repair at freeze.
    for invalid_binding in (None, "0" * 64):
        invalid = dict(prepared_state)
        if invalid_binding is None:
            invalid.pop("committed_raw_fingerprint")
        else:
            invalid["committed_raw_fingerprint"] = invalid_binding
        state_path.write_text(json.dumps(invalid))
        before_rejection = state_path.read_bytes()
        with pytest.raises(ValueError, match="raw table revision"):
            app_module._capture_committed_namespace_snapshot()
        assert state_path.read_bytes() == before_rejection
        assert (private_lumps / "boot-image.bin").read_bytes() == prepared_bytes

    # Raw-only publication must invalidate even an otherwise valid binding.
    state_path.write_text(json.dumps(prepared_state))
    app_module._write_boot_image_bytes(prepared_bytes)
    with pytest.raises(ValueError, match="not bound to a raw table revision"):
        app_module._freeze_namespace_revision("must-reject-raw-only")