"""Approval binds Namespace bytes to elaboration provenance, not just a label."""
import hashlib
import json
import os
from types import SimpleNamespace

import pytest

import server.app as api


@pytest.fixture
def frozen_inputs(monkeypatch, tmp_path):
    paths = {}
    for key, name in (("verilog", "church_wukong_xc7a100t.v"),
                      ("rtlil", "church_wukong_xc7a100t.il"),
                      ("xdc", "wukong_xc7a100t.xdc"), ("tcl", "wukong_xc7a100t.tcl")):
        path = tmp_path / name
        path.write_bytes(key.encode())
        paths[key] = str(path)
    image = tmp_path / "boot-image.bin"
    image.write_bytes(b"exact approved image")
    state = tmp_path / "ns-state.json"
    state.write_text(json.dumps({"abstractions": []}))
    monkeypatch.setattr(api, "BOOT_IMAGE_PATH", str(image))
    monkeypatch.setattr(api, "NS_STATE_PATH", str(state))
    monkeypatch.setattr(api, "_BUILD_SNAPSHOTS_DIR", str(tmp_path / "snapshots"))
    monkeypatch.setattr(api, "_fpga_paths", lambda _: (paths, None, None, None, None))
    monkeypatch.setattr(api, "_git_full_head", lambda: "a" * 40)
    monkeypatch.setattr(api, "_wukong_build_version", lambda: 17)
    monkeypatch.setattr(api, "_capture_committed_namespace_snapshot", lambda **_: {
        "fingerprint": "b" * 64, "schema_version": 1,
        "namespace": {"decoded_slots": [], "raw": {"entries": []}},
    })
    provenance = {
        "schema_version": 1, "source_tree_clean": True, "source_commit": "a" * 40,
        "boot_inputs_sha256": {"server/lumps/boot-image.bin": hashlib.sha256(image.read_bytes()).hexdigest()},
        "artifacts": {
            "church_wukong_xc7a100t.v": {"sha256": hashlib.sha256(b"verilog").hexdigest()},
            "church_wukong_xc7a100t.il": {"sha256": hashlib.sha256(b"rtlil").hexdigest()}},
        "input_files_sha256": {
            "hardware/wukong_xc7a100t.xdc": hashlib.sha256(b"xdc").hexdigest(),
            "hardware/wukong_xc7a100t.tcl": hashlib.sha256(b"tcl").hexdigest(),
        },
    }
    record_path = tmp_path / "church_wukong_xc7a100t.provenance.json"
    record_path.write_text(json.dumps(provenance))
    return tmp_path, provenance, record_path


def test_approval_preserves_exact_image_and_elaboration_provenance(frozen_inputs):
    root, _, _ = frozen_inputs
    revision, _ = api._freeze_namespace_revision("test-freeze")
    (root / "boot-image.bin").write_bytes(b"new draft")
    (root / "church_wukong_xc7a100t.v").write_bytes(b"new compilation")
    stored = api._artifact_revision_store().read("namespace", revision)
    assert stored["metadata"]["approval_state"] == "approved"
    assert stored["files"]["boot-image.bin"] == hashlib.sha256(b"exact approved image").hexdigest()
    assert stored["files"]["church_wukong_xc7a100t.v"] == hashlib.sha256(b"verilog").hexdigest()


@pytest.mark.parametrize("changed", ["image", "verilog", "commit", "xdc"])
def test_approval_rejects_stale_elaboration_provenance(frozen_inputs, changed):
    root, provenance, record_path = frozen_inputs
    if changed == "image":
        (root / "boot-image.bin").write_bytes(b"changed")
    elif changed == "verilog":
        (root / "church_wukong_xc7a100t.v").write_bytes(b"changed")
    elif changed == "xdc":
        (root / "wukong_xc7a100t.xdc").write_bytes(b"changed")
    else:
        provenance["source_commit"] = "c" * 40
        record_path.write_text(json.dumps(provenance))
    with pytest.raises(ValueError, match="provenance"):
        api._freeze_namespace_revision("rejected-freeze")
    assert api._artifact_revision_store().history("namespace") == []


