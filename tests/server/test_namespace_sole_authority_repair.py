"""Focused Namespace sole-image-plan repair checks.

These tests deliberately operate on temporary copies of the checked-in
artifacts.  No test mutates the repository's live Namespace state or image.
"""

import hashlib
import json
import os
import shutil
import base64
from pathlib import Path

import pytest

from server import boot_image


ROOT = Path(__file__).resolve().parents[2]
LUMPS = ROOT / "server" / "lumps"
CONFIG_PATH = ROOT / "server" / "boot-config.json"


def _copy_fixture(tmp_path):
    lumps = tmp_path / "lumps"
    shutil.copytree(LUMPS, lumps)
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return lumps, config


def _state(lumps):
    return json.loads((lumps / "ns-state.json").read_text(encoding="utf-8"))


def _write_state(lumps, state):
    (lumps / "ns-state.json").write_text(
        json.dumps(state, indent=2), encoding="utf-8")


def _set_marker(state, slot):
    for row in state["abstractions"]:
        row.pop("boot", None)
    next(row for row in state["abstractions"] if row["slot"] == slot)["boot"] = True


def test_alternate_eligible_target_is_authoritative_and_stale_explicit_slot_rejected(
        tmp_path):
    lumps, config = _copy_fixture(tmp_path)
    state = _state(lumps)
    _set_marker(state, 7)  # WukongCallHome is an approved resident executable.
    _write_state(lumps, state)

    assert boot_image.namespace_boot_marker_slot(state["abstractions"]) == 7
    image = boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=7)
    assert boot_image.read_boot_entry_info(image)["entry_slot"] == 7

    # A stale UI/config selection cannot override the state marker.
    with pytest.raises(ValueError, match="does not match authoritative"):
        boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=10)


def test_duplicate_marker_fails_closed_without_image_generation(tmp_path):
    lumps, config = _copy_fixture(tmp_path)
    state = _state(lumps)
    next(row for row in state["abstractions"] if row["slot"] == 7)["boot"] = True
    before = (lumps / "boot-image.bin").read_bytes()
    _write_state(lumps, state)

    with pytest.raises(ValueError, match="exactly one"):
        boot_image.generate_boot_image(config, str(lumps))
    assert (lumps / "boot-image.bin").read_bytes() == before


def test_mmio_marker_is_rejected_only_by_physical_image_projection(tmp_path):
    lumps, config = _copy_fixture(tmp_path)
    state = _state(lumps)
    _set_marker(state, 2)  # UART_DEV remains a valid MMIO descriptor, not code.
    _write_state(lumps, state)

    # Marker parsing itself is Namespace-generic; the physical generator gate
    # rejects attempting to project an MMIO row into Boot.Entry.
    assert boot_image.namespace_boot_marker_slot(state["abstractions"]) == 2
    with pytest.raises(ValueError, match="MMIO device"):
        boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=2)


def test_generator_rejects_competing_step2_artifact_and_policy_authority(tmp_path):
    lumps, config = _copy_fixture(tmp_path)
    conflicting = json.loads(json.dumps(config))
    conflicting["step2"] = {
        "lumps": [{
            "nsSlot": 10,
            "lumpToken": "4a000002",
            "loadPolicy": "Resident",
            "resident": True,
        }]
    }
    with pytest.raises(ValueError, match="Step-2 token"):
        boot_image.generate_boot_image(conflicting, str(lumps))

    conflicting.pop("step2")
    conflicting["residentProfile"] = "core"
    with pytest.raises(ValueError, match="residentProfile"):
        boot_image.generate_boot_image(conflicting, str(lumps))


