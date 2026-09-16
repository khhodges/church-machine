import json

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
                "reason": "bootstrap-identity-invalid",
            }],
        }


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