"""Atomic history-transition coverage for save, WIP, and fork persistence."""

import json
import os
import sys
import threading
from unittest.mock import patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module


@pytest.fixture()
def isolated_lumps(tmp_path, monkeypatch):
    lumps_dir = tmp_path / "lumps"
    lumps_dir.mkdir()
    manifest_path = lumps_dir / "manifest.json"
    manifest_path.write_text("[]")
    monkeypatch.setattr(_app_module, "LUMPS_DIR", str(lumps_dir))
    monkeypatch.setattr(_app_module, "LUMPS_MANIFEST_PATH", str(manifest_path))
    monkeypatch.setattr(_app_module, "_LUMPS_DIR", str(lumps_dir))
    return lumps_dir


def _current_record(token="a70f0001", version=4):
    binary_name = "Atomic.Example.1.a70f0001.lump"
    sidecar_name = "Atomic.Example.1.a70f0001.json"
    sidecar = {
        "token": token,
        "abstraction": "Atomic.Example",
        "filename": binary_name,
        "sidecar_file": sidecar_name,
        "lump_version": version,
        "cw": 1,
        "cc": 1,
    }
    manifest_entry = {
        "token": token,
        "abstraction": "Atomic.Example",
        "filename": binary_name,
        "sidecar_file": sidecar_name,
        "lump_version": version,
        "cw": 1,
        "cc": 1,
    }
    return binary_name, sidecar_name, sidecar, manifest_entry


def test_mid_commit_failure_restores_current_pair_and_manifest(isolated_lumps):
    token = "a70f0001"
    binary_name, sidecar_name, old_sidecar, old_entry = _current_record(token)
    old_binary = b"prior canonical bytes"
    (isolated_lumps / binary_name).write_bytes(old_binary)
    (isolated_lumps / sidecar_name).write_text(json.dumps(old_sidecar, indent=2))
    manifest_path = isolated_lumps / "manifest.json"
    manifest_path.write_text(json.dumps([old_entry], indent=2))
    old_manifest_bytes = manifest_path.read_bytes()

    new_sidecar = dict(old_sidecar, lump_version=5)
    new_entry = dict(old_entry, lump_version=5)
    real_replace = os.replace
    failed = False

    def fail_manifest_commit_once(source, destination):
        nonlocal failed
        if (
            not failed
            and os.path.abspath(destination) == os.path.abspath(manifest_path)
            and os.path.basename(source).startswith(".lump-transition-")
        ):
            failed = True
            raise OSError("simulated manifest commit failure")
        return real_replace(source, destination)

    with patch.object(_app_module.os, "replace", side_effect=fail_manifest_commit_once):
        with pytest.raises(OSError, match="simulated manifest commit failure"):
            _app_module._commit_lump_history_transition(
                lumps_dir=str(isolated_lumps),
                manifest_path=str(manifest_path),
                token8=token,
                manifest_entry=new_entry,
                binary_filename=binary_name,
                binary_bytes=b"replacement bytes",
                sidecar_filename=sidecar_name,
                sidecar=new_sidecar,
                archive_stem="Atomic.Example",
                archive_version=4,
                archive_binary_path=str(isolated_lumps / binary_name),
                archive_sidecar=old_sidecar,
            )

    assert (isolated_lumps / binary_name).read_bytes() == old_binary
    assert json.loads((isolated_lumps / sidecar_name).read_text()) == old_sidecar
    assert manifest_path.read_bytes() == old_manifest_bytes
    assert not (isolated_lumps / "Atomic.Example_v4.lump").exists()
    assert not (isolated_lumps / "Atomic.Example_v4.json").exists()


