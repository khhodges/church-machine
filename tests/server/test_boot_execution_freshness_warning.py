import json
import shutil
from contextlib import contextmanager
from pathlib import Path

import server.app as app_module


def _write_lump(directory, filename):
    (directory / filename).write_bytes(b"approved-or-compiled-body")


def _write_structural_lump(directory, filename, row0):
    words = [((31 << 27) | 1)] + [0] * 62 + [row0]
    (directory / filename).write_bytes(
        b"".join(word.to_bytes(4, "big") for word in words))


def test_execution_freshness_names_selected_and_latest_artifacts(tmp_path):
    _write_lump(tmp_path, "SelfTest.old.lump")
    _write_lump(tmp_path, "SelfTest.latest.lump")
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "SelfTest", "filename": "SelfTest.old.lump",
            "token": "4a000006", "lump_version": 86,
        },
        {
            "abstraction": "SelfTest", "filename": "SelfTest.latest.lump",
            "token": "4c35bef2", "lump_version": 87, "compiled_at": 200,
        },
    ]))
    state = {"abstractions": [{
        "name": "SelfTest", "slot": 6, "filename": "SelfTest.old.lump",
        "token": "4a000006", "lump_version": 86,
    }]}

    result = app_module._boot_execution_freshness(state, str(tmp_path))

    assert result["status"] == "stale"
    assert result["warnings"] == [{
        "abstraction": "SelfTest",
        "slot": 6,
        "selected": {
            "filename": "SelfTest.old.lump",
            "token": "4a000006",
            "version": 86,
        },
        "latest": {
            "filename": "SelfTest.latest.lump",
            "token": "4c35bef2",
            "version": 87,
            "compiledAt": 200,
        },
        "reason": "committed-boot-image-does-not-use-latest-compilation",
    }]


def test_execution_freshness_is_current_when_binding_matches_latest(tmp_path):
    _write_lump(tmp_path, "SelfTest.latest.lump")
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "abstraction": "SelfTest", "filename": "SelfTest.latest.lump",
        "token": "4a000006", "lump_version": 87, "compiled_at": 200,
    }]))
    state = {"abstractions": [{
        "name": "SelfTest", "slot": 6, "filename": "SelfTest.latest.lump",
        "token": "4a000006", "lump_version": 87,
    }]}

    assert app_module._boot_execution_freshness(
        state, str(tmp_path)) == {"status": "current", "warnings": []}


def test_execution_freshness_includes_newest_immutable_history_row(tmp_path):
    _write_lump(tmp_path, "Echo.current.lump")
    _write_lump(tmp_path, "Echo.history.lump")
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "Echo", "filename": "Echo.current.lump",
            "token": "00000001", "lump_version": 1, "compiled_at": 100,
        },
        {
            "abstraction": "Echo", "filename": "Echo.history.lump",
            "token": "00000002", "lump_version": 2, "compiled_at": 200,
            "archived": True,
        },
    ]))
    state = {"abstractions": [{
        "name": "Echo", "slot": 12, "filename": "Echo.current.lump",
        "token": "00000001", "lump_version": 1,
    }]}

    result = app_module._boot_execution_freshness(state, str(tmp_path))

    assert result["status"] == "stale"
    assert result["warnings"][0]["selected"]["token"] == "00000001"
    assert result["warnings"][0]["latest"]["token"] == "00000002"


