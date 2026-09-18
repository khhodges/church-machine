import base64
import hashlib
import json
import struct
import threading
import time

import server.app as app_module


def _unknown_lump():
    words = [((0x1F << 27) | (1 << 10) | 1)] + [0] * 62
    words[1] = 0x1F000000  # RETURN
    words.append(0x4A000006)  # Inform/E SELF for NS[6], seq 0
    return struct.pack(">64I", *words)


def _isolated_upload(monkeypatch, tmp_path):
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "revision": 0, "abstractions": [],
    }))
    boot_config = tmp_path / "boot-config.json"
    boot_config.write_text(json.dumps({"step1": {"nsSlotsMax": 256}}))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(boot_config))
    app_module.LAZY_LUMPS.clear()
    return app_module.app.test_client()


def test_uploaded_lump_is_structurally_admitted_but_not_vivified(
        tmp_path, monkeypatch):
    client = _isolated_upload(monkeypatch, tmp_path)
    raw = _unknown_lump()
    response = client.post("/api/lumps/upload-lump", json={
        "name": "UploadedFixture",
        "data_b64": base64.b64encode(raw).decode(),
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["admission_status"] == "unverified"
    assert body["executable"] is False
    token = body["token"]
    assert token not in app_module.LAZY_LUMPS
    assert (tmp_path / "quarantine" /
            f"{body['binary_hash']}.lump").read_bytes() == raw
    assert not (tmp_path / "quarantine" / f"{token}.lump").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest == []
    read_response = client.get(f"/api/lump/{token}")
    assert read_response.status_code == 404


def test_malformed_uploaded_lump_is_rejected_before_persistence(
        tmp_path, monkeypatch):
    client = _isolated_upload(monkeypatch, tmp_path)
    words = [((0x1F << 27) | (1 << 10))] + [0] * 63  # cc=0, no SELF
    raw = struct.pack(">64I", *words)
    response = client.post("/api/lumps/upload-lump", json={
        "name": "Malformed",
        "data_b64": base64.b64encode(raw).decode(),
    })
    assert response.status_code == 400
    assert response.get_json()["admission_status"] == "rejected"
    assert not list(tmp_path.rglob("*.lump"))
    assert app_module.LAZY_LUMPS == {}


def test_namespace_import_rejects_archived_only_selector_before_commit(
        tmp_path, monkeypatch):
    digest = "a" * 64
    archived_name = "Imported_v1.lump"
    (tmp_path / archived_name).write_bytes(b"archived")
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": digest[:8],
        "filename": archived_name,
        "binary_hash": digest,
        "archived": True,
    }]))
    original = {"revision": 4, "abstractions": []}
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps(original))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    response = app_module.app.test_client().post(
        "/api/boot-image/save-ns",
        json={
            "data_b64": base64.b64encode(b"\0\0\0\0").decode(),
            "namespaceFingerprint": "import-snapshot",
            "ns_state": {"abstractions": [{
                "name": "Imported",
                "slot": 14,
                "filename": archived_name,
                "binary_hash": digest,
            }]},
        })

    assert response.status_code == 409
    assert "exactly one active manifest row" in response.get_json()["error"]
    assert json.loads(state_path.read_text()) == original


