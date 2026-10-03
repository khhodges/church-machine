import hashlib
import json
import shutil
import copy
from contextlib import contextmanager
from pathlib import Path

import pytest

import server.app as app_module


def _write_lump(directory, filename):
    (directory / filename).write_bytes(b"approved-or-compiled-body")


def _write_structural_lump(directory, filename, row0):
    words = [((31 << 27) | 1)] + [0] * 62 + [row0]
    (directory / filename).write_bytes(
        b"".join(word.to_bytes(4, "big") for word in words))


@pytest.fixture(params=[0xA207ECD1, 0x4A00000A])
def compiler_freshness_catalog(tmp_path, monkeypatch, request):
    from server.lump_approvals import (
        configured_compiler_tcb_key, sign_compiler_record, write_approvals,
    )

    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "freshness-fixture-" + "x" * 32)
    binding = {
        "name": "CapabilityTest", "slot": 10, "seq": 0, "boot": True,
        "resident": True, "boot_resident": True, "type": "Inform",
        "load_policy": "Resident", "ns_slot_policy": "static",
    }
    entries = []
    approvals = {}
    for version, token, row0 in (
            (34, "4a00000a", 0x4A00000A),
            (39, "a207ecd1", request.param)):
        filename = f"CapabilityTest.1.{version:08x}.lump"
        words = [(31 << 27) | (1 << 10) | 1, 0x1F000000] + [0] * 61 + [row0]
        raw = b"".join(word.to_bytes(4, "big") for word in words)
        (tmp_path / filename).write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        entries.append({
            "abstraction": "CapabilityTest", "filename": filename,
            "token": token, "lump_version": version, "binary_hash": digest,
            # Imported history may have a later timestamp than a new revision.
            "compiled_at": 900 if version == 34 else 100,
            "archived": version == 34,
        })
        if version == 39:
            approvals[digest] = {
                "binary_hash": digest, "filename": filename,
                "dot_name": "CapabilityTest", "issue_n": 1,
                "trust_origin": "trusted-home-ide",
                "compiler_identity": "CLOOMC", "compiler_version": "fixture",
                "compiler_record": sign_compiler_record(
                    {"binary_hash": digest},
                    signing_key=configured_compiler_tcb_key()),
            }
    state = {"abstractions": [{**binding, **{
        key: value for key, value in entries[1].items()
        if key not in ("abstraction", "archived", "compiled_at")
    }}]}
    (tmp_path / "manifest.json").write_text(json.dumps(entries))
    (tmp_path / "ns-state.json").write_text(json.dumps(state))
    write_approvals(str(tmp_path / "approvals.json"), approvals)
    return state, entries


@pytest.mark.parametrize("selected_version", [34, 39])
def test_freshness_compiler_revision_and_exact_pin_are_informational(
        tmp_path, compiler_freshness_catalog, selected_version):
    state, entries = compiler_freshness_catalog
    selected = next(row for row in entries if row["lump_version"] == selected_version)
    state["abstractions"][0].update({
        key: selected[key] for key in
        ("filename", "token", "lump_version", "binary_hash")
    })
    state["abstractions"][0]["artifact_pin"] = {
        "filename": selected["filename"], "token": selected["token"],
        "revision": selected_version,
    }
    before = copy.deepcopy(state)
    files = {path.name: path.read_bytes() for path in tmp_path.iterdir()}

    result = app_module._boot_execution_freshness(state, str(tmp_path))

    if selected_version == 39:
        assert result == {"status": "current", "warnings": []}
    else:
        assert result["status"] == "stale"
        assert result["warnings"][0]["selected"]["version"] == 34
        assert result["warnings"][0]["latest"]["version"] == 39
    assert state == before
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == files


@pytest.mark.parametrize("defect", ["signature", "bytes", "name"])
def test_freshness_rejects_inexact_compiler_evidence(
        tmp_path, compiler_freshness_catalog, defect):
    state, entries = compiler_freshness_catalog
    entry = entries[1]
    ledger_path = tmp_path / "approvals.json"
    ledger = json.loads(ledger_path.read_text())
    approval = ledger["approvals"][entry["binary_hash"]]
    if defect == "signature":
        approval["compiler_record"]["signature"] = "0" * 64
    elif defect == "name":
        approval["dot_name"] = "Other"
    else:
        path = tmp_path / entry["filename"]
        raw = bytearray(path.read_bytes())
        raw[8] ^= 1
        path.write_bytes(raw)
    ledger_path.write_text(json.dumps(ledger))
    state["abstractions"][0].update({
        key: entries[0][key] for key in
        ("filename", "token", "lump_version", "binary_hash")
    })

    result = app_module._boot_execution_freshness(state, str(tmp_path))
    assert result["status"] == "current"
    assert result["warnings"] == []


