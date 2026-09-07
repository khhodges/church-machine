"""SelfTest saves use the selected Namespace descriptor, not fixed artifacts."""

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

_MAGIC = 0x1F << 27


@pytest.fixture
def repository(tmp_path, monkeypatch):
    state = tmp_path / "ns-state.json"
    state.write_text(json.dumps({"abstractions": [{
        "name": "SelfTest", "slot": 12, "seq": 7, "resident": False,
        "load_policy": "Lazy",
    }]}))
    (tmp_path / "manifest.json").write_text("[]")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "absent.bin"))
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 12}, None))
    return tmp_path, state


def _words(slot=12, seq=7, cc=2, continuation=None):
    # A 64-word allocation proves neither the historical 512-word shape nor
    # word 510 is part of the save contract.
    words = [_MAGIC | (1 << 10) | cc, 0] + [0] * 62
    expected = app_module._boot_image_gen.create_gt(seq, slot, {"E": 1}, 1)
    words[-2] = expected
    words[-1] = expected if continuation is None else continuation
    return words


def _metadata(slot=12, token="abcdef01", next_slot=None):
    if next_slot is None:
        next_slot = slot
    return {
        "token": token, "abstraction": "SelfTest", "ns_slot": slot,
        "capabilities": [
            {"name": "SelfTest", "rights": ["E"], "nsIndex": slot},
            {"name": "Next.GT", "rights": ["E"], "nsIndex": next_slot},
        ],
    }


def _approved_payload(client, words, metadata):
    planned = client.post("/api/lumps/save-plan", json={
        "binary": words, "metadata": metadata,
    })
    assert planned.status_code == 201, planned.get_data(as_text=True)
    plan = planned.get_json()
    intent = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"], "plan": plan["plan"],
        "confirmation": True, "approval": {"grants": ["E"]},
    })
    assert intent.status_code == 201
    metadata = dict(metadata, save_plan=plan["plan"],
                    approval_intent=intent.get_json()["intent"])
    return {"binary": words, "metadata": metadata}


def test_selected_slot_and_live_sequence_drive_both_canonical_rows(repository):
    root, state_path = repository
    words = _words()
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save",
                               json=_approved_payload(client, words, _metadata()))
    assert response.status_code == 200, response.get_data(as_text=True)
    result = response.get_json()
    raw = (root / result["lump"]).read_bytes()
    assert raw == struct.pack(">64I", *words)
    digest = hashlib.sha256(raw).hexdigest()
    assert json.loads((root / "approvals.json").read_text())["approvals"][digest]["binary_hash"] == digest
    entry = json.loads(state_path.read_text())["abstractions"][0]
    assert {key: entry[key] for key in (
        "slot", "token", "filename", "issue_n", "lump_version", "resident",
        "load_policy",
    )} == {
        "slot": 12, "token": "abcdef01", "filename": result["lump"],
        "issue_n": 1, "lump_version": result["lump_version"], "resident": True,
        "load_policy": "Resident",
    }


def test_next_continuation_must_match_selected_live_descriptor(repository):
    expected = app_module._boot_image_gen.create_gt(7, 12, {"E": 1}, 1)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json={
            "binary": _words(continuation=expected ^ 1), "metadata": _metadata(),
        })
    assert response.status_code == 422
    body = response.get_json()
    assert body["selftest_egt_mismatch"] is True
    assert body["clist_row"] == 1
    assert body["word_index"] == 63
    assert not list(repository[0].glob("*.lump"))


def test_next_continuation_follows_lightningbolt_not_selftest(
        repository, monkeypatch):
    root, state_path = repository
    state = json.loads(state_path.read_text())
    state["abstractions"].append({
        "name": "CapabilityTest", "slot": 10, "seq": 0,
        "resident": True, "load_policy": "Resident",
    })
    state_path.write_text(json.dumps(state))
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 10}, None))
    starter_egt = app_module._boot_image_gen.create_gt(
        0, 10, {"E": 1}, 1)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words(continuation=starter_egt),
            "metadata": _metadata(next_slot=10),
        })
    assert response.status_code == 201, response.get_data(as_text=True)

    self_egt = app_module._boot_image_gen.create_gt(7, 12, {"E": 1}, 1)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words(continuation=self_egt),
            "metadata": _metadata(next_slot=12),
        })
    assert response.status_code == 422
    body = response.get_json()
    assert body["clist_row"] == 1
    assert body["expected_egt"] == starter_egt
    assert body["ns_slot"] == 10


def test_save_migrates_the_single_selftest_state_row_without_duplicates(
        repository, monkeypatch):
    _root, state_path = repository
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 14}, None))
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_approved_payload(
            client, _words(slot=14, seq=7), _metadata(slot=14, token="abcdef02")))
    assert response.status_code == 200, response.get_data(as_text=True)
    selftests = [row for row in json.loads(state_path.read_text())["abstractions"]
                 if row["name"] == "SelfTest"]
    assert len(selftests) == 1
    assert selftests[0]["slot"] == 14
    assert selftests[0]["seq"] == 7
    assert selftests[0]["token"] == "abcdef02"


def test_selftest_migration_rejects_an_occupied_target(repository):
    root, state_path = repository
    state = json.loads(state_path.read_text())
    state["abstractions"].append({"name": "Other", "slot": 14, "seq": 3})
    state_path.write_text(json.dumps(state))
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json={
            "binary": _words(slot=14, seq=7), "metadata": _metadata(slot=14),
        })
    assert response.status_code == 422
    assert response.get_json()["namespace_identity_failed"] is True
    assert not list(root.glob("*.lump"))


def test_only_bootstrap_slots_are_protected(repository):
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json={
            "binary": _words(slot=0), "metadata": _metadata(slot=0),
        })
    assert response.status_code == 403
    assert response.get_json()["protected_namespace_slot"] is True


def test_save_reports_invalid_approval_store_without_blaming_manifest(repository):
    root, _state_path = repository
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, _words(), _metadata())
        (root / "approvals.json").write_text(json.dumps({
            "version": 1,
            "algorithm": "sha256",
            "approvals": {"not-a-digest": {"binary_hash": "not-a-digest"}},
        }))
        response = client.post("/api/lumps/save", json=payload)

    assert response.status_code == 500
    error = response.get_json()["error"]
    assert "approvals.json is corrupt" in error
    assert "manifest.json is corrupt" not in error