def test_latest_snapshot_returns_revision_and_history_is_read_only(frozen_inputs, monkeypatch):
    root, _, _ = frozen_inputs
    revision, _ = api._freeze_namespace_revision("test-freeze")
    snapshots = root / "snapshots"
    record = api._artifact_revision_store().read("namespace", revision)
    ns_map = {"tiers": {}}
    identity = api._namespace_revision_build_intent(ns_map, revision, record["metadata"])
    (snapshots / "build-approval-test.json").write_text(json.dumps({
        "namespace_revision_id": revision, "provenance_identity": identity,
        "ns_map": ns_map, "all_checks_pass": True}))
    client = api.app.test_client()
    headers = {"Authorization": "Bearer " + os.environ["REPORT_TOKEN"]}
    assert client.get("/api/build-approval/snapshot/latest", headers=headers).get_json()["namespace_revision_id"] == revision
    before = (root / "ns-state.json").read_bytes()
    response = client.get("/api/artifact-revisions/namespace/" + revision, headers=headers)
    assert response.status_code == 200
    assert response.get_json()["revision"]["metadata"]["approval_state"] == "approved"
    listed = client.get("/api/artifact-revisions/namespace", headers=headers).get_json()["revisions"]
    selected = listed[0]
    assert selected["build_intent_id"] == identity
    assert selected["snapshot_filename"] == "build-approval-test.json"
    assert response.get_json()["revision"]["build_intent_id"] == selected["build_intent_id"]
    assert client.post("/api/artifact-revisions/namespace/" + revision, json={
        "approval_state": "approved"}).status_code == 405
    assert (root / "ns-state.json").read_bytes() == before
    monkeypatch.setattr(api, "_ba_validate_build_auth", lambda: (True, None))
    monkeypatch.setattr(api, "_wukong_target_error", lambda _: (
        {"device_uid": "isolated-board", "bridge_session": "isolated-session"}, None))
    monkeypatch.setattr(api, "_ba_write_ssh_key", lambda: "isolated-key")
    monkeypatch.setattr(api, "_record_build_event", lambda **_: 123)
    monkeypatch.setattr(api, "_ba_build_done", True)
    monkeypatch.setattr(api, "_ba_build_log", [])
    monkeypatch.setattr(api, "_ba_build_version_context", {})
    monkeypatch.setattr(api.threading, "Thread", lambda **_: SimpleNamespace(start=lambda: None))
    started = client.post("/api/wukong-build/start", json={
        "build_intent_id": selected["build_intent_id"]}, headers=headers)
    assert started.status_code == 200, started.get_json()
    assert started.get_json()["provenance_identity"] == identity


@pytest.mark.parametrize("invalid", ["failed", "wrong-v2", "legacy", "unapproved"])
def test_history_does_not_advertise_unapproved_selection(frozen_inputs, invalid):
    root, _, _ = frozen_inputs
    revision, _ = api._freeze_namespace_revision("test-freeze")
    store = api._artifact_revision_store()
    record = store.read("namespace", revision)
    if invalid == "unapproved":
        metadata = dict(record["metadata"], approval_state="legacy-unverified")
        revision = store.publish("namespace", metadata, {"boot-image.bin": b"unapproved"})
        record = store.read("namespace", revision)
    ns_map = {"tiers": {}}
    identity = api._namespace_revision_build_intent(ns_map, revision, record["metadata"])
    if invalid == "wrong-v2":
        identity = "wukong-build-intent:v2:" + "0" * 64
    if invalid == "legacy":
        identity = "wukong-build-intent:v1:" + "0" * 64
    (root / "snapshots" / "build-approval-test.json").write_text(json.dumps({
        "namespace_revision_id": revision, "provenance_identity": identity,
        "ns_map": ns_map, "all_checks_pass": invalid != "failed"}))
    headers = {"Authorization": "Bearer " + os.environ["REPORT_TOKEN"]}
    response = api.app.test_client().get(
        "/api/artifact-revisions/namespace/" + revision, headers=headers)
    assert response.status_code == 200
    assert "build_intent_id" not in response.get_json()["revision"]
    assert "snapshot_filename" not in response.get_json()["revision"]


def test_unapproved_history_cannot_be_selected_as_build_authority(frozen_inputs, monkeypatch):
    root, _, _ = frozen_inputs
    store = api._artifact_revision_store()
    revision = store.publish("namespace", {
        "approval_state": "legacy-unverified", "source_commit": "a" * 40,
        "hardware_version": 17, "snapshot": {"fingerprint": "b" * 64}},
        {"boot-image.bin": b"legacy"})
    (root / "snapshots" / "build-approval-test.json").write_text(json.dumps({
        "namespace_revision_id": revision, "provenance_identity": "exact-intent",
        "all_checks_pass": True}))
    monkeypatch.setattr(api, "_ba_validate_build_auth", lambda: (True, None))
    monkeypatch.setattr(api, "_wukong_target_error", lambda _: ({}, None))
    monkeypatch.setattr(api, "_ba_write_ssh_key",
                        lambda: pytest.fail("Unapproved revision must not launch a worker"))
    response = api.app.test_client().post("/api/wukong-build/start", json={
        "build_intent_id": "exact-intent"})
    assert response.status_code == 422
    assert "not approved" in response.get_json()["error"]