def test_freshness_retains_invalid_bootstrap_history_diagnostic(
        tmp_path, compiler_freshness_catalog):
    state, entries = compiler_freshness_catalog
    _write_structural_lump(tmp_path, "CapabilityTest.v40.lump", 0x4A00000A)
    entries.append({
        "abstraction": "CapabilityTest", "filename": "CapabilityTest.v40.lump",
        "token": "00000600", "lump_version": 40, "archived": True,
    })
    (tmp_path / "manifest.json").write_text(json.dumps(entries))

    result = app_module._boot_execution_freshness(state, str(tmp_path))

    assert result["status"] == "current"
    assert result["warnings"] == []
    assert result["failedSaves"][0]["version"] == 40
    assert result["failedSaves"][0]["reason"] == "generated-artifact-identity-invalid"


def test_freshness_ranks_valid_bootstrap_history_by_revision(
        tmp_path, compiler_freshness_catalog):
    state, entries = compiler_freshness_catalog
    _write_structural_lump(tmp_path, "CapabilityTest.v40.lump", 0x4A00000A)
    entries.append({
        "abstraction": "CapabilityTest", "filename": "CapabilityTest.v40.lump",
        "token": "4a00000a", "lump_version": 40, "archived": True,
    })
    (tmp_path / "manifest.json").write_text(json.dumps(entries))
    before = copy.deepcopy(state)

    result = app_module._boot_execution_freshness(state, str(tmp_path))

    assert result["status"] == "stale"
    assert result["warnings"][0]["latest"]["version"] == 40
    assert state == before


def test_prepare_generate_reports_selected_compiler_revision_current(
        tmp_path, monkeypatch, compiler_freshness_catalog):
    state, entries = compiler_freshness_catalog
    # Exercise the response after reviewed preparation with real exact-pin
    # resolution and compiler admission; isolate image generation/publication.
    _endpoint_fixture(tmp_path, monkeypatch)
    rows = state["abstractions"]
    (tmp_path / "ns-state.json").write_text(json.dumps(state))
    monkeypatch.setattr(app_module, "_read_saved_boot_config",
                        lambda: ({"bootEntrySlot": 10}, None))
    monkeypatch.setattr(app_module, "_stage_prepare_run_boot_image",
                        lambda *_args: b"prepared-fixture")
    monkeypatch.setattr(app_module, "_write_ns_state",
                        lambda *_args, **_kwargs: None)
    monkeypatch.setattr(app_module, "_write_boot_image_bytes", lambda *_args: None)
    monkeypatch.setattr(app_module, "_boot_image_preparation_status",
                        lambda *_args: {"status": "prepared"})
    response = app_module.app.test_client().post(
        "/api/boot-image/generate", json={
            "prepareRun": True,
            "namespaceFingerprint": app_module._namespace_state_fingerprint(rows),
            "artifactPin": {
                "filename": entries[1]["filename"], "token": entries[1]["token"],
                "revision": 39,
            },
        })
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["selection"]["revision"] == 39
    assert body["selection"]["pinned"] is True
    assert body["executionFreshness"] == {"status": "current", "warnings": []}