def test_fork_skips_existing_archive_and_updates_manifest(isolated_lumps):
    token = "a70f0002"
    binary_name, sidecar_name, sidecar, entry = _current_record(token, version=4)
    binary_name = binary_name.replace("a70f0001", token)
    sidecar_name = sidecar_name.replace("a70f0001", token)
    sidecar.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    entry.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    current_bytes = b"fork source"
    (isolated_lumps / binary_name).write_bytes(current_bytes)
    (isolated_lumps / sidecar_name).write_text(json.dumps(sidecar, indent=2))
    (isolated_lumps / "manifest.json").write_text(json.dumps([entry], indent=2))

    old_archive = b"immutable version four"
    (isolated_lumps / "Atomic.Example.1.a70f0002_v4.lump").write_bytes(old_archive)
    (isolated_lumps / "Atomic.Example.1.a70f0002_v4.json").write_text(
        json.dumps({"archived_version": 4})
    )

    response = _app_module.app.test_client().post(
        f"/api/lump/{token}/fork-version"
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json() == {
        "ok": True,
        "new_version": 6,
        "prev_version": 5,
    }
    assert (
        isolated_lumps / "Atomic.Example.1.a70f0002_v4.lump"
    ).read_bytes() == old_archive
    assert (
        isolated_lumps / "Atomic.Example.1.a70f0002_v5.lump"
    ).read_bytes() == current_bytes

    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    assert manifest[0]["lump_version"] == 6
    assert manifest[0]["forked"] is True
    live_sidecar = json.loads((isolated_lumps / sidecar_name).read_text())
    assert live_sidecar["lump_version"] == 6
    assert live_sidecar["forked"] is True


def test_wip_uses_shared_transition_and_preserves_response_contract(
    isolated_lumps, monkeypatch
):
    calls = []
    real_transition = _app_module._commit_lump_history_transition

    def record_transition(**kwargs):
        calls.append(kwargs["token8"])
        return real_transition(**kwargs)

    monkeypatch.setattr(
        _app_module, "_commit_lump_history_transition", record_transition
    )
    response = _app_module.app.test_client().post(
        "/api/lumps/save-wip",
        json={
            "name": "WipAtomic",
            "source": "abstraction WipAtomic {}",
            "methods": [{"name": "Run"}],
        },
    )
    body = response.get_json()
    assert response.status_code == 200, response.get_data(as_text=True)
    assert body == {
        "ok": True,
        "token": body["token"],
        "version": 1,
        "filename": "WipAtomic_v1.lump",
        "sidecar": "WipAtomic_v1.json",
        "status": "wip",
    }
    assert calls == [body["token"]]
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    assert manifest[0]["filename"] == body["filename"]
    assert manifest[0]["sidecar_file"] == body["sidecar"]


def test_compiled_save_keeps_prior_wip_pair_as_immutable_history(isolated_lumps):
    token = "a70f0003"
    client = _app_module.app.test_client()
    wip = client.post(
        "/api/lumps/save-wip",
        json={
            "name": "WipToSave",
            "token": token,
            "source": "abstraction WipToSave {}",
            "methods": [{"name": "Run"}],
        },
    )
    assert wip.status_code == 200
    old_lump = isolated_lumps / "WipToSave_v1.lump"
    old_sidecar = isolated_lumps / "WipToSave_v1.json"
    old_bytes = old_lump.read_bytes()

    words = [0] * 64
    words[0] = (0x1F << 27) | (1 << 10) | 1
    words[1] = 0x1F000000
    saved = client.post(
        "/api/lumps/save",
        json={
            "binary": words,
            "metadata": {
                "token": token,
                "abstraction": "WipToSave",
                "methods": [{"name": "Run", "offset": 0, "length": 1}],
                "capabilities": [],
                "grants": ["E"],
            },
        },
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()["lump_version"] == 2
    assert old_lump.is_file() and not old_lump.is_symlink()
    assert old_lump.read_bytes() == old_bytes
    archived_sidecar = json.loads(old_sidecar.read_text())
    assert archived_sidecar["archived_version"] == 1
    assert archived_sidecar["filename"] == "WipToSave_v1.lump"


def test_fork_of_wip_preserves_version_one_and_advances_to_two(isolated_lumps):
    token = "a70f0004"
    client = _app_module.app.test_client()
    wip = client.post(
        "/api/lumps/save-wip",
        json={
            "name": "WipToFork",
            "token": token,
            "source": "abstraction WipToFork {}",
            "methods": [{"name": "Run"}],
        },
    )
    assert wip.status_code == 200
    archive_lump = isolated_lumps / "WipToFork_v1.lump"
    archive_sidecar = isolated_lumps / "WipToFork_v1.json"
    old_bytes = archive_lump.read_bytes()
    old_sidecar = archive_sidecar.read_bytes()

    forked = client.post(f"/api/lump/{token}/fork-version")
    assert forked.status_code == 200, forked.get_data(as_text=True)
    assert forked.get_json() == {
        "ok": True,
        "new_version": 2,
        "prev_version": 1,
    }
    assert archive_lump.read_bytes() == old_bytes
    assert archive_sidecar.read_bytes() == old_sidecar
    assert (isolated_lumps / f"{token}.lump").read_bytes() == old_bytes
    live_sidecar = json.loads((isolated_lumps / f"{token}.json").read_text())
    assert live_sidecar["forked"] is True
    assert live_sidecar["lump_version"] == 2
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    assert manifest[0]["filename"] == f"{token}.lump"
    assert manifest[0]["sidecar_file"] == f"{token}.json"
    assert manifest[0]["lump_version"] == 2


def test_dangling_archive_symlink_is_never_overwritten(isolated_lumps):
    token = "a70f0005"
    binary_name, sidecar_name, sidecar, entry = _current_record(token, version=4)
    binary_name = binary_name.replace("a70f0001", token)
    sidecar_name = sidecar_name.replace("a70f0001", token)
    sidecar.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    entry.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    (isolated_lumps / binary_name).write_bytes(b"current")
    (isolated_lumps / sidecar_name).write_text(json.dumps(sidecar))
    (isolated_lumps / "manifest.json").write_text(json.dumps([entry]))
    dangling = isolated_lumps / "Atomic.Example.1.a70f0005_v4.lump"
    dangling.symlink_to("missing-archive-target.lump")

    response = _app_module.app.test_client().post(
        f"/api/lump/{token}/fork-version"
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["prev_version"] == 5
    assert dangling.is_symlink()
    assert os.readlink(dangling) == "missing-archive-target.lump"
    assert (
        isolated_lumps / "Atomic.Example.1.a70f0005_v5.lump"
    ).read_bytes() == b"current"


def test_concurrent_forks_are_idempotent(isolated_lumps, monkeypatch):
    token = "a70f0006"
    binary_name, sidecar_name, sidecar, entry = _current_record(token, version=2)
    binary_name = binary_name.replace("a70f0001", token)
    sidecar_name = sidecar_name.replace("a70f0001", token)
    sidecar.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    entry.update({
        "token": token,
        "filename": binary_name,
        "sidecar_file": sidecar_name,
    })
    (isolated_lumps / binary_name).write_bytes(b"one current generation")
    (isolated_lumps / sidecar_name).write_text(json.dumps(sidecar))
    (isolated_lumps / "manifest.json").write_text(json.dumps([entry]))

    barrier = threading.Barrier(2, timeout=10)
    real_transition = _app_module._commit_lump_history_transition

    def synchronize_stale_callers(**kwargs):
        barrier.wait()
        return real_transition(**kwargs)

    monkeypatch.setattr(
        _app_module,
        "_commit_lump_history_transition",
        synchronize_stale_callers,
    )
    responses = []

    def fork_once():
        with _app_module.app.test_client() as client:
            response = client.post(f"/api/lump/{token}/fork-version")
            responses.append((response.status_code, response.get_json()))

    first = threading.Thread(target=fork_once)
    second = threading.Thread(target=fork_once)
    first.start()
    second.start()
    first.join(timeout=15)
    second.join(timeout=15)

    assert sorted(status for status, _ in responses) == [200, 200]
    assert all(body["new_version"] == 3 for _, body in responses)
    assert all(body["prev_version"] == 2 for _, body in responses)
    assert sum(bool(body.get("already_forked")) for _, body in responses) == 1
    assert (isolated_lumps / "Atomic.Example.1.a70f0006_v2.lump").is_file()
    assert not (isolated_lumps / "Atomic.Example.1.a70f0006_v3.lump").exists()