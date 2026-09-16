import base64
import json
import struct

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