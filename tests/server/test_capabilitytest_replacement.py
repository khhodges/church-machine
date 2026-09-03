import json
import os
import sys
import threading
import time

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as app_module


def _header(cw=1, cc=0):
    return ((0x1F << 27) | (cw << 10) | cc) & 0xFFFFFFFF


def _payload(**changes):
    metadata = {
        "token": "00000a00",
        "abstraction": "CapabilityTest",
        "content_type": "code",
        "language": "assembly",
        "ns_slot": 10,
        "grants": ["E"],
        "capability_type": "inform",
        "namespace_sequence": 7,
        "replacement": True,
        "capabilities": [],
    }
    metadata.update(changes)
    return {"binary": [_header(), 0], "metadata": metadata}


@pytest.fixture()
def capabilitytest_repository(tmp_path, monkeypatch):
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    old_lump = b"prior CapabilityTest binary"
    old_sidecar = b'{"prior":true}'
    manifest = [{
        "token": "00000a00",
        "abstraction": "CapabilityTest",
        "filename": "old.lump",
        "sidecar_file": "old.json",
        "ns_slot": 10,
        "ns_slot_policy": "static",
        "boot_resident": True,
        "lump_version": 3,
    }]
    state = {"abstractions": [{
        "name": "CapabilityTest", "slot": 10, "type": "Inform",
        "seq": 7, "resident": True, "filename": "old.lump",
        "token": "00000a00",
    }]}
    (lumps / "manifest.json").write_text(json.dumps(manifest))
    (lumps / "old.lump").write_bytes(old_lump)
    (lumps / "old.json").write_bytes(old_sidecar)
    (lumps / ".history-transition.lock").write_bytes(b"")
    ns_state = lumps / "ns-state.json"
    ns_state.write_text(json.dumps(state))
    boot = lumps / "boot-image.bin"
    boot.write_bytes(b"prior boot image")

    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(lumps / "manifest.json"))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(ns_state))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(boot))
    monkeypatch.setattr(app_module, "_read_saved_boot_config", lambda: ({}, None))
    monkeypatch.setattr(app_module, "_read_boot_entry_slot_from_image", lambda: 10)
    monkeypatch.setattr(
        app_module._boot_image_gen, "generate_boot_image",
        lambda *args, **kwargs: b"new coherent boot image")
    monkeypatch.setattr(app_module, "_write_boot_image_bytes", boot.write_bytes)
    monkeypatch.setattr(app_module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(app_module, "_load_boot_ns_lump", lambda: None)
    app_module.app.config["TESTING"] = True
    return lumps, ns_state, boot


def test_valid_capabilitytest_replacement_is_coherent(capabilitytest_repository):
    lumps, ns_state, boot = capabilitytest_repository
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload())
    assert response.status_code == 200, response.get_data(as_text=True)
    result = response.get_json()
    assert result["token"] == "00000a00"
    manifest = json.loads((lumps / "manifest.json").read_text())
    current = next(row for row in manifest if row["token"] == "00000a00")
    assert current["abstraction"] == "CapabilityTest"
    assert current["ns_slot"] == 10
    assert current["ns_slot_policy"] == "static"
    assert current["boot_resident"] is True
    state = json.loads(ns_state.read_text())
    bound = next(row for row in state["abstractions"] if row["slot"] == 10)
    assert bound["filename"] == result["lump"]
    assert bound["seq"] == 7
    assert (lumps / result["lump"]).is_file()
    assert (lumps / result["sidecar"]).is_file()
    assert boot.read_bytes() == b"new coherent boot image"


@pytest.mark.parametrize(("change", "message"), [
    ({"abstraction": "CapabilityTypo"}, "canonical name"),
    ({"token": "deadbeef"}, "canonical token"),
    ({"capability_type": "outform"}, "Inform"),
    ({"ns_slot": 9}, "slot 10"),
    ({"grants": ["L"]}, "E-only"),
    ({"namespace_sequence": 8}, "retained sequence"),
    ({"replacement": False}, "explicit replacement"),
])
def test_protected_preflight_rejects_without_mutation(
        capabilitytest_repository, change, message):
    lumps, ns_state, boot = capabilitytest_repository
    before = {path.name: path.read_bytes() for path in lumps.iterdir()}
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload(**change))
    assert response.status_code == 422
    assert message in response.get_json()["error"]
    after = {path.name: path.read_bytes() for path in lumps.iterdir()}
    assert after == before


