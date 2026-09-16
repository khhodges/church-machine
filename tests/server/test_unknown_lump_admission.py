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
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
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
    assert (tmp_path / f"{token}.lump").read_bytes() == raw
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest[0]["admission"]["status"] == "unverified"
    assert manifest[0]["admission"]["authority"] == "pending-human-vouch"
    assert manifest[0]["provenance"] == "uploaded-or-legacy"
    read_response = client.get(f"/api/lump/{token}")
    assert read_response.status_code == 200
    assert read_response.headers["X-Lump-Trust"] == "untrusted"


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
    assert not list(tmp_path.glob("*.lump"))
    assert app_module.LAZY_LUMPS == {}