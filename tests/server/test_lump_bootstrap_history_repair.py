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
        assert plan["action"] == "replace"
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
    assert saved["token"] == CURRENT_TOKEN
    assert saved["bootstrap_t"] == CURRENT_TOKEN
    assert saved["bootstrap_runtime_gt"] == expected_gt

    # The actual defective bytes are immutable historical evidence, while the
    # current descriptor selects a fresh, compliant binary.
    assert (root / ARCHIVE_NAME).read_bytes() == bootstrap_history["legacy"]
    manifest = json.loads((root / "manifest.json").read_text())
    live = [row for row in manifest
            if row.get("token") == CURRENT_TOKEN and row.get("archived") is not True]
    assert len(live) == 1
    assert live[0]["lump_version"] > 2
    live_raw = (root / live[0]["filename"]).read_bytes()
    live_words = struct.unpack(f">{len(live_raw) // 4}I", live_raw)
    assert live_words[-1] == expected_gt
    live_approval = app_module._matching_lump_approval(
        str(root), hashlib.sha256(live_raw).hexdigest())
    assert live_approval["bootstrap_t"] == CURRENT_TOKEN
    assert live_approval["bootstrap_runtime_gt"] == expected_gt
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