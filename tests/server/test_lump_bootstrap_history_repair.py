"""Approved bootstrap-history repairs create a new live immutable revision."""
import hashlib
import json
import struct
import sys
import types

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


CURRENT_TOKEN = "4a00000a"
LEGACY_TOKEN = "b6182a95"
ARCHIVE_NAME = "CapabilityTest.1.legacy.lump"
CURRENT_NAME = "CapabilityTest.2.current.lump"


def _raw(row_zero):
    words = [(0x1F << 27) | (1 << 10) | 1] + [0] * 63
    words[-1] = row_zero
    return struct.pack(">64I", *words)


def _snapshot(root):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.iterdir()
        if path.is_file()
    }


@pytest.fixture
def bootstrap_history(tmp_path, monkeypatch):
    binding = {
        "name": "CapabilityTest",
        "slot": 10,
        "seq": 0,
        "token": CURRENT_TOKEN,
        "filename": CURRENT_NAME,
        "issue_n": 2,
        "lump_version": 2,
        "resident": True,
        "boot_resident": True,
        "type": "Inform",
        "load_policy": "Resident",
        "ns_slot_policy": "static",
    }
    expected_gt = app_module._resident_inform_egt(binding)
    current = _raw(expected_gt)
    legacy = _raw(0x4A000006)
    (tmp_path / CURRENT_NAME).write_bytes(current)
    (tmp_path / ARCHIVE_NAME).write_bytes(legacy)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "token": CURRENT_TOKEN,
            "abstraction": "CapabilityTest",
            "filename": CURRENT_NAME,
            "lump_version": 2,
        },
        {
            "token": LEGACY_TOKEN,
            "abstraction": "CapabilityTest",
            "filename": ARCHIVE_NAME,
            "lump_version": 1,
            "archived": True,
        },
    ]))
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "abstractions": [binding],
    }))
    approvals = {}
    for raw, issue_n, filename in (
        (current, 2, CURRENT_NAME),
        (legacy, 1, ARCHIVE_NAME),
    ):
        digest = hashlib.sha256(raw).hexdigest()
        approvals[digest] = {
            "binary_hash": digest,
            "abstraction": "CapabilityTest",
            "dot_name": "CapabilityTest",
            "issue_n": issue_n,
            "filename": filename,
            "grants": ["E"],
            "capability_type": "inform",
        }
    app_module._shared_write_approvals(str(tmp_path / "approvals.json"), approvals)
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "absent-boot.bin"))
    return {
        "root": tmp_path,
        "expected_gt": expected_gt,
        "legacy": legacy,
        "current": current,
    }


def test_repair_requires_plan_and_exact_historical_archive(bootstrap_history):
    root = bootstrap_history["root"]
    before = _snapshot(root)
    with app_module.app.test_client() as client:
        without_plan = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair",
            json={
                "archive_filename": ARCHIVE_NAME,
                "corrections": [
                    "repair-sealed-row-zero-gt",
                    "issue-canonical-bootstrap-identity",
                ],
            },
        )
        wrong_version = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/2/bootstrap-repair-plan",
            json={"archive_filename": ARCHIVE_NAME},
        )
        wrong_archive = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair-plan",
            json={"archive_filename": CURRENT_NAME},
        )

    assert without_plan.status_code == 409
    assert wrong_version.status_code == 409
    assert wrong_archive.status_code == 409
    assert _snapshot(root) == before


def test_history_preview_reads_existing_archive_and_current_bytes_without_validity_gate(
        bootstrap_history
):
    """Read-only Preview is available even where restore validation fails."""
    with app_module.app.test_client() as client:
        history_response = client.get(f"/api/lumps/{CURRENT_TOKEN}/history")
        archive_response = client.get(
            f"/api/lumps/{CURRENT_TOKEN}/words/1",
            query_string={"archive_filename": ARCHIVE_NAME},
        )
        current_response = client.get(f"/api/lump/{CURRENT_TOKEN}/words")

    assert history_response.status_code == 200
    history = history_response.get_json()["history"]
    archive_entry = next(
        entry for entry in history
        if entry.get("archive_filename") == ARCHIVE_NAME
    )
    assert archive_entry["preview_enabled"] is True
    assert archive_entry["restore_enabled"] is False

    assert archive_response.status_code == 200
    archive = archive_response.get_json()
    assert archive["words"][-1] == 0x4A000006
    assert archive["binary_valid"] is False

    assert current_response.status_code == 200
    assert current_response.get_json()["words"][-1] == bootstrap_history["expected_gt"]


