import base64
import hashlib
import json
import os
import struct
import threading
import time

import pytest

assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1"
for key in ("CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH",
            "CHURCH_TEST_BUILD_SNAPSHOTS_DIR", "CHURCH_TEST_DB_PATH"):
    assert os.environ.get(key), key

import server.app as app_module


def _post_confirmed(client, path, **kwargs):
    response = client.post(path, **kwargs)
    if response.status_code == 428:
        response = client.post(path, **kwargs, headers={
            "X-Change-Confirmation": response.get_json()["change_confirmation"]["id"]})
    return response


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
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(boot_config))
    app_module.LAZY_LUMPS.clear()
    return app_module.app.test_client()


def test_uploaded_lump_is_structurally_admitted_but_not_vivified(
        tmp_path, monkeypatch):
    client = _isolated_upload(monkeypatch, tmp_path)
    raw = _unknown_lump()
    response = _post_confirmed(client, "/api/lumps/upload-lump", json={
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
    response = _post_confirmed(client, "/api/lumps/upload-lump", json={
        "name": "Malformed",
        "data_b64": base64.b64encode(raw).decode(),
    })
    assert response.status_code == 400
    assert response.get_json()["admission_status"] == "rejected"
    assert not list(tmp_path.rglob("*.lump"))
    assert app_module.LAZY_LUMPS == {}


def test_namespace_validation_accepts_exact_binary_despite_archived_catalog(
        tmp_path, monkeypatch):
    raw = _unknown_lump()
    digest = hashlib.sha256(raw).hexdigest()
    archived_name = "Imported_v1.lump"
    (tmp_path / archived_name).write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": digest[:8],
        "filename": archived_name,
        "binary_hash": digest,
        "archived": True,
    }]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    app_module._validate_active_namespace_lumps([{
        "name": "Imported",
        "slot": 14,
        "filename": archived_name,
        "binary_hash": digest,
    }])


@pytest.mark.parametrize("catalog", [
    [],
    [
        {"token": "4a000006", "filename": "selected.lump", "archived": True},
        {"token": "4a000006", "filename": "selected.lump", "archived": True},
    ],
    [{
        "token": "4a000006",
        "filename": "different-active.lump",
        "binary_hash": "f" * 64,
    }],
])
def test_namespace_binary_validation_ignores_stale_catalog_variants(
        tmp_path, monkeypatch, catalog):
    raw = _unknown_lump()
    digest = hashlib.sha256(raw).hexdigest()
    (tmp_path / "selected.lump").write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps(catalog))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    app_module._validate_active_namespace_lumps([{
        "name": "Selected",
        "slot": 6,
        "token": "4a000006",
        "filename": "selected.lump",
        "binary_hash": digest,
    }])


@pytest.mark.parametrize("failure", ["missing", "corrupt", "hash"])
def test_namespace_binary_validation_fails_closed_on_selected_bytes(
        tmp_path, monkeypatch, failure):
    raw = _unknown_lump()
    digest = hashlib.sha256(raw).hexdigest()
    if failure == "corrupt":
        (tmp_path / "selected.lump").write_bytes(b"not a LUMP")
    elif failure == "hash":
        (tmp_path / "selected.lump").write_bytes(raw)
        digest = "0" * 64
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    with pytest.raises(ValueError):
        app_module._validate_active_namespace_lumps([{
            "name": "Selected",
            "slot": 6,
            "token": "4a000006",
            "filename": "selected.lump",
            "binary_hash": digest,
        }])


def test_stale_namespace_snapshot_is_rejected_before_manifest_details_leak(
        tmp_path, monkeypatch):
    original = {"revision": 4, "abstractions": [
        {"slot": 14, "name": "Current", "boot": True}]}
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps(original))
    (tmp_path / "manifest.json").write_text("[]")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    payload = {
            "generate": True,
            "namespaceFingerprint": "0" * 64,
            "ns_state": {"abstractions": [{
                "name": "OldView",
                "slot": 6,
                "filename": "no-longer-active.lump",
                "binary_hash": "a" * 64,
            }]},
        }

    # Assert the underlying CAS rejection as well as the public review
    # wrapper, which deliberately wraps preflight errors in its own envelope.
    with app_module.app.test_request_context("/api/boot-image/save-ns", json=payload):
        response = app_module.app.make_response(
            app_module.boot_image_save_ns(_review_only=True))

    assert response.status_code == 409
    body = response.get_json()
    assert body["refreshRequired"] is True
    assert body["dataChanged"] is False
    assert body["error"] == (
        "The Namespace changed since this page was loaded. "
        "Reload it before saving."
    )
    assert "manifest" not in body["error"].lower()
    public = app_module.app.test_client().post("/api/boot-image/save-ns", json=payload)
    assert public.status_code == 409
    assert public.get_json()["error"] == "change_preflight_failed"
    assert public.get_json()["message"] == body["error"]
    assert json.loads(state_path.read_text()) == original


