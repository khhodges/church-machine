"""Direct DELETE tests execute production functions against private temp archives."""
import hashlib
import json
import os
from contextlib import contextmanager

import pytest

from tests.server.test_history_retention_policy import retention_app


def delete(app, version=1, **payload):
    return app.test_client().delete(f"/history/12345678/{version}", json=payload)


def test_manual_delete_recent_revision_preserves_evidence(tmp_path, retention_app):
    app, env, rows = retention_app
    approvals = '{"approval":"permanent evidence"}'
    sidecar = '{"filename":"Example_v7.lump"}'
    (tmp_path / "approvals.json").write_text(approvals)
    (tmp_path / "Example_v7.json").write_text(sidecar)
    response = delete(app, 7)
    assert response.status_code == 200
    assert not (tmp_path / "Example_v7.lump").exists()
    assert (tmp_path / "Example.lump").read_bytes() == b"live"
    assert (tmp_path / "approvals.json").read_text() == approvals
    assert (tmp_path / "Example_v7.json").read_text() == sidecar
    entry = json.loads((tmp_path / "history-retention.json").read_text())["12345678"][0]
    assert entry["trigger"] == "manual"
    assert entry["version"] == 7
    assert "policy" not in entry
    assert entry["binary_hash"] == hashlib.sha256(bytes([7]) * 256).hexdigest()


@pytest.mark.parametrize("reference", [
    "namespace", "frozen_name", "frozen_hash", "historical_token",
    "live_alias", "hardlink", "symlink", "incoming_symlink",
    "corrupt", "external_config", "linked_directory",
])
def test_manual_delete_protects_references(tmp_path, retention_app, reference):
    app, env, rows = retention_app
    archive = tmp_path / "Example_v1.lump"
    manifest_path = tmp_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if reference == "namespace":
        (tmp_path / "ns-state.json").write_text('{"filename":"Example_v1.lump"}')
    elif reference.startswith("frozen"):
        frozen = tmp_path.parent / (tmp_path.name + "-frozen")
        frozen.mkdir()
        env["_BUILD_SNAPSHOTS_DIR"] = str(frozen)
        value = archive.name if reference == "frozen_name" else hashlib.sha256(archive.read_bytes()).hexdigest()
        (frozen / "revision.json").write_text(json.dumps({"selected": value}))
    elif reference == "historical_token":
        manifest.append(dict(archived=True, filename=archive.name, token="87654321",
                             abstraction="Example", lump_version=1))
        (tmp_path / "ns-state.json").write_text('{"token":"87654321"}')
    elif reference == "live_alias":
        manifest.append(dict(filename=archive.name, token="87654321"))
    elif reference == "hardlink":
        os.link(archive, tmp_path / "another-name")
    elif reference == "symlink":
        archive.unlink()
        archive.symlink_to("Example.lump")
    elif reference == "incoming_symlink":
        (tmp_path / "incoming.lump").symlink_to(archive.name)
    elif reference == "corrupt":
        (tmp_path / "ns-state.json").write_text("{")
    elif reference == "external_config":
        external = tmp_path.parent / (tmp_path.name + "-config.json")
        external.write_text(json.dumps({"selected": archive.name}))
        env["BOOT_CONFIG_PATH"] = str(external)
    elif reference == "linked_directory":
        (tmp_path / "linked").symlink_to(tmp_path, target_is_directory=True)
    manifest_path.write_text(json.dumps(manifest))
    before = archive.read_bytes()
    response = delete(app)
    assert response.status_code == 409, response.json
    assert archive.read_bytes() == before
    assert json.loads(manifest_path.read_text()) == manifest
    assert not (tmp_path / ".history-retention-pending.json").exists()


@pytest.mark.parametrize("stage", ["before_unlink", "after_unlink", "manifest", "ledger"])
def test_manual_interruption_recovers_on_next_authorized_delete(
        tmp_path, retention_app, monkeypatch, stage):
    from server import history_retention as retention
    app, env, rows = retention_app
    manifest_path = tmp_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.append(dict(archived=True, filename="Example_v1.lump",
                         abstraction="Example", lump_version=1))
    manifest_path.write_text(json.dumps(manifest))
    original_remove, original_write = os.remove, retention.durable_json

    def remove(path):
        if stage == "before_unlink":
            raise OSError("interrupted")
        original_remove(path)
        if stage == "after_unlink":
            raise OSError("interrupted")

    def write(path, value):
        original_write(path, value)
        if path.name == {"manifest": "manifest.json", "ledger": retention.LEDGER}.get(stage):
            raise OSError("interrupted")

    with monkeypatch.context() as patch:
        patch.setattr(os, "remove", remove)
        patch.setattr(retention, "durable_json", write)
        assert delete(app).status_code == 500
    assert (tmp_path / retention.JOURNAL).exists()
    if stage == "before_unlink":
        (tmp_path / "new-reference.json").write_text('{"selected":"Example_v1.lump"}')
        assert delete(app).status_code == 409
        assert (tmp_path / "Example_v1.lump").exists()
    else:
        assert delete(app).status_code == 404
        assert delete(app).status_code == 404
        ledger = json.loads((tmp_path / retention.LEDGER).read_text())
        assert len(ledger["12345678"]) == 1
        assert ledger["12345678"][0]["trigger"] == "manual"
        assert not any(row.get("filename") == "Example_v1.lump"
                       for row in json.loads(manifest_path.read_text()))
    assert not (tmp_path / retention.JOURNAL).exists()


def test_manual_reference_check_runs_under_transition_lock(tmp_path, retention_app):
    app, env, rows = retention_app
    original = env["_lump_history_transition_lock"]

    @contextmanager
    def concurrent_namespace_save(root):
        with original(root):
            (tmp_path / "ns-state.json").write_text('{"selected":"Example_v1.lump"}')
            yield

    env["_lump_history_transition_lock"] = concurrent_namespace_save
    assert delete(app).status_code == 409
    assert (tmp_path / "Example_v1.lump").exists()


@pytest.mark.parametrize("ledger", ["[]", '{"12345678":[null]}', "{"])
def test_invalid_ledger_blocks_manual_delete(tmp_path, retention_app, ledger):
    app, env, rows = retention_app
    (tmp_path / "history-retention.json").write_text(ledger)
    assert delete(app).status_code == 409
    assert (tmp_path / "Example_v1.lump").exists()


def test_manual_cannot_delete_live_or_unrelated_artifact(tmp_path, retention_app):
    app, env, rows = retention_app
    (tmp_path / "Other.lump").write_bytes(b"other")
    assert delete(app, archive_filename="Example.lump").status_code == 409
    assert delete(app, archive_filename="Other.lump").status_code == 404
    assert delete(app, archive_filename="../Other.lump").status_code == 400
    assert (tmp_path / "Other.lump").read_bytes() == b"other"