def test_execution_freshness_excludes_bootstrap_identity_rejections(
        tmp_path, monkeypatch):
    import server.bootstrap_identity as bootstrap_identity

    expected_gt = 0x4A000006
    _write_structural_lump(tmp_path, "SelfTest.old.lump", expected_gt)
    _write_structural_lump(tmp_path, "SelfTest.rejected.lump", expected_gt)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "SelfTest", "filename": "SelfTest.old.lump",
            "token": "4a000006", "lump_version": 87, "compiled_at": 100,
        },
        {
            "abstraction": "SelfTest", "filename": "SelfTest.rejected.lump",
            "token": "4c35bef2", "lump_version": 88, "compiled_at": 200,
        },
    ]))
    state = {"abstractions": [{
        "name": "SelfTest", "slot": 6, "seq": 0,
        "filename": "SelfTest.old.lump",
        "token": "4a000006", "lump_version": 87,
    }]}
    monkeypatch.setattr(
        app_module,
        "_bootstrap_snapshot_identity",
        lambda _dir, entry, _inspected, **_kwargs: {
            "valid": entry["lump_version"] == 87,
        },
    )
    monkeypatch.setattr(
        bootstrap_identity, "resident_inform_egt",
        lambda _row: expected_gt,
    )

    assert app_module._boot_execution_freshness(
        state, str(tmp_path)) == {
            "status": "current",
            "warnings": [],
            "failedSaves": [{
                "abstraction": "SelfTest",
                "slot": 6,
                "token": "4c35bef2",
                "filename": "SelfTest.rejected.lump",
                "version": 88,
                "reason": "generated-artifact-identity-invalid",
                "owner": "ide",
                "currentToken": "4a000006",
                "archived": False,
            }],
        }


def test_execution_freshness_suppresses_rejected_history_superseded_by_valid_revision(
        tmp_path, monkeypatch):
    import server.bootstrap_identity as bootstrap_identity

    expected_gt = 0x4A000006
    _write_structural_lump(tmp_path, "SelfTest.v76.lump", expected_gt)
    _write_structural_lump(tmp_path, "SelfTest.v95.lump", expected_gt)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "SelfTest", "filename": "SelfTest.v76.lump",
            "token": "00000600", "lump_version": 76, "archived": True,
        },
        {
            "abstraction": "SelfTest", "filename": "SelfTest.v95.lump",
            "token": "4a000006", "lump_version": 95,
        },
    ]))
    state = {"abstractions": [{
        "name": "SelfTest", "slot": 6, "seq": 0,
        "filename": "SelfTest.v95.lump",
        "token": "4a000006", "lump_version": 95,
    }]}
    monkeypatch.setattr(
        app_module,
        "_bootstrap_snapshot_identity",
        lambda _dir, entry, _inspected, **_kwargs: {
            "valid": entry["lump_version"] == 95,
        },
    )
    monkeypatch.setattr(
        bootstrap_identity, "resident_inform_egt",
        lambda _row: expected_gt,
    )

    assert app_module._boot_execution_freshness(
        state, str(tmp_path)) == {"status": "current", "warnings": []}


def test_update_to_latest_is_retired_without_mutating_repository(tmp_path, monkeypatch):
    before = json.dumps({"abstractions": [{"name": "SelfTest", "slot": 6}]})
    (tmp_path / "ns-state.json").write_text(before)
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    response = app_module.app.test_client().post(
        "/api/boot-image/update-to-latest",
        json={"abstraction": "SelfTest", "token": "4c35bef2"},
    )
    assert response.status_code == 410
    body = response.get_json()
    assert body["selectionRequired"] is True
    assert body["dataChanged"] is False
    assert (tmp_path / "ns-state.json").read_text() == before


def test_prepare_run_defaults_to_latest_exact_saved_digest(tmp_path, monkeypatch):
    old = b"old-approved-body"
    latest = b"latest-approved-body"
    (tmp_path / "WukongCallHome.11.658e6ba8.lump").write_bytes(old)
    (tmp_path / "WukongCallHome.12.74c8ff97.lump").write_bytes(latest)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "WukongCallHome",
            "filename": "WukongCallHome.11.658e6ba8.lump",
            "token": "658e6ba8", "lump_version": 11, "compiled_at": 100,
        },
        {
            "abstraction": "WukongCallHome",
            "filename": "WukongCallHome.12.74c8ff97.lump",
            "token": "74c8ff97", "lump_version": 12, "compiled_at": 200,
        },
    ]))
    checked = []
    monkeypatch.setattr(
        app_module._boot_image_gen, "_require_approved_executable_lump",
        lambda path, *_args: checked.append(path))
    rows = [{
        "name": "WukongCallHome", "slot": 7, "boot": True,
        "resident": True, "boot_resident": True, "load_policy": "Resident",
        "filename": "WukongCallHome.11.658e6ba8.lump",
        "token": "658e6ba8", "lump_version": 11,
    }]

    old_row, selected = app_module._prepare_run_candidate(
        rows, str(tmp_path))

    assert old_row["lump_version"] == 11
    assert selected["filename"] == "WukongCallHome.12.74c8ff97.lump"
    assert selected["token"] == "74c8ff97"
    assert selected["binary_hash"] == __import__("hashlib").sha256(latest).hexdigest()
    assert "artifact_pin" not in selected
    assert checked == [str(tmp_path / selected["filename"])]