def test_standard_filename_archive_is_previewable_with_complete_identity_diagnostics(
        bootstrap_history
):
    root = bootstrap_history["root"]
    standard_name = "CapabilityTest_v23.lump"
    (root / standard_name).write_bytes(bootstrap_history["legacy"])

    with app_module.app.test_client() as client:
        history_response = client.get(f"/api/lumps/{CURRENT_TOKEN}/history")
        archive_response = client.get(
            f"/api/lumps/{CURRENT_TOKEN}/words/23",
            query_string={"archive_filename": standard_name},
        )

    assert history_response.status_code == 200
    standard_entry = next(
        entry for entry in history_response.get_json()["history"]
        if entry.get("archive_filename") == standard_name
    )
    assert standard_entry["preview_enabled"] is True
    assert standard_entry["restore_enabled"] is False
    assert standard_entry["archive_provenance"] == {
        "kind": "standard-filename-pattern",
        "filename": standard_name,
        "description": (
            "This archive was discovered from the active LUMP's standard "
            "filename pattern; it has no separate archived manifest row."
        ),
        "correction_supported": True,
    }

    assert archive_response.status_code == 200
    archive = archive_response.get_json()
    assert archive["archive_filename"] == standard_name
    assert archive["archive_provenance"]["kind"] == "standard-filename-pattern"
    assert archive["archive_provenance"]["correction_supported"] is True
    identity = archive["bootstrap_identity"]
    assert identity["row0_gt"] == "4a000006"
    assert identity["active_namespace_gt"] == "4a00000a"
    assert identity["record_token"] == CURRENT_TOKEN
    assert identity["valid"] is False
    issue_text = "\n".join(
        issue["message"] for issue in archive["preview_issues"])
    assert "Bootstrap identity is inconsistent." in issue_text
    assert "sealed row-zero GT 0x4a000006" in issue_text
    assert "record Token 0x4a00000a" in issue_text
    assert (
        "Direct History activation is disabled because this revision is not "
        "a valid live candidate."
    ) in issue_text


def test_approved_repair_reissues_canonical_live_lump_and_preserves_evidence(
        bootstrap_history
):
    root = bootstrap_history["root"]
    expected_gt = bootstrap_history["expected_gt"]
    with app_module.app.test_client() as client:
        plan_response = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair-plan",
            json={"archive_filename": ARCHIVE_NAME},
        )
        assert plan_response.status_code == 201, plan_response.get_data(as_text=True)
        plan = plan_response.get_json()
        assert plan["action"] == "save"
        assert plan["namespace_slot"] == 2
        assert plan["namespace_sequence"] == 0
        assert plan["destination_token"] == "4a000002"
        assert [item["id"] for item in plan["corrections"]] == [
            "repair-sealed-row-zero-gt",
            "issue-canonical-bootstrap-identity",
        ]

        intent_response = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"],
            "action": plan["action"],
            "plan_id": plan["plan_id"],
            "confirmation": True,
            "approval": {},
        })
        assert intent_response.status_code == 201
        repair_response = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair",
            json={
                "archive_filename": ARCHIVE_NAME,
                "plan_id": plan["plan_id"],
                "approval_intent": intent_response.get_json()["intent"],
                "corrections": [item["id"] for item in plan["corrections"]],
            },
        )

    assert repair_response.status_code == 200, repair_response.get_data(as_text=True)
    saved = repair_response.get_json()
    assert saved["token"] == "4a000002"
    assert saved["namespace_slot"] == 2
    assert saved["bootstrap_t"] == "4a000002"
    assert saved["bootstrap_runtime_gt"] == 0x4A000002

    # The actual defective bytes are immutable historical evidence, while the
    # original resident descriptor and archive remain untouched.
    assert (root / ARCHIVE_NAME).read_bytes() == bootstrap_history["legacy"]
    manifest = json.loads((root / "manifest.json").read_text())
    live = [row for row in manifest
            if row.get("token") == "4a000002" and row.get("archived") is not True]
    assert len(live) == 1
    assert live[0]["lump_version"] == 1
    live_raw = (root / live[0]["filename"]).read_bytes()
    live_words = struct.unpack(f">{len(live_raw) // 4}I", live_raw)
    assert live_words[-1] == 0x4A000002
    ns_state = json.loads((root / "ns-state.json").read_text())
    destination = next(row for row in ns_state["abstractions"] if row["slot"] == 2)
    assert destination["name"] == "CapabilityTest"
    assert destination["token"] == "4a000002"
    assert destination["filename"] == live[0]["filename"]
    original = next(row for row in ns_state["abstractions"] if row["slot"] == 10)
    assert original["token"] == CURRENT_TOKEN
    assert original["filename"] == CURRENT_NAME
    live_approval = app_module._matching_lump_approval(
        str(root), hashlib.sha256(live_raw).hexdigest())
    assert live_approval["bootstrap_t"] == "4a000002"
    assert live_approval["bootstrap_runtime_gt"] == 0x4A000002
    assert live_approval["binary_hash"] == hashlib.sha256(live_raw).hexdigest()