def test_boot_failure_rolls_back_every_artifact(
        capabilitytest_repository, monkeypatch):
    lumps, ns_state, boot = capabilitytest_repository
    before = {path.name: path.read_bytes() for path in lumps.iterdir()}

    def fail_boot_write(_blob):
        boot.write_bytes(b"partial boot")
        raise OSError("injected boot write failure")

    monkeypatch.setattr(app_module, "_write_boot_image_bytes", fail_boot_write)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload())
    assert response.status_code == 500
    assert "prior revision restored" in response.get_json()["error"]
    after = {path.name: path.read_bytes() for path in lumps.iterdir()}
    assert after == before


def test_ineligible_manifest_binding_is_rejected_before_mutation(
        capabilitytest_repository):
    lumps, _ns_state, _boot = capabilitytest_repository
    manifest_path = lumps / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest[0]["boot_resident"] = False
    manifest_path.write_text(json.dumps(manifest))
    before = {path.name: path.read_bytes() for path in lumps.iterdir()}
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload())
    assert response.status_code == 422
    assert "not eligible" in response.get_json()["error"]
    assert {path.name: path.read_bytes() for path in lumps.iterdir()} == before


def test_historical_variant_cannot_make_canonical_binding_eligible(
        capabilitytest_repository):
    lumps, _ns_state, _boot = capabilitytest_repository
    manifest_path = lumps / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest[0]["boot_resident"] = False
    manifest.append({
        "token": "c7425d6c",
        "abstraction": "CapabilityTest",
        "filename": "historical.lump",
        "sidecar_file": "historical.json",
        "ns_slot": 10,
        "ns_slot_policy": "static",
        "boot_resident": True,
        "archived": True,
    })
    manifest_path.write_text(json.dumps(manifest))
    before = {path.name: path.read_bytes() for path in lumps.iterdir()}
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload())
    assert response.status_code == 422
    assert "canonical slot-10 artifact is not eligible" in response.get_json()["error"]
    assert {path.name: path.read_bytes() for path in lumps.iterdir()} == before


def test_missing_boot_image_rejects_before_mutation(capabilitytest_repository):
    lumps, _ns_state, boot = capabilitytest_repository
    boot.unlink()
    before = {path.name: path.read_bytes() for path in lumps.iterdir()}
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload())
    assert response.status_code == 422
    assert "boot image is unavailable" in response.get_json()["error"]
    assert {path.name: path.read_bytes() for path in lumps.iterdir()} == before