def test_history_transition_cannot_cross_namespace_validation_and_commit(
        tmp_path, monkeypatch):
    old_raw = _unknown_lump()
    new_words = list(struct.unpack(">64I", old_raw))
    new_words[1] = 0x1F000001
    new_raw = struct.pack(">64I", *new_words)
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
    boot_row = {**row, "slot": 15, "boot": True, "location": 2048,
                "filename": "BootFixture.lump"}
    (tmp_path / boot_row["filename"]).write_bytes(old_raw)
    rows = [row, boot_row]
    manifest_path.write_text(json.dumps([active]))
    state_path.write_text(json.dumps({"revision": 1, "abstractions": rows}))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    validated = threading.Event()
    replacement_started = threading.Event()
    save_committed = threading.Event()
    errors = []

    def save_namespace():
        with app_module._lump_history_transition_lock(str(tmp_path)):
            app_module._validate_active_namespace_lumps(rows)
            validated.set()
            assert replacement_started.wait(2)
            time.sleep(0.05)
            assert not save_committed.is_set()
            app_module._atomic_write_json(
                str(state_path), {"revision": 2, "abstractions": rows})

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
    assert errors and "hash mismatch" in errors[0]
    assert json.loads(manifest_path.read_text()) == [active]
    assert json.loads(state_path.read_text())["abstractions"] == rows
    assert (tmp_path / filename).read_bytes() == old_raw
    assert (tmp_path / boot_row["filename"]).read_bytes() == old_raw


@pytest.mark.parametrize("field,replacement", [
    ("destination_slot", 15),
    ("location", 1792),
    ("namespaceFingerprint", "0" * 64),
])
def test_admission_intent_binds_exact_placement_and_uses_recorded_grants(
        tmp_path, monkeypatch, field, replacement):
    client = _isolated_upload(monkeypatch, tmp_path)
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    (tmp_path / "boot-config.json").write_text(json.dumps({"step1": {
        "nsSlotsMax": 256, "totalNamespaceWords": 4096, "threadLumpWords": 256}}))
    monkeypatch.setenv("CHURCH_TEST_BOOT_CONFIG_PATH", str(tmp_path / "boot-config.json"))
    def post_confirmed(path, **kwargs):
        return _post_confirmed(client, path, **kwargs)
    raw = _unknown_lump()
    upload = post_confirmed("/api/lumps/upload-lump", json={
        "name": "BoundUpload",
        "data_b64": base64.b64encode(raw).decode(),
    }).get_json()
    assert "required_capabilities" in upload, upload
    operation = {
        "name": "BoundUpload",
        "revision": 1,
        "destination_slot": 14,
        "replace": False,
        "resident": True,
        "boot": False,
        "capabilities": upload["required_capabilities"],
        "namespaceFingerprint": app_module._namespace_state_fingerprint([]),
        "location": "0x600",
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

    intent = issue_intent()
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    substituted = post_confirmed("/api/lumps/admit-upload", json={
        "token": upload["token"],
        "binary_hash": upload["binary_hash"],
        "approval_intent": intent,
        **operation,
        **{field: replacement},
        "approved_capabilities": operation["capabilities"],
        "granted_capabilities": ["E"],
    })
    assert substituted.status_code == 403
    assert {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
    replay = post_confirmed("/api/lumps/admit-upload", json={
        "token": upload["token"], "binary_hash": upload["binary_hash"],
        "approval_intent": intent, **operation,
        "approved_capabilities": operation["capabilities"],
    })
    assert replay.status_code == 403
    assert {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before

    admitted = post_confirmed("/api/lumps/admit-upload", json={
        "token": upload["token"],
        "binary_hash": upload["binary_hash"],
        "approval_intent": issue_intent(),
        **operation,
        "location": 1536,  # Equivalent decimal and hex echoes have one identity.
        "approved_capabilities": operation["capabilities"],
        # Request-controlled escalation is ignored; the consumed approval's
        # exact ["E"] grant is the only value passed to Gate 5.
        "granted_capabilities": ["R", "W", "X", "E"],
    })
    assert admitted.status_code == 200, admitted.get_json()
    body = admitted.get_json()
    assert body["gates"]["gate5"]["granted"] == ["E"]
    assert body["token"] in app_module.LAZY_LUMPS