def test_history_transition_cannot_cross_namespace_validation_and_commit(
        tmp_path, monkeypatch):
    old_raw = b"active revision"
    new_raw = b"replacement revision"
    old_hash = hashlib.sha256(old_raw).hexdigest()
    new_hash = hashlib.sha256(new_raw).hexdigest()
    filename = "Example.1.12345678.lump"
    active = {
        "token": "12345678",
        "filename": filename,
        "binary_hash": old_hash,
        "abstraction": "Example",
        "lump_version": 1,
    }
    row = {
        "name": "Example",
        "slot": 14,
        "token": "12345678",
        "filename": filename,
        "binary_hash": old_hash,
    }
    manifest_path = tmp_path / "manifest.json"
    state_path = tmp_path / "ns-state.json"
    (tmp_path / filename).write_bytes(old_raw)
    manifest_path.write_text(json.dumps([active]))
    state_path.write_text(json.dumps({"revision": 1, "abstractions": [row]}))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    validated = threading.Event()
    replacement_started = threading.Event()
    save_committed = threading.Event()
    errors = []

    def save_namespace():
        with app_module._lump_history_transition_lock(str(tmp_path)):
            app_module._validate_active_namespace_lumps([row])
            validated.set()
            assert replacement_started.wait(2)
            time.sleep(0.05)
            assert not save_committed.is_set()
            app_module._atomic_write_json(
                str(state_path), {"revision": 2, "abstractions": [row]})

    def replace_selected_lump():
        assert validated.wait(2)
        replacement_started.set()
        try:
            app_module._commit_lump_history_transition(
                lumps_dir=str(tmp_path),
                manifest_path=str(manifest_path),
                token8="12345678",
                manifest_entry={**active, "binary_hash": new_hash},
                binary_filename=filename,
                binary_bytes=new_raw,
                archive_stem="Example",
                archive_version=1,
                archive_binary_path=str(tmp_path / filename),
                expected_manifest_entry=active,
                additional_json_builder=lambda _entry: {
                    str(state_path): json.loads(state_path.read_text()),
                },
            )
        except ValueError as exc:
            errors.append(str(exc))
        finally:
            save_committed.set()

    save_thread = threading.Thread(target=save_namespace)
    replace_thread = threading.Thread(target=replace_selected_lump)
    save_thread.start()
    replace_thread.start()
    save_thread.join(3)
    replace_thread.join(3)

    assert not save_thread.is_alive()
    assert not replace_thread.is_alive()
    assert errors and "exactly one active manifest row" in errors[0]
    assert json.loads(manifest_path.read_text()) == [active]
    assert json.loads(state_path.read_text())["abstractions"] == [row]
    assert (tmp_path / filename).read_bytes() == old_raw


def test_admission_intent_binds_exact_placement_and_uses_recorded_grants(
        tmp_path, monkeypatch):
    client = _isolated_upload(monkeypatch, tmp_path)
    raw = _unknown_lump()
    upload = client.post("/api/lumps/upload-lump", json={
        "name": "BoundUpload",
        "data_b64": base64.b64encode(raw).decode(),
    }).get_json()
    operation = {
        "name": "BoundUpload",
        "revision": 1,
        "destination_slot": 14,
        "replace": False,
        "resident": False,
        "boot": False,
        "capabilities": upload["required_capabilities"],
    }

    def issue_intent():
        response = client.post("/api/lumps/approval-intent", json={
            "digest": upload["binary_hash"],
            "action": "import-approval",
            "confirmation": True,
            "approval": {"grants": ["E"], "admission": operation},
        })
        assert response.status_code == 201
        return response.get_json()["intent"]

    substituted = client.post("/api/lumps/admit-upload", json={
        "token": upload["token"],
        "binary_hash": upload["binary_hash"],
        "approval_intent": issue_intent(),
        **operation,
        "destination_slot": 15,
        "approved_capabilities": operation["capabilities"],
        "granted_capabilities": ["E"],
    })
    assert substituted.status_code == 403
    assert json.loads((tmp_path / "manifest.json").read_text()) == []

    admitted = client.post("/api/lumps/admit-upload", json={
        "token": upload["token"],
        "binary_hash": upload["binary_hash"],
        "approval_intent": issue_intent(),
        **operation,
        "approved_capabilities": operation["capabilities"],
        # Request-controlled escalation is ignored; the consumed approval's
        # exact ["E"] grant is the only value passed to Gate 5.
        "granted_capabilities": ["R", "W", "X", "E"],
    })
    assert admitted.status_code == 200
    body = admitted.get_json()
    assert body["gates"]["gate5"]["granted"] == ["E"]
    assert body["token"] in app_module.LAZY_LUMPS