def test_namespace_response_recovers_exact_legacy_catalog_versions(tmp_path):
    ethernet = b"exact Ethernet saved artifact"
    capability = b"exact CapabilityTest saved artifact"
    (tmp_path / "Ethernet.1.b169bba4.lump").write_bytes(ethernet)
    (tmp_path / "CapabilityTest.1.39f77d6e.lump").write_bytes(capability)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "abstraction": "Ethernet",
            "filename": "Ethernet.1.b169bba4.lump",
            "token": "b169bba4",
            "lump_version": 0,
        },
        {
            "abstraction": "CapabilityTest",
            "filename": "CapabilityTest.1.39f77d6e.lump",
            "token": "4a00000a",
            "lump_version": 34,
        },
        {
            "abstraction": "CapabilityTest",
            "filename": "CapabilityTest.history.lump",
            "token": "4a00000a",
            "lump_version": 35,
            "archived": True,
        },
    ]))
    (tmp_path / "CapabilityTest.history.lump").write_bytes(b"newer history")
    state = {"abstractions": [
        {"name": "Ethernet", "slot": 9},
        {
            "name": "CapabilityTest",
            "slot": 10,
            "filename": "CapabilityTest.1.39f77d6e.lump",
            "token": "4a00000a",
            "binary_hash": hashlib.sha256(capability).hexdigest(),
        },
    ]}

    resolved = app_module._resolve_namespace_saved_artifacts(
        state, str(tmp_path))

    ethernet_row, capability_row = resolved["abstractions"]
    assert ethernet_row["lump_version"] == 0
    assert ethernet_row["filename"] == "Ethernet.1.b169bba4.lump"
    assert ethernet_row["binary_hash"] == hashlib.sha256(ethernet).hexdigest()
    assert capability_row["lump_version"] == 34
    assert capability_row["filename"] == "CapabilityTest.1.39f77d6e.lump"
    assert state["abstractions"][0] == {"name": "Ethernet", "slot": 9}


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


def test_prepare_run_keeps_namespace_selected_exact_saved_digest(tmp_path, monkeypatch):
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
        "binary_hash": hashlib.sha256(old).hexdigest(),
    }]

    old_row, selected = app_module._prepare_run_candidate(
        rows, str(tmp_path))

    assert old_row["lump_version"] == 11
    assert selected["filename"] == "WukongCallHome.11.658e6ba8.lump"
    assert selected["token"] == "658e6ba8"
    assert selected["binary_hash"] == hashlib.sha256(old).hexdigest()
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
    # Self-contained immutable bootstrap fixture: never depend on the user's
    # accumulating live history or canonical-filename aliases.
    import struct
    filename = "WukongCallHome.1.658e6ba8.lump"
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                      *([0] * 62), 0x4A000007)
    (tmp_path / filename).write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {digest: {
            "filename": filename, "binary_hash": digest,
            "dot_name": "WukongCallHome", "issue_n": 1,
            "bootstrap_t": "4a000007", "bootstrap_runtime_gt": 0x4A000007,
        }},
    }))
    (tmp_path / "manifest.json").write_text(json.dumps([
        {"abstraction": "WukongCallHome", "filename": filename,
         "token": "4a000007", "lump_version": 1},
        {"abstraction": "WukongCallHome", "filename": "Newer.2.12345678.lump",
         "token": "12345678", "lump_version": 2},
    ]))
    row = {"name": "WukongCallHome", "slot": 7, "boot": True,
           "resident": True, "boot_resident": True, "load_policy": "Resident",
           "type": "Inform", "ns_slot_policy": "static", "seq": 0}

    # Preparation consumes exactly the reviewed bytes, not an unrelated newer
    # compilation (even when that newer revision lacks valid admission).
    row.update(filename="WukongCallHome.1.658e6ba8.lump", token="4a000007",
               lump_version=1, binary_hash=hashlib.sha256(
                   (tmp_path / "WukongCallHome.1.658e6ba8.lump").read_bytes()).hexdigest())
    _, exact = app_module._prepare_run_candidate([row], str(tmp_path))
    assert exact["filename"] == row["filename"]

    # The exact older pinned digest still has its own valid admission record.
    _, selected = app_module._prepare_run_candidate([row], str(tmp_path), pin={
        "filename": "WukongCallHome.1.658e6ba8.lump",
        "token": "4a000007",
        "revision": 1,
    })
    assert selected["filename"] == "WukongCallHome.1.658e6ba8.lump"
    assert selected["binary_hash"] == hashlib.sha256(
        (tmp_path / "WukongCallHome.1.658e6ba8.lump").read_bytes()
    ).hexdigest()

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


def test_prepare_run_keeps_selected_residents_and_preserves_per_row_pin(
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
         "token": "d1", "lump_version": 1, "load_policy": "Resident",
         "artifact_pin": {
             "filename": "Dep.old.lump", "token": "d1", "revision": 1,
         }},
    ]

    prepared, changes = app_module._prepare_run_candidates(
        rows, str(tmp_path), boot_pin_supplied=True, boot_pin=None)

    assert prepared[0]["filename"] == "Entry.old.lump"
    assert prepared[0]["test_results"] == rows[0]["test_results"]
    assert prepared[0]["mtbf"] == rows[0]["mtbf"]
    assert prepared[1]["filename"] == "Dep.old.lump"
    assert prepared[1]["artifact_pin"]["revision"] == 1
    assert [item["abstraction"] for item in changes] == ["Dep"]