def test_committed_migration_descriptor_binary_config_and_provenance_parity():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    state = json.loads((LUMPS / "ns-state.json").read_text(encoding="utf-8"))
    image = (LUMPS / "boot-image.bin").read_bytes()
    provenance = json.loads(
        (LUMPS / "boot-image.provenance.json").read_text(encoding="utf-8"))

    marker = boot_image.namespace_boot_marker_slot(state["abstractions"])
    info = boot_image.read_boot_entry_info(image)
    assert marker == 10
    assert info["entry_slot"] == marker
    assert info["resident"] and info["caps0_ok"]
    assert config["bootEntrySlot"] == marker

    raw = boot_image.parse_ns_table_raw(image)
    raw_by_slot = {entry["slot"]: entry for entry in raw["entries"]}
    for row in state["abstractions"]:
        entry = raw_by_slot[row["slot"]]
        assert int(row["location"], 0) == entry["w0"]
        assert int(row["limit"], 0) == entry["w1"] & 0x1FFFF
        assert int(row["seal"], 0) == entry["w2"]
    assert state["abstractions"][2]["name"] == "UART_DEV"
    cap = next(row for row in state["abstractions"]
               if row["name"] == "CapabilityTest")
    assert cap["slot"] == 10
    assert cap["token"] == "4a00000a"
    assert cap["filename"] == "CapabilityTest.2.e794a764.lump"

    image_digest = hashlib.sha256(image).hexdigest()
    assert provenance["origin"] == "generated"
    assert provenance["image_sha256"] == image_digest
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(
        (LUMPS / "ns-state.json").read_bytes()).hexdigest()
    assert provenance["source_sha256"]["manifest"] == hashlib.sha256(
        (LUMPS / "manifest.json").read_bytes()).hexdigest()
    cap_binding = next(row for row in provenance["resident_bindings"]
                       if row["slot"] == 10)
    assert cap_binding["filename"] == cap["filename"]
    assert cap_binding["token"] == cap["token"]
    assert cap_binding["artifact_sha256"] == hashlib.sha256(
        (LUMPS / cap["filename"]).read_bytes()).hexdigest()


def test_capabilitytest_migration_uses_exact_approved_current_artifact():
    approvals = json.loads((LUMPS / "approvals.json").read_text(encoding="utf-8"))[
        "approvals"]
    manifest = json.loads((LUMPS / "manifest.json").read_text(encoding="utf-8"))
    current = next(row for row in manifest
                   if row.get("filename") == "CapabilityTest.2.e794a764.lump")
    historical = next(row for row in manifest
                      if row.get("filename") == "CapabilityTest.2.6fd9df21.lump")
    current_hash = hashlib.sha256(
        (LUMPS / current["filename"]).read_bytes()).hexdigest()
    historical_hash = hashlib.sha256(
        (LUMPS / historical["filename"]).read_bytes()).hexdigest()
    assert current["token"] == "4a00000a"
    assert approvals[current_hash]["bootstrap_t"] == "4a00000a"
    assert historical["token"] == "4a000002"
    assert approvals[historical_hash]["bootstrap_t"] == "4a000002"
    # The old artifact remains immutable historical evidence; only the exact
    # approved current artifact is bound into the repaired NS[10] row.
    state = json.loads((LUMPS / "ns-state.json").read_text(encoding="utf-8"))
    cap = next(row for row in state["abstractions"]
               if row["name"] == "CapabilityTest")
    assert cap["filename"] == current["filename"]
    assert cap["token"] == current["token"]
    assert historical_hash == (
        "1ec3fd949e040d4ea851f8d93f1bd54230679f2e8b7fca07e6d586c4335d475c")