def test_standard_filename_history_archive_can_be_repaired(bootstrap_history):
    """Pattern-discovered archives get the same repair options as manifest rows."""
    root = bootstrap_history["root"]
    current_name = "CapabilityTest.lump"
    standard_archive = "CapabilityTest_v1.lump"
    (root / CURRENT_NAME).rename(root / current_name)
    (root / ARCHIVE_NAME).rename(root / standard_archive)
    manifest = json.loads((root / "manifest.json").read_text())
    manifest = [
        dict(row, filename=current_name)
        if row.get("archived") is not True else None
        for row in manifest
    ]
    (root / "manifest.json").write_text(json.dumps([
        row for row in manifest if row is not None
    ]))

    with app_module.app.test_client() as client:
        response = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair-plan",
            json={"archive_filename": standard_archive},
        )

    assert response.status_code == 201, response.get_data(as_text=True)
    plan = response.get_json()
    assert [item["id"] for item in plan["corrections"]] == [
        "repair-sealed-row-zero-gt",
        "issue-canonical-bootstrap-identity",
    ]


def _write_namespace_state(path, rows):
    path.write_text(json.dumps({"abstractions": rows}))


def _resident_row(slot, *, name="Resident", seq=0):
    gt = app_module._resident_inform_egt({
        "name": name,
        "slot": slot,
        "seq": seq,
        "resident": True,
        "boot_resident": True,
        "type": "Inform",
        "load_policy": "Resident",
        "ns_slot_policy": "static",
    })
    return {
        "name": name,
        "slot": slot,
        "seq": seq,
        "token": f"{gt:08x}",
        "filename": f"{name}.{slot}.lump",
        "resident": True,
        "boot_resident": True,
        "type": "Inform",
        "load_policy": "Resident",
        "ns_slot_policy": "static",
    }


def test_repair_allocator_uses_first_free_slot_at_or_above_two(tmp_path, monkeypatch):
    state_path = tmp_path / "ns-state.json"
    _write_namespace_state(state_path, [
        {"name": "Boot.NS", "slot": 0},
        {"name": "Boot.Thread", "slot": 1},
        _resident_row(10, name="CapabilityTest"),
    ])
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    destination = app_module._allocate_bootstrap_history_repair_destination(
        "CapabilityTest")

    assert destination["slot"] == 2
    assert destination["sequence"] == 0
    assert destination["token"] == "4a000002"
    assert destination["binding"]["name"] == "CapabilityTest"


def test_repair_allocator_skips_populated_residents_but_replaces_nonresident_rows(
        tmp_path, monkeypatch):
    state_path = tmp_path / "ns-state.json"
    nonresident = {
        "name": "LazyOld",
        "slot": 2,
        "seq": 7,
        "token": "deadbeef",
        "filename": "LazyOld.1.lump",
        "resident": False,
        "load_policy": "Lazy",
    }
    _write_namespace_state(state_path, [
        _resident_row(2, name="ResidentTwo"),
        _resident_row(4, name="ResidentFour"),
    ])
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))

    skipped = app_module._allocate_bootstrap_history_repair_destination(
        "CapabilityTest")
    assert skipped["slot"] == 3

    # Replace the resident row with the non-resident row and verify that the
    # same slot is eligible while retaining its live sequence.
    _write_namespace_state(state_path, [nonresident, _resident_row(4, name="ResidentFour")])
    destination = app_module._allocate_bootstrap_history_repair_destination(
        "CapabilityTest")

    assert destination["slot"] == 2
    assert destination["sequence"] == 7
    assert destination["token"] == "4a070002"
    assert destination["source_row"]["name"] == "LazyOld"


def test_repair_plan_fails_closed_when_namespace_changes_before_apply(
        bootstrap_history):
    root = bootstrap_history["root"]
    with app_module.app.test_client() as client:
        plan_response = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair-plan",
            json={"archive_filename": ARCHIVE_NAME},
        )
        assert plan_response.status_code == 201
        plan = plan_response.get_json()
        intent_response = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"],
            "action": plan["action"],
            "plan_id": plan["plan_id"],
            "confirmation": True,
            "approval": {},
        })
        assert intent_response.status_code == 201
        state = json.loads((root / "ns-state.json").read_text())
        state["abstractions"].append({"name": "Changed", "slot": 30, "seq": 0})
        (root / "ns-state.json").write_text(json.dumps(state))
        manifest_before = (root / "manifest.json").read_bytes()
        response = client.post(
            f"/api/lumps/{CURRENT_TOKEN}/history/1/bootstrap-repair",
            json={
                "archive_filename": ARCHIVE_NAME,
                "plan_id": plan["plan_id"],
                "approval_intent": intent_response.get_json()["intent"],
                "corrections": [item["id"] for item in plan["corrections"]],
            },
        )

    assert response.status_code == 409
    assert (root / "manifest.json").read_bytes() == manifest_before
    assert not any(row.get("token") == "4a000002"
                   for row in json.loads(manifest_before))