def _endpoint_fixture(tmp_path, monkeypatch):
    # These route-level unit tests exercise the commit boundary after an
    # authorized review; bypass only the review hook, never production policy.
    monkeypatch.setitem(
        app_module.app.before_request_funcs, None,
        [hook for hook in app_module.app.before_request_funcs.get(None, [])
         if hook.__name__ != "review"])
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
        assert json.loads((Path(_args[1]) / "ns-state.json").read_text())[
            "abstractions"][0]["filename"] == "Entry.new.lump"
        assert state_path.read_bytes() == before[0]
        raise ValueError("dependency NS[7] is missing")

    monkeypatch.setattr(
        app_module._boot_image_gen, "generate_boot_image", fail_generation)
    monkeypatch.setattr(
        app_module, "_write_ns_state",
        lambda _rows: (_ for _ in ()).throw(
            AssertionError("generation must pass before shared Namespace write")))
    fingerprint = app_module._namespace_state_fingerprint(rows)
    response = app_module.app.test_client().post(
        "/api/boot-image/generate",
        json={"prepareRun": True, "namespaceFingerprint": fingerprint})

    assert response.status_code == 409
    assert "dependency NS[7] is missing" in response.get_json()["error"]
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before
    assert lock_active["depth"] == 0


def test_prepare_run_invalid_generated_image_never_writes_shared_state(
        tmp_path, monkeypatch):
    rows, state_path, image_path, provenance_path = _endpoint_fixture(
        tmp_path, monkeypatch)
    before = (state_path.read_bytes(), image_path.read_bytes(),
              provenance_path.read_bytes())
    monkeypatch.setattr(
        app_module, "_prepare_run_candidates",
        lambda *_args, **_kwargs: (
            [dict(rows[0], filename="Entry.new.lump", token="e2")],
            [{"slot": 6, "abstraction": "Entry"}]))
    monkeypatch.setattr(app_module._boot_image_gen, "generate_boot_image",
                        lambda *_args, **_kwargs: b"invalid-image")
    monkeypatch.setattr(
        app_module, "_write_ns_state",
        lambda _rows: (_ for _ in ()).throw(
            AssertionError("invalid image must not write shared Namespace state")))
    response = app_module.app.test_client().post(
        "/api/boot-image/generate", json={
            "prepareRun": True,
            "namespaceFingerprint": app_module._namespace_state_fingerprint(rows),
        })
    assert response.status_code == 409
    assert "invalid image" in response.get_json()["error"].lower() or (
        "image size" in response.get_json()["error"].lower())
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before


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
    monkeypatch.setattr(
        app_module._boot_image_gen, "validate_boot_image", lambda _image: None)

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
    body = response.get_json()
    assert body["errorCode"] == "NAMESPACE_FINGERPRINT_CONFLICT"
    assert body["dataChanged"] is False
    assert body["committed"] is False
    assert body["safe_retry"] is True
    assert (state_path.read_bytes(), image_path.read_bytes(),
            provenance_path.read_bytes()) == before


def test_ns_state_get_fingerprint_matches_authoritative_rows_not_projection(
        tmp_path, monkeypatch):
    rows = [{
        "name": "Entry", "slot": 6, "boot": True,
        "filename": "Entry.lump", "token": "4a000006",
    }]
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps({"abstractions": rows}))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "missing.bin"))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(tmp_path / "missing.json"))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_ensure_ns_state", lambda: None)
    monkeypatch.setattr(
        app_module, "_project_effective_thread_policies",
        lambda state: {
            **state,
            "abstractions": [
                {**state["abstractions"][0], "load_policy": "Resident"}
            ],
        })

    response = app_module.app.test_client().get("/api/boot-image/ns-state")

    assert response.status_code == 200
    body = response.get_json()
    assert body["abstractions"][0]["load_policy"] == "Resident"
    assert body["namespaceFingerprint"] == (
        app_module._namespace_state_fingerprint(rows))
    assert body["namespaceFingerprint"] != (
        app_module._namespace_state_fingerprint(body["abstractions"]))


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