@pytest.mark.parametrize("invalid", ["simulation", "missing-certificate", "bad-certificate"])
def test_simulation_approval_is_not_hardware_authority(frozen_inputs, monkeypatch, invalid):
    root, _, _ = frozen_inputs
    revision, _ = api._freeze_namespace_revision("hardware-freeze")
    store = api._artifact_revision_store()
    retained = store.read("namespace", revision)
    metadata = dict(retained["metadata"])
    files = {}
    for name in retained["files"]:
        with open(store.file_path("namespace", revision, name), "rb") as stream:
            files[name] = stream.read()
    if invalid == "simulation":
        # Even copying genuine retained hardware evidence cannot promote the
        # separate simulation approval purpose to hardware authority.
        metadata["purpose"] = "approved-simulation"
    elif invalid == "missing-certificate":
        files.pop("build-provenance.json")
    else:
        files["build-provenance.json"] = b'{"schema_version":1,"source_tree_clean":true}'
    selected = store.publish("namespace", metadata, files)
    ns_map = {"tiers": {}}
    identity = api._namespace_revision_build_intent(ns_map, selected, metadata)
    (root / "snapshots" / "build-approval-cross-kind.json").write_text(json.dumps({
        "namespace_revision_id": selected, "provenance_identity": identity,
        "all_checks_pass": True, "ns_map": ns_map}))
    client = api.app.test_client()
    history = client.get("/api/artifact-revisions/namespace/" + selected,
                         headers={"Authorization": "Bearer " + os.environ["REPORT_TOKEN"]})
    assert history.status_code == 200
    record = history.get_json()["revision"]
    assert record["hardware_certified"] is False
    assert "build_intent_id" not in record
    monkeypatch.setattr(api, "_ba_validate_build_auth", lambda: (True, None))
    monkeypatch.setattr(api, "_wukong_target_error", lambda _: ({}, None))
    monkeypatch.setattr(api, "_ba_write_ssh_key",
                        lambda: pytest.fail("No uncertified Namespace may launch a worker"))
    response = client.post("/api/wukong-build/start", json={"build_intent_id": identity})
    assert response.status_code == 422
    assert "Namespace" in response.get_json()["error"]


@pytest.mark.parametrize("policy", ["Lazy", "Dynamic", "Resident"])
def test_optional_missing_selected_bytes_do_not_block_hardware_approval(
        frozen_inputs, monkeypatch, policy):
    root, _, _ = frozen_inputs
    row = {"slot": 30, "name": "Selected.Missing", "load_policy": policy,
           "resident": True, "filename": "missing.lump", "binary_hash": "f" * 64}
    (root / "ns-state.json").write_text(json.dumps({"abstractions": [row]}))
    ns_map = {"slot_rules": [{"slot": 30, "load_policy": policy}]}
    monkeypatch.setattr(api, "_ba_build_ns_map", lambda: ns_map)
    if policy == "Resident":
        with pytest.raises(ValueError):
            api._freeze_namespace_revision("test-freeze", ns_map)
        return
    revision, _ = api._freeze_namespace_revision("test-freeze", ns_map)
    selected = api._artifact_revision_store().read("namespace", revision)["metadata"]["selected_lumps"]
    assert selected[0]["availability"] == "unavailable"
    assert selected[0]["filename"] == "missing.lump"
    assert selected[0]["binary_hash"] == "f" * 64
    assert selected[0]["reason"]


def test_exact_optional_bytes_retained_without_executable_admission(frozen_inputs, monkeypatch):
    root, _, _ = frozen_inputs
    data = b"optional selected bytes"
    digest = hashlib.sha256(data).hexdigest()
    (root / "optional.lump").write_bytes(data)
    monkeypatch.setattr(api, "LUMPS_DIR", str(root))
    monkeypatch.setattr(api, "_validate_namespace_selected_binary", lambda *args: None)
    monkeypatch.setattr(api._boot_image_gen, "_require_approved_executable_lump",
                        lambda *args: pytest.fail("Lazy bytes are not required executables"))
    (root / "ns-state.json").write_text(json.dumps({"abstractions": [{
        "slot": 30, "load_policy": "Lazy", "filename": "optional.lump",
        "binary_hash": digest, "token": "12345678"}]}))
    revision, _ = api._freeze_namespace_revision("test-freeze")
    record = api._artifact_revision_store().read("namespace", revision)
    assert record["files"][digest + ".lump"] == digest
    assert record["metadata"]["selected_lumps"][0]["availability"] == "retained"


