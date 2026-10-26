"""No sockets/board calls: isolated retained sources and in-process queue only."""
import base64
import hashlib
import json
from pathlib import Path

import pytest
import server.app as module
from server.artifact_revisions import RevisionStore
REAL_CERTIFICATION_CHECK = module._require_hardware_namespace_revision


@pytest.fixture
def fixture(monkeypatch, tmp_path):
    store = RevisionStore(str(tmp_path / "revisions"))
    monkeypatch.setattr(module, "_artifact_revision_store", lambda: store)
    monkeypatch.setattr(module, "_wukong_control_auth", lambda: (True, None))
    monkeypatch.setattr(module, "_wukong_target_error", lambda data: (
        {"device_uid": "test-board", "bridge_session": "test-session"}, None))
    for name, value in {
        "_upload_in_flight": False, "_wukong_pending_cmd": None,
        "_wukong_upload_ack": {}, "_wukong_cmd_delivery": {},
        "_wukong_cmd_id": 0, "_wukong_pending_entry_slot": None,
        "_wukong_pending_thread_contexts": [],
    }.items():
        monkeypatch.setattr(module, name, value)
    monkeypatch.setattr(module, "_wukong_update_active_lump_nia", lambda *args: None)
    # Hardware admission has its own certification tests. Keep it mandatory
    # here while isolating source selection/projection from physical formats.
    certified = []
    monkeypatch.setattr(module, "_require_hardware_namespace_revision",
                        lambda record: certified.append(record["revision_id"]))
    info = {"resident": True, "caps0_ok": True, "entry_slot": 10, "thread_count": 1}
    monkeypatch.setattr(module._boot_image_gen, "read_boot_entry_info", lambda raw: info)
    projection = []
    def project(raw, config):
        projection.append((raw, config))
        return b"native:" + raw, info
    monkeypatch.setattr(module._boot_image_gen, "build_wukong_upload_image", project)
    def forbidden(*args, **kwargs):
        pytest.fail("Exact revision path consulted mutable live inputs")
    monkeypatch.setattr(module, "_read_saved_boot_config", forbidden)
    monkeypatch.setattr(module._boot_image_gen, "validate_resident_artifact_bindings", forbidden)
    return store, module.app.test_client(), certified, projection


def publish(store, image=b"old-selected-image"):
    return store.publish("namespace", {"approval_state": "approved"}, {
        "boot-image.bin": image,
        "boot-config.json": json.dumps({"step1": {"marker": "frozen"}}).encode(),
    })


def test_exact_historical_image_and_config(fixture):
    store, client, certified, projection = fixture
    old = publish(store)
    publish(store, b"newer-not-selected")
    response = client.post("/api/namespace-image/install", json={"namespace_revision_id": old})
    assert response.status_code == 200, response.json
    assert response.json["namespace_revision_id"] == old
    assert certified == [old]
    assert projection == [(b"old-selected-image", {"step1": {"marker": "frozen"}})]
    queued = module._wukong_pending_cmd
    assert queued["namespace_revision_id"] == old
    assert base64.b64decode(queued["data"]) == b"native:old-selected-image"
    assert response.json["source_sha256"] == hashlib.sha256(b"old-selected-image").hexdigest()


@pytest.mark.parametrize("body", [{}, {"namespace_revision_id": ""},
    {"namespace_revision_id": "../current"},
    {"namespace_revision_id": "a" * 64, "source_image_base64": "AAAA"}])
def test_missing_or_mixed_revision_never_falls_back(fixture, body):
    _, client, _, projection = fixture
    assert client.post("/api/namespace-image/install", json=body).status_code == 400
    assert not projection
    assert module._wukong_pending_cmd is None


@pytest.mark.parametrize("corrupt", [False, True])
def test_missing_or_corrupt_revision_fails_closed(fixture, corrupt):
    store, client, _, projection = fixture
    revision = publish(store) if corrupt else "a" * 64
    if corrupt:
        path = store.file_path("namespace", revision, "boot-image.bin")
        Path(path).write_bytes(b"tampered")
    response = client.post("/api/namespace-image/install", json={"namespace_revision_id": revision})
    assert response.status_code == 409
    assert not projection
    assert module._wukong_pending_cmd is None
    assert not module._upload_in_flight


def test_auth_rejection_precedes_selection(fixture, monkeypatch):
    _, client, certified, _ = fixture
    monkeypatch.setattr(module, "_wukong_control_auth",
                        lambda: (False, ({"error": "Unauthorized"}, 401)))
    assert client.post("/api/namespace-image/install", json={}).status_code == 401
    assert not certified
    assert module._wukong_pending_cmd is None


def test_uncertified_revision_is_rejected_by_real_gate(fixture, monkeypatch):
    store, client, _, projection = fixture
    monkeypatch.setattr(module, "_require_hardware_namespace_revision", REAL_CERTIFICATION_CHECK)
    revision = publish(store)
    result = client.post("/api/namespace-image/install", json={"namespace_revision_id": revision})
    assert result.status_code == 409
    assert not projection
    assert module._wukong_pending_cmd is None


def test_stale_target_prevents_revision_read(fixture, monkeypatch):
    _, client, certified, projection = fixture
    monkeypatch.setattr(module, "_wukong_target_error",
                        lambda data: (None, ("stale_target", "board is not live")))
    result = client.post("/api/namespace-image/install", json={"namespace_revision_id": "a" * 64})
    assert result.status_code == 409
    assert not certified and not projection


def test_install_does_not_replace_pending_command_or_ack(fixture, monkeypatch):
    store, client, _, _ = fixture
    revision = publish(store)
    pending = {"cmd": "h", "id": 99}
    ack = {"id": 98, "ok": True}
    monkeypatch.setattr(module, "_wukong_pending_cmd", pending)
    monkeypatch.setattr(module, "_wukong_upload_ack", ack)
    result = client.post("/api/namespace-image/install", json={"namespace_revision_id": revision})
    assert result.status_code == 409
    assert module._wukong_pending_cmd == pending
    assert module._wukong_upload_ack == ack