def test_boot_marker_endpoint_is_atomic_and_accepts_eligible_alternate(tmp_path,
                                                                         monkeypatch):
    # Importing the Flask module is isolated to this test process; all writes
    # are redirected to a temporary artifact directory.
    from server import app as app_module

    lumps, _ = _copy_fixture(tmp_path)
    state_path = lumps / "ns-state.json"
    image_path = lumps / "boot-image.bin"
    before_image = image_path.read_bytes()
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    app_module.app.config["TESTING"] = True
    headers = {}
    if os.environ.get("REPORT_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['REPORT_TOKEN']}"
    fingerprint = app_module._namespace_state_fingerprint(
        _state(lumps)["abstractions"])

    with app_module.app.test_client() as client:
        response = client.post(
            "/api/namespace/boot-marker",
            json={"slot": 7, "namespaceFingerprint": fingerprint},
            headers=headers)
        assert response.status_code == 200, response.get_data(as_text=True)
        updated = json.loads(state_path.read_text(encoding="utf-8"))
        assert [row["slot"] for row in updated["abstractions"] if row.get("boot")] == [7]
        assert image_path.read_bytes() == before_image

        # Duplicate markers are rejected before the atomic replacement and
        # therefore cannot partially alter the state file.
        updated["abstractions"][0]["boot"] = True
        duplicate_bytes = json.dumps(updated, indent=2).encode()
        state_path.write_bytes(duplicate_bytes)
        response = client.post(
            "/api/namespace/boot-marker",
            json={"slot": 7, "namespaceFingerprint": fingerprint},
            headers=headers)
        assert response.status_code == 409
        assert state_path.read_bytes() == duplicate_bytes


def test_save_ns_commits_submitted_alternate_marker_and_rejects_stale_tab(
        tmp_path, monkeypatch):
    from server import app as app_module

    lumps, config = _copy_fixture(tmp_path)
    state_path = lumps / "ns-state.json"
    image_path = lumps / "boot-image.bin"
    provenance_path = lumps / "boot-image.provenance.json"
    config_path = tmp_path / "boot-config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    state = _state(lumps)
    expected = app_module._namespace_state_fingerprint(state["abstractions"])
    original_state = json.loads(json.dumps(state))
    _set_marker(state, 7)
    _write_state(lumps, state)
    alternate = boot_image.generate_boot_image(
        config, str(lumps), boot_entry_slot=7)
    _write_state(lumps, original_state)

    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(lumps / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PROVENANCE_PATH", str(provenance_path))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config_path))
    app_module.app.config["TESTING"] = True
    headers = {}
    if os.environ.get("REPORT_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['REPORT_TOKEN']}"
    payload = {
        "data_b64": base64.b64encode(alternate).decode(),
        "ns_state": {"abstractions": state["abstractions"]},
        "boot_config": config,
        "namespaceFingerprint": expected,
    }

    with app_module.app.test_client() as client:
        response = client.post("/api/boot-image/save-ns", json=payload,
                               headers=headers)
        assert response.status_code == 200, response.get_data(as_text=True)
        committed = _state(lumps)
        assert [row["slot"] for row in committed["abstractions"]
                if row.get("boot")] == [7]
        assert json.loads(config_path.read_text())["bootEntrySlot"] == 7
        assert boot_image.read_boot_entry_info(image_path.read_bytes())["entry_slot"] == 7

        # A second writer carrying the original fingerprint cannot replace the
        # newly committed complete Namespace/image/config transaction.
        stale_payload = dict(payload)
        stale_payload["ns_state"] = {"abstractions": committed["abstractions"]}
        stale_payload["data_b64"] = base64.b64encode(image_path.read_bytes()).decode()
        response = client.post("/api/boot-image/save-ns", json=stale_payload,
                               headers=headers)
        assert response.status_code == 409
        assert response.get_json()["dataChanged"] is False


def test_reviewed_migration_tool_recreates_image_state_and_provenance(tmp_path):
    from scripts import migrate_bootstrap_residents as migration

    lumps, config = _copy_fixture(tmp_path)
    config["bootEntrySlot"] = 2
    (tmp_path / "boot-config.json").write_text(
        json.dumps(config), encoding="utf-8")
    state = _state(lumps)
    state["abstractions"] = [
        row for row in state["abstractions"]
        if row.get("slot") not in (2, 10)
    ]
    state["abstractions"].append({
        "name": "CapabilityTest",
        "slot": 2,
        "location": "0x40000014",
        "type": "Inform",
        "f": 0,
        "g": 1,
        "limit": "0x00002",
        "seq": 0,
        "seal": "0xDEADF4CF",
        "token": "4a000002",
        "filename": "CapabilityTest.2.6fd9df21.lump",
        "issue_n": 2,
        "lump_version": 27,
        "resident": True,
        "load_policy": "Resident",
        "boot_resident": True,
        "ns_slot_policy": "static",
        "boot": True,
    })
    _write_state(lumps, state)
    migration.migrate(str(lumps))

    migrated = _state(lumps)
    cap = next(row for row in migrated["abstractions"]
               if row["name"] == "CapabilityTest")
    uart = next(row for row in migrated["abstractions"]
                if row["name"] == "UART_DEV")
    image = (lumps / "boot-image.bin").read_bytes()
    provenance = json.loads(
        (lumps / "boot-image.provenance.json").read_text(encoding="utf-8"))
    assert cap["slot"] == 10 and cap["token"] == "4a00000a"
    assert cap["filename"] == "CapabilityTest.2.e794a764.lump"
    assert cap["boot"] is True and uart["slot"] == 2
    assert boot_image.read_boot_entry_info(image)["entry_slot"] == 10
    assert provenance["image_sha256"] == hashlib.sha256(image).hexdigest()
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(
        (lumps / "ns-state.json").read_bytes()).hexdigest()
    assert (lumps / "CapabilityTest.2.6fd9df21.lump").read_bytes() == (
        LUMPS / "CapabilityTest.2.6fd9df21.lump").read_bytes()


def test_legacy_or_missing_state_does_not_abort_image_metadata_startup(
        tmp_path, monkeypatch):
    from server import app as app_module

    image_path = tmp_path / "boot-image.bin"
    shutil.copyfile(LUMPS / "boot-image.bin", image_path)
    config_path = tmp_path / "boot-config.json"
    shutil.copyfile(CONFIG_PATH, config_path)
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "missing.json"))
    app_module._BOOT_NS_META.clear()
    app_module._load_boot_ns_lump()
    assert "authority_error" in app_module._BOOT_NS_META