def test_revision_download_is_exact_authenticated_and_does_not_activate(frozen_inputs, monkeypatch):
    root, _, _ = frozen_inputs
    namespace_revision, _ = api._freeze_namespace_revision("test-freeze")
    store = api._artifact_revision_store()
    metadata = {"approval_state": "approved", "namespace_revision_id": namespace_revision,
                "source_commit": "a" * 40, "hardware_version": 17, "build_record_id": 123}
    monkeypatch.setattr(api.db.session, "get", lambda *args: SimpleNamespace(
        status="succeeded", git_commit="a" * 40, hardware_version=17,
        bit_hash=hashlib.md5(b"approved old bit").hexdigest()))
    revision = store.publish("bitstream", metadata, {"bitstream.bit": b"approved old bit"})
    store.publish("bitstream", metadata, {"bitstream.bit": b"newer bit"})
    canonical = root / "church_wukong_xc7a100t.bit"
    canonical.write_bytes(b"active canonical bit")
    client = api.app.test_client()
    url = "/api/artifact-revisions/bitstream/" + revision + "/download"
    assert client.get(url).status_code == 401
    headers = {"Authorization": "Bearer " + os.environ["REPORT_TOKEN"]}
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    assert response.data == b"approved old bit"
    assert canonical.read_bytes() == b"active canonical bit"
    unapproved = store.publish("bitstream", dict(metadata, approval_state="unmatched"),
                               {"bitstream.bit": b"unapproved"})
    assert client.get("/api/artifact-revisions/bitstream/" + unapproved + "/download",
                      headers=headers).status_code == 409
    with open(store.file_path("bitstream", revision, "bitstream.bit"), "wb") as stream:
        stream.write(b"tampered")
    assert client.get(url, headers=headers).status_code == 409


def test_worker_retention_allows_first_explicit_upload_then_rejects_replay(
        frozen_inputs, monkeypatch):
    import io
    root, _, _ = frozen_inputs
    revision, snapshot = api._freeze_namespace_revision("test-freeze")
    snapshot = dict(snapshot, namespace_revision_id=revision)
    frozen = api._artifact_revision_store().read("namespace", revision)
    # Only the remote transport is stubbed; worker completion, DB and upload
    # binding run through production code against disposable storage.
    monkeypatch.setattr(api, "_isolated_build_payload", lambda _: (frozen, b"transport-fixture"))
    with api.app.app_context():
        record_id = api._record_build_event(
            board="wukong-xc7a100t", status="running", notes="approved_build",
            ns_snapshot=snapshot, hardware_version=17, git_commit="a" * 40)
    monkeypatch.setattr(api, "_ba_build_version_context", {
        "namespace_revision_id": revision, "source_commit": "a" * 40,
        "version": 17, "record_id": record_id})
    monkeypatch.setattr(api, "_ba_build_log", [])
    monkeypatch.setattr(api, "_wukong_build_dir", lambda: str(root / "private-build"))
    monkeypatch.setattr(api, "_bitstream_version_log_path", lambda: str(root / "history.json"))
    monkeypatch.setattr(api.time, "sleep", lambda _: None)
    artifact = b"remote verified bitstream"
    def remote(cmd, **kwargs):
        return SimpleNamespace(
            returncode=0, stderr="",
            stdout=(artifact if cmd[-1].startswith("cat ") else
                    "ARTIFACT_MD5_" + hashlib.md5(artifact).hexdigest()
                    + "\nARTIFACT_SHA256_" + hashlib.sha256(artifact).hexdigest()
                    + "\nEXIT_0\n"))
    monkeypatch.setattr(api.subprocess, "run", remote)
    api._ba_build_worker(str(root / "fake-key"))
    assert api._ba_build_exit == 0
    with api.app.app_context():
        record = api.db.session.get(api.BuildRecord, record_id)
        assert record.status == "succeeded"
        assert record.bit_path and os.path.isfile(record.bit_path)
        assert record.upload_completed_at is None
    client = api.app.test_client()
    headers = {"Authorization": "Bearer " + os.environ["REPORT_TOKEN"]}
    url = f"/upload/wukong-bit?version=17&commit={'a' * 40}&build_record_id={record_id}"
    def upload():
        return client.post(url, headers=headers, content_type="multipart/form-data",
                           data={"file": (io.BytesIO(artifact), "result.bit")})
    accepted = upload()
    assert accepted.status_code == 200, accepted.get_json()
    assert upload().status_code == 409
    with api.app.app_context():
        assert api.db.session.get(api.BuildRecord, record_id).upload_completed_at