def test_prepare_run_exact_pin_keeps_older_revision(tmp_path, monkeypatch):
    filename = "WukongCallHome.11.658e6ba8.lump"
    (tmp_path / filename).write_bytes(b"old-approved-body")
    (tmp_path / "WukongCallHome.12.74c8ff97.lump").write_bytes(
        b"latest-approved-body")
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "WukongCallHome", "filename": filename,
            "token": "658e6ba8", "lump_version": 11, "compiled_at": 100,
        },
        {
            "abstraction": "WukongCallHome",
            "filename": "WukongCallHome.12.74c8ff97.lump",
            "token": "74c8ff97", "lump_version": 12, "compiled_at": 200,
        },
    ]))
    monkeypatch.setattr(
        app_module._boot_image_gen, "_require_approved_executable_lump",
        lambda *_args: None)
    rows = [{
        "name": "WukongCallHome", "slot": 7, "boot": True,
        "resident": True, "boot_resident": True, "load_policy": "Resident",
        "filename": filename, "token": "658e6ba8", "lump_version": 11,
    }]

    _, selected = app_module._prepare_run_candidate(rows, str(tmp_path), pin={
        "filename": filename, "token": "658e6ba8", "revision": 11,
    })

    assert selected["filename"] == filename
    assert selected["artifact_pin"]["revision"] == 11


def test_real_validator_binds_wukong_evidence_to_exact_digest(tmp_path):
    source = Path(app_module.LUMPS_DIR)
    for name in (
        "manifest.json", "approvals.json",
        "WukongCallHome.1.658e6ba8.lump",
        "WukongCallHome.1.74c8ff97.lump",
    ):
        shutil.copy2(source / name, tmp_path / name)
    row = json.loads((source / "ns-state.json").read_text())["abstractions"]
    row = next(item for item in row if item["name"] == "WukongCallHome")
    row["boot"] = True

    # The latest saved body is currently an IDE-generated identity rejection;
    # default Prepare/Run must report that real reason rather than silently
    # falling back or calling it a user security incident.
    try:
        app_module._prepare_run_candidate([row], str(tmp_path))
    except ValueError as exc:
        assert "IDE-generated identity" in str(exc)
    else:
        raise AssertionError("identity-invalid latest Wukong revision was accepted")

    # The exact older pinned digest still has its own valid admission record.
    _, selected = app_module._prepare_run_candidate([row], str(tmp_path), pin={
        "filename": "WukongCallHome.1.658e6ba8.lump",
        "token": "4a000007",
        "revision": 1,
    })
    assert selected["filename"] == "WukongCallHome.1.658e6ba8.lump"
    assert selected["binary_hash"] == row["binary_hash"]

    mutated_path = tmp_path / "WukongCallHome.1.658e6ba8.lump"
    mutated = bytearray(mutated_path.read_bytes())
    mutated[16] ^= 1
    mutated_path.write_bytes(mutated)
    try:
        app_module._prepare_run_candidate([row], str(tmp_path), pin={
            "filename": "WukongCallHome.1.658e6ba8.lump",
            "token": "4a000007", "revision": 1,
        })
    except ValueError as exc:
        assert "exact SHA-256" in str(exc)
    else:
        raise AssertionError("admission evidence transferred to mutated digest")