def test_failed_protected_save_does_not_rollback_concurrent_save(
        capabilitytest_repository, monkeypatch):
    lumps, ns_state, boot = capabilitytest_repository
    protected_in_boot = threading.Event()
    allow_failure = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def generate_with_first_call_failure(*args, **kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
            call_number = calls
        if call_number == 1:
            protected_in_boot.set()
            assert allow_failure.wait(timeout=5)
            raise OSError("injected protected boot failure")
        return b"concurrent save boot image"

    monkeypatch.setattr(
        app_module._boot_image_gen,
        "generate_boot_image",
        generate_with_first_call_failure,
    )
    results = {}

    def save_protected():
        with app_module.app.test_client() as client:
            response = client.post("/api/lumps/save", json=_payload())
            results["protected"] = (response.status_code, response.get_json())

    def save_ordinary():
        ordinary_payload = {
            "binary": [_header(), 0],
            "metadata": {
                "token": "1234abcd",
                "abstraction": "ConcurrentWidget",
                "capabilities": [],
            },
        }
        with app_module.app.test_client() as client:
            response = client.post("/api/lumps/save", json=ordinary_payload)
            results["ordinary"] = (response.status_code, response.get_json())

    protected_thread = threading.Thread(target=save_protected)
    protected_thread.start()
    assert protected_in_boot.wait(timeout=5)
    ordinary_thread = threading.Thread(target=save_ordinary)
    ordinary_thread.start()
    time.sleep(0.1)
    assert ordinary_thread.is_alive(), "ordinary save bypassed protected transaction lock"

    allow_failure.set()
    protected_thread.join(timeout=5)
    ordinary_thread.join(timeout=5)
    assert not protected_thread.is_alive()
    assert not ordinary_thread.is_alive()
    assert results["protected"][0] == 500
    assert results["ordinary"][0] == 200

    manifest = json.loads((lumps / "manifest.json").read_text())
    capabilitytest = next(
        entry for entry in manifest if entry.get("token") == "00000a00")
    assert capabilitytest["filename"] == "old.lump"
    assert (lumps / "old.lump").read_bytes() == b"prior CapabilityTest binary"
    state = json.loads(ns_state.read_text())
    slot10 = next(entry for entry in state["abstractions"] if entry["slot"] == 10)
    assert slot10["filename"] == "old.lump"
    assert any(entry.get("token") == "1234abcd" for entry in manifest)
    assert boot.read_bytes() == b"concurrent save boot image"


def test_protected_rollback_preserves_ordinary_save_already_after_manifest(
        capabilitytest_repository, monkeypatch):
    """An ordinary save keeps the lock through its NS and boot-image commit."""
    lumps, ns_state, boot = capabilitytest_repository
    ordinary_after_manifest = threading.Event()
    allow_ordinary_to_finish = threading.Event()
    original_bind = app_module._bind_saved_lump_to_ns_state
    generate_calls = 0

    def pause_ordinary_bind(abstraction, *args, **kwargs):
        if abstraction == "OrdinaryFirst":
            ordinary_after_manifest.set()
            assert allow_ordinary_to_finish.wait(timeout=5)
        return original_bind(abstraction, *args, **kwargs)

    def ordinary_succeeds_then_protected_fails(*args, **kwargs):
        nonlocal generate_calls
        generate_calls += 1
        if generate_calls == 1:
            return b"ordinary completed boot image"
        raise OSError("injected protected rollback after ordinary save")

    monkeypatch.setattr(
        app_module, "_bind_saved_lump_to_ns_state", pause_ordinary_bind)
    monkeypatch.setattr(
        app_module._boot_image_gen,
        "generate_boot_image",
        ordinary_succeeds_then_protected_fails,
    )
    results = {}

    def save_ordinary():
        payload = {
            "binary": [_header(), 0],
            "metadata": {
                "token": "87654321",
                "abstraction": "OrdinaryFirst",
                "capabilities": [],
            },
        }
        with app_module.app.test_client() as client:
            response = client.post("/api/lumps/save", json=payload)
            results["ordinary"] = (response.status_code, response.get_json())

    def save_protected():
        with app_module.app.test_client() as client:
            response = client.post("/api/lumps/save", json=_payload())
            results["protected"] = (response.status_code, response.get_json())

    ordinary_thread = threading.Thread(target=save_ordinary)
    ordinary_thread.start()
    assert ordinary_after_manifest.wait(timeout=5)
    protected_thread = threading.Thread(target=save_protected)
    protected_thread.start()
    time.sleep(0.1)
    assert protected_thread.is_alive(), (
        "protected save entered while ordinary save was between manifest and boot commit")

    allow_ordinary_to_finish.set()
    ordinary_thread.join(timeout=5)
    protected_thread.join(timeout=5)
    assert not ordinary_thread.is_alive()
    assert not protected_thread.is_alive()
    assert results["ordinary"][0] == 200
    assert results["protected"][0] == 500

    manifest = json.loads((lumps / "manifest.json").read_text())
    assert any(entry.get("token") == "87654321" for entry in manifest)
    capabilitytest = next(
        entry for entry in manifest if entry.get("token") == "00000a00")
    assert capabilitytest["filename"] == "old.lump"
    state = json.loads(ns_state.read_text())
    slot10 = next(entry for entry in state["abstractions"] if entry["slot"] == 10)
    assert slot10["filename"] == "old.lump"
    assert boot.read_bytes() == b"ordinary completed boot image"