def test_prepare_run_updates_dependencies_and_preserves_per_row_pin(
        tmp_path, monkeypatch):
    bodies = {
        "Entry.old.lump": b"entry-old", "Entry.new.lump": b"entry-new",
        "Dep.old.lump": b"dep-old", "Dep.new.lump": b"dep-new",
    }
    for name, body in bodies.items():
        (tmp_path / name).write_bytes(body)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {"abstraction": "Entry", "filename": "Entry.old.lump",
         "token": "e1", "lump_version": 1, "compiled_at": 1},
        {"abstraction": "Entry", "filename": "Entry.new.lump",
         "token": "e2", "lump_version": 2, "compiled_at": 2},
        {"abstraction": "Dep", "filename": "Dep.old.lump",
         "token": "d1", "lump_version": 1, "compiled_at": 1},
        {"abstraction": "Dep", "filename": "Dep.new.lump",
         "token": "d2", "lump_version": 2, "compiled_at": 2},
    ]))
    monkeypatch.setattr(
        app_module._boot_image_gen, "_require_approved_executable_lump",
        lambda *_args: None)
    rows = [
        {"name": "Entry", "slot": 6, "boot": True,
         "filename": "Entry.old.lump", "token": "e1", "lump_version": 1,
         "binary_hash": __import__("hashlib").sha256(b"entry-old").hexdigest(),
         "test_results": {"runtime-suite": "pass"},
         "mtbf": {"status": "green"}},
        {"name": "Dep", "slot": 7, "filename": "Dep.old.lump",
         "token": "d1", "lump_version": 1,
         "artifact_pin": {
             "filename": "Dep.old.lump", "token": "d1", "revision": 1,
         }},
    ]

    prepared, changes = app_module._prepare_run_candidates(
        rows, str(tmp_path), boot_pin_supplied=True, boot_pin=None)

    assert prepared[0]["filename"] == "Entry.new.lump"
    assert "test_results" not in prepared[0]
    assert "mtbf" not in prepared[0]
    assert prepared[1]["filename"] == "Dep.old.lump"
    assert prepared[1]["artifact_pin"]["revision"] == 1
    assert [item["abstraction"] for item in changes] == ["Entry", "Dep"]


def _endpoint_fixture(tmp_path, monkeypatch):
    state_path = tmp_path / "ns-state.json"
    image_path = tmp_path / "boot-image.bin"
    provenance_path = tmp_path / "boot-image.provenance.json"
    rows = [{"name": "Entry", "slot": 6, "boot": True,
             "filename": "Entry.old.lump", "token": "e1",
             "lump_version": 1}]
    state_path.write_text(json.dumps({"abstractions": rows}, indent=2))
    image_path.write_bytes(b"previous-image")
    provenance_path.write_bytes(b"previous-provenance")
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(
        app_module, "BOOT_IMAGE_PROVENANCE_PATH", str(provenance_path))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 6}, None))
    monkeypatch.setattr(app_module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(app_module, "_load_boot_ns_lump", lambda: None)
    return rows, state_path, image_path, provenance_path


def test_prepare_run_endpoint_rolls_back_generation_failure_under_same_lock(
        tmp_path, monkeypatch):
    rows, state_path, image_path, provenance_path = _endpoint_fixture(
        tmp_path, monkeypatch)
    before = (state_path.read_bytes(), image_path.read_bytes(),
              provenance_path.read_bytes())
    lock_active = {"depth": 0}

    @contextmanager
    def guard():
        lock_active["depth"] += 1
        try:
            yield
        finally:
            lock_active["depth"] -= 1

    monkeypatch.setattr(app_module, "_namespace_commit_guard", guard)
    monkeypatch.setattr(
        app_module, "_prepare_run_candidates",
        lambda *_args, **_kwargs: (
            [dict(rows[0], filename="Entry.new.lump", token="e2")],
            [{"slot": 6, "abstraction": "Entry"}]))

    def fail_generation(*_args, **_kwargs):
        assert lock_active["depth"] > 0
        raise ValueError("dependency NS[7] is missing")

    monkeypatch.setattr(
        app_module._boot_image_gen, "generate_boot_image", fail_generation)
    fingerprint = app_module._namespace_state_fingerprint(rows)
    response = app_module.app.test_client().post(
        "/api/boot-image/generate",
        json={"prepareRun": True, "namespaceFingerprint": fingerprint})

    assert response.status_code == 409
    assert "dependency NS[7] is missing" in response.get_json()["error"]
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before
    assert lock_active["depth"] == 0


def test_prepare_run_endpoint_rolls_back_publication_failure(tmp_path, monkeypatch):
    rows, state_path, image_path, provenance_path = _endpoint_fixture(
        tmp_path, monkeypatch)
    before = (state_path.read_bytes(), image_path.read_bytes(),
              provenance_path.read_bytes())
    monkeypatch.setattr(
        app_module, "_prepare_run_candidates",
        lambda *_args, **_kwargs: (
            [dict(rows[0], filename="Entry.new.lump", token="e2")],
            [{"slot": 6, "abstraction": "Entry"}]))
    monkeypatch.setattr(
        app_module._boot_image_gen, "generate_boot_image",
        lambda *_args, **_kwargs: b"generated-image")

    def fail_publish(_blob):
        image_path.write_bytes(b"partial-new-image")
        provenance_path.write_bytes(b"partial-new-provenance")
        raise OSError("disk publication failed")

    monkeypatch.setattr(app_module, "_write_boot_image_bytes", fail_publish)
    response = app_module.app.test_client().post(
        "/api/boot-image/generate", json={
            "prepareRun": True,
            "namespaceFingerprint": app_module._namespace_state_fingerprint(rows),
        })

    assert response.status_code == 409
    assert "disk publication failed" in response.get_json()["error"]
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before


def test_prepare_run_endpoint_rejects_stale_cas_before_generation(
        tmp_path, monkeypatch):
    _rows, state_path, image_path, provenance_path = _endpoint_fixture(
        tmp_path, monkeypatch)
    before = (state_path.read_bytes(), image_path.read_bytes(),
              provenance_path.read_bytes())
    monkeypatch.setattr(
        app_module, "_prepare_run_candidates",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("candidate resolution must not run after stale CAS")))

    response = app_module.app.test_client().post(
        "/api/boot-image/generate", json={
            "prepareRun": True, "namespaceFingerprint": "stale",
        })

    assert response.status_code == 409
    assert response.get_json()["dataChanged"] is False
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before


def test_prepare_run_endpoint_uses_real_exact_digest_validator_for_pin(
        tmp_path, monkeypatch):
    source = Path(app_module.LUMPS_DIR)
    for name in (
        "manifest.json", "approvals.json",
        "WukongCallHome.1.658e6ba8.lump",
        "WukongCallHome.1.74c8ff97.lump",
    ):
        shutil.copy2(source / name, tmp_path / name)
    row = next(
        item for item in json.loads(
            (source / "ns-state.json").read_text())["abstractions"]
        if item["name"] == "WukongCallHome")
    row["boot"] = True
    state_path = tmp_path / "ns-state.json"
    image_path = tmp_path / "boot-image.bin"
    provenance_path = tmp_path / "boot-image.provenance.json"
    state_path.write_text(json.dumps({"abstractions": [row]}, indent=2))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(
        app_module, "BOOT_IMAGE_PROVENANCE_PATH", str(provenance_path))
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 7}, None))
    monkeypatch.setattr(
        app_module._boot_image_gen, "generate_boot_image",
        lambda *_args, **_kwargs: b"generated-image")
    monkeypatch.setattr(
        app_module, "_write_boot_image_bytes",
        lambda blob: image_path.write_bytes(blob))
    monkeypatch.setattr(
        app_module, "_boot_image_preparation_status",
        lambda *_args: {"status": "prepared"})
    monkeypatch.setattr(app_module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(app_module, "_load_boot_ns_lump", lambda: None)

    response = app_module.app.test_client().post(
        "/api/boot-image/generate", json={
            "prepareRun": True,
            "namespaceFingerprint": app_module._namespace_state_fingerprint([row]),
            "artifactPin": {
                "filename": "WukongCallHome.1.658e6ba8.lump",
                "token": "4a000007",
                "revision": 1,
            },
        })

    assert response.status_code == 200, response.get_json()
    assert response.get_json()["selection"]["pinned"] is True
    assert response.get_json()["selection"]["filename"].endswith(
        "658e6ba8.lump")
    assert image_path.read_bytes() == b"generated-image"