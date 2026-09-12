"""Focused durable SAVE LUMP candidate and operation recovery coverage."""

import hashlib
import json
import struct
import sys
import threading
import types

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


def _binary(marker=1):
    return struct.pack(">64I", (0x1F << 27) | (1 << 10), marker, *([0] * 62))


def _set_store(monkeypatch, root):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(root))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(root))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(root / "ns-state.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(root / "boot-image.bin"))
    monkeypatch.setattr(
        app_module, "BOOT_IMAGE_PROVENANCE_PATH",
        str(root / "boot-image.provenance.json"))


def test_original_candidate_is_quarantined_and_recoverable(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    payload = {
        "binary": [0xF8000400, 7],
        "metadata": {"abstraction": "Candidate", "submitted_source": "original"},
    }
    with app_module.app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = "candidate-session"
        candidate_id = app_module._store_lump_save_candidate(
            payload, "operation-0001")

    with app_module.app.test_client() as client:
        with client.session_transaction() as browser_session:
            browser_session["_lump_approval_session"] = "candidate-session"
        listed = client.get("/api/lumps/save-candidates")
        detail = client.get(f"/api/lumps/save-candidates/{candidate_id}")

    assert listed.status_code == 200
    assert listed.get_json()["candidates"][0]["candidate_id"] == candidate_id
    assert detail.status_code == 200
    assert detail.get_json()["payload"] == payload
    assert not list((tmp_path / "save-candidates").glob("*.lump"))


def test_pending_operation_recovers_when_manifest_proves_exact_commit(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    operation_id = "operation-0002"
    token = "00000c00"
    filename = "Candidate.1.deadbeef.lump"
    raw = _binary(2)
    digest = hashlib.sha256(raw).hexdigest()
    (tmp_path / filename).write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "filename": filename, "operation_id": operation_id,
    }]))
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {digest: {
            "binary_hash": digest, "filename": filename,
        }},
    }))
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "abstractions": [{
            "slot": 12, "token": token, "filename": filename,
        }],
    }))

    with app_module.app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = "recovery-session"
        app_module._write_lump_save_operation(operation_id, {
            "outcome": "pending",
            "session_binding": app_module._operation_session_binding(),
            "expected": {
                "token": token, "filename": filename, "digest": digest,
                "ns_slot": 12,
            },
            "response": {"ok": True, "token": token},
        })
    with app_module.app.test_client() as client:
        with client.session_transaction() as browser_session:
            browser_session["_lump_approval_session"] = "recovery-session"
        response = client.get(f"/api/lumps/save-operations/{operation_id}")

    assert response.status_code == 200
    recovered = response.get_json()
    assert recovered["operation_id"] == operation_id
    assert recovered["outcome"] == "committed"
    assert recovered["committed"] is True
    assert recovered["response"] == {"ok": True, "token": token}


def test_pending_operation_without_commit_proof_is_unknown(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    operation_id = "operation-0003"
    # A publication marker exists but its artifact is missing: this is not
    # the provably uncommitted, pre-journal interruption case.
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "00000f00", "filename": "missing.lump",
        "operation_id": operation_id,
    }]))
    with app_module.app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = "unknown-session"
        app_module._write_lump_save_operation(operation_id, {
            "outcome": "pending",
            "session_binding": app_module._operation_session_binding(),
            "expected": {
                "token": "00000f00", "filename": "missing.lump",
                "digest": "0" * 64,
            },
        })
    with app_module.app.test_client() as client:
        with client.session_transaction() as browser_session:
            browser_session["_lump_approval_session"] = "unknown-session"
        response = client.get(f"/api/lumps/save-operations/{operation_id}")

    assert response.status_code == 200
    assert response.get_json()["outcome"] == "unknown"
    assert response.get_json()["committed"] is None


def test_targeted_generation_ignores_unrelated_library_binary(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    target = _binary(3)
    unrelated = _binary(4)
    (tmp_path / "target.lump").write_bytes(target)
    (tmp_path / "other.lump").write_bytes(unrelated)
    manifest = [
        {"token": "00000d00", "filename": "target.lump"},
        {"token": "00000e00", "filename": "other.lump"},
    ]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": []}))

    before = app_module._authoritative_lump_library_generation(
        str(tmp_path), str(tmp_path / "manifest.json"), manifest,
        token8="00000d00", ns_slot=13)
    (tmp_path / "other.lump").write_bytes(_binary(5))
    after = app_module._authoritative_lump_library_generation(
        str(tmp_path), str(tmp_path / "manifest.json"), manifest,
        token8="00000d00", ns_slot=13)

    assert before == after


def test_prepared_journal_recovers_all_replaced_authoritative_files(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    old_binary, new_binary = _binary(6), _binary(7)
    binary_path = tmp_path / "current.lump"
    manifest_path = tmp_path / "manifest.json"
    binary_path.write_bytes(new_binary)
    manifest_path.write_text('[{"token":"new"}]')
    binary_backup = tmp_path / ".binary.backup"
    manifest_backup = tmp_path / ".manifest.backup"
    binary_backup.write_bytes(old_binary)
    manifest_backup.write_text("[]")
    journal_path = tmp_path / app_module._LUMP_TRANSITION_JOURNAL
    app_module._durable_atomic_json(str(journal_path), {
        "version": 1,
        "state": "prepared",
        "destinations": [str(binary_path), str(manifest_path)],
        "backups": [
            {"destination": str(binary_path), "backup": str(binary_backup)},
            {"destination": str(manifest_path), "backup": str(manifest_backup)},
        ],
        "staged": [],
    })

    with app_module._lump_history_transition_lock(str(tmp_path)):
        pass

    assert binary_path.read_bytes() == old_binary
    assert manifest_path.read_text() == "[]"
    assert not journal_path.exists()


def test_save_plan_commit_replay_persists_final_bytes(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    (tmp_path / "manifest.json").write_text("[]")
    header = (0x1F << 27) | (1 << 10)
    initial = {"binary": [header, 9], "metadata": {"abstraction": "Txn"}}
    with app_module.app.test_client() as client:
        plan_response = client.post("/api/lumps/save-plan", json=initial)
        assert plan_response.status_code == 201
        plan = plan_response.get_json()
        intent_response = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"],
            "plan": plan["plan_id"], "confirmation": True, "approval": {},
        })
        assert intent_response.status_code == 201
        commit = {
            "binary": plan["final_binary"],
            "metadata": {
                "abstraction": "Txn", "save_plan": plan["plan_id"],
                "approval_intent": intent_response.get_json()["intent"],
                "operation_id": "transaction-0001",
            },
        }
        saved_response = client.post("/api/lumps/save", json=commit)
        replay_response = client.post("/api/lumps/save", json=commit)
        artifact_response = client.get(
            "/api/lumps/save-operations/transaction-0001/artifact")

    assert saved_response.status_code == 200
    saved = saved_response.get_json()
    assert saved["committed"] is True
    assert saved["ns_slot"] is None
    assert saved["digest"] == plan["digest"]
    assert (tmp_path / saved["filename"]).read_bytes() == struct.pack(
        f">{len(plan['final_binary'])}I", *plan["final_binary"])
    assert replay_response.status_code == 200
    assert replay_response.get_json()["filename"] == saved["filename"]
    assert artifact_response.status_code == 200
    assert artifact_response.get_json()["final_binary"] == plan["final_binary"]


def test_new_entry_plan_rejects_destination_taken_after_planning(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": []}))
    header = (0x1F << 27) | (1 << 10)
    initial = {
        "binary": [header, 11],
        "metadata": {"abstraction": "NewTxn", "new_entry": True},
    }
    with app_module.app.test_client() as client:
        plan_response = client.post("/api/lumps/save-plan", json=initial)
        assert plan_response.status_code == 201
        plan = plan_response.get_json()
        intent_response = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"],
            "plan": plan["plan_id"], "confirmation": True, "approval": {},
        })
        (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [{
            "slot": plan["ns_slot"], "token": "11111111",
            "filename": "occupied.lump",
        }]}))
        response = client.post("/api/lumps/save", json={
            "binary": plan["final_binary"],
            "metadata": {
                "abstraction": "NewTxn", "new_entry": True,
                "save_plan": plan["plan_id"],
                "approval_intent": intent_response.get_json()["intent"],
                "operation_id": "transaction-0002",
            },
        })

    assert response.status_code == 403 or response.status_code == 409
    assert not list(tmp_path.glob("NewTxn.*.lump"))


def test_history_retains_more_than_twenty_archives_without_implicit_pruning(
        tmp_path
):
    token = "0000aa01"
    (tmp_path / "current.lump").write_bytes(_binary(100))
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "filename": "current.lump", "abstraction": "Retention",
        "lump_version": 1,
    }]))
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {},
    }))
    for revision in range(25):
        raw = _binary(200 + revision)
        digest = hashlib.sha256(raw).hexdigest()
        app_module._commit_lump_history_transition(
            lumps_dir=str(tmp_path), manifest_path=str(tmp_path / "manifest.json"),
            token8=token,
            manifest_entry={
                "token": token, "filename": "current.lump",
                "abstraction": "Retention", "lump_version": revision + 2,
            },
            binary_filename="current.lump", binary_bytes=raw,
            approval_hash=digest,
            approval={"binary_hash": digest, "filename": "current.lump"},
            archive_stem="Retention", archive_version=revision,
            archive_binary_path=str(tmp_path / "current.lump"),
            advance_current_version_from_archive=True,
        )

    assert len(list(tmp_path.glob("Retention_v*.lump"))) == 25
    assert (tmp_path / "Retention_v0.lump").exists()
    assert (tmp_path / "Retention_v24.lump").exists()


def test_reader_waits_while_authoritative_transition_locks_are_held(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    (tmp_path / "manifest.json").write_text("[]")
    finished = threading.Event()

    namespace_guard = app_module._namespace_commit_guard()
    history_guard = app_module._lump_history_transition_lock(str(tmp_path))
    namespace_guard.__enter__()
    history_guard.__enter__()
    try:
        def read():
            with app_module.app.test_client() as client:
                client.get("/api/lumps/list")
            finished.set()
        reader = threading.Thread(target=read)
        reader.start()
        assert not finished.wait(0.05)
    finally:
        history_guard.__exit__(None, None, None)
        namespace_guard.__exit__(None, None, None)
    reader.join(2)
    assert finished.is_set()


def test_failed_prepared_recovery_keeps_journal_and_backup(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    destination = tmp_path / "current.lump"
    backup = tmp_path / ".current.backup"
    destination.write_bytes(_binary(30))
    backup.write_bytes(_binary(29))
    journal = tmp_path / app_module._LUMP_TRANSITION_JOURNAL
    app_module._durable_atomic_json(str(journal), {
        "version": 1, "state": "prepared",
        "destinations": [str(destination)],
        "backups": [{"destination": str(destination), "backup": str(backup)}],
        "staged": [],
    })
    actual_remove = app_module.os.remove
    def fail_remove(path, *args, **kwargs):
        if str(path) == str(destination):
            raise OSError("simulated rollback failure")
        return actual_remove(path, *args, **kwargs)
    monkeypatch.setattr(app_module.os, "remove", fail_remove)
    with pytest.raises(RuntimeError):
        with app_module._lump_history_transition_lock(str(tmp_path)):
            pass
    assert journal.exists()
    assert backup.exists()


def test_crash_rollback_settles_operation_as_proven_not_committed(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    operation_id = "rollback-0001"
    destination = tmp_path / "current.lump"
    backup = tmp_path / ".current.backup"
    destination.write_bytes(_binary(41))
    backup.write_bytes(_binary(40))
    with app_module.app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = "rollback-session"
        app_module._write_lump_save_operation(operation_id, {
            "outcome": "pending",
            "session_binding": app_module._operation_session_binding(),
            "original_payload": {"binary": [1], "metadata": {}},
        })
    journal = tmp_path / app_module._LUMP_TRANSITION_JOURNAL
    app_module._durable_atomic_json(str(journal), {
        "version": 1, "state": "prepared", "operation_id": operation_id,
        "destinations": [str(destination)],
        "backups": [{"destination": str(destination), "backup": str(backup)}],
        "staged": [],
    })
    with app_module._lump_history_transition_lock(str(tmp_path)):
        pass
    with app_module.app.test_client() as client:
        with client.session_transaction() as browser_session:
            browser_session["_lump_approval_session"] = "rollback-session"
        response = client.get(f"/api/lumps/save-operations/{operation_id}")
    assert response.status_code == 200
    assert response.get_json()["committed"] is False


def test_unrelated_request_does_not_take_lump_transition_locks(tmp_path, monkeypatch):
    _set_store(monkeypatch, tmp_path)
    with app_module.app.test_request_context("/api/health"):
        assert app_module._recover_lump_transition_before_request() is None
        assert not hasattr(app_module.g, "_lump_request_history_guard")
        assert not hasattr(app_module.g, "_lump_request_namespace_guard")


def test_lock_acquisition_failure_releases_namespace_guard(monkeypatch):
    class Guard:
        def __init__(self, fail=False):
            self.fail = fail
            self.exited = False
        def __enter__(self):
            if self.fail:
                raise OSError("simulated history lock failure")
            return self
        def __exit__(self, *_args):
            self.exited = True

    namespace_guard = Guard()
    monkeypatch.setattr(app_module, "_namespace_commit_guard",
                        lambda: namespace_guard)
    monkeypatch.setattr(app_module, "_lump_history_transition_lock",
                        lambda _directory: Guard(fail=True))
    with app_module.app.test_request_context("/api/lumps/list"):
        response = app_module._recover_lump_transition_before_request()
        assert app_module.app.make_response(response).status_code == 503
    assert namespace_guard.exited is True


def test_missing_prepared_backup_fails_closed_and_keeps_journal(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    destination = tmp_path / "current.lump"
    destination.write_bytes(_binary(52))
    journal = tmp_path / app_module._LUMP_TRANSITION_JOURNAL
    app_module._durable_atomic_json(str(journal), {
        "version": 1, "state": "prepared",
        "destinations": [str(destination)],
        "backups": [{
            "destination": str(destination),
            "backup": str(tmp_path / ".missing.backup"),
        }],
        "staged": [],
    })
    with pytest.raises(RuntimeError):
        with app_module._lump_history_transition_lock(str(tmp_path)):
            pass
    assert journal.exists()
    assert destination.read_bytes() == _binary(52)


def test_early_interrupted_pending_operation_settles_on_same_id_replay(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    (tmp_path / "manifest.json").write_text("[]")
    operation_id = "orphaned-0001"
    payload = {"binary": [(0x1F << 27) | (1 << 10), 8],
               "metadata": {"abstraction": "Orphan", "operation_id": operation_id}}
    with app_module.app.test_client() as client:
        with client.session_transaction() as browser_session:
            browser_session["_lump_approval_session"] = "orphan-session"
        with app_module.app.test_request_context("/"):
            app_module.session["_lump_approval_session"] = "orphan-session"
            binding = app_module._operation_session_binding()
        app_module._write_lump_save_operation(operation_id, {
            "outcome": "pending", "session_binding": binding,
            "original_payload": payload,
        })
        replay = client.post("/api/lumps/save", json=payload)
        status = client.get(f"/api/lumps/save-operations/{operation_id}")
    assert replay.status_code == 409
    assert replay.get_json()["committed"] is False
    assert status.get_json()["committed"] is False


def test_different_candidate_token_plans_replace_for_occupied_destination(
        tmp_path, monkeypatch
):
    _set_store(monkeypatch, tmp_path)
    occupied_token, candidate_token = "00000c00", "deadbeef"
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": occupied_token, "filename": "occupied.lump",
        "abstraction": "Occupant", "lump_version": 1,
    }]))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [{
        "slot": 12, "token": occupied_token, "filename": "occupied.lump",
        "name": "Occupant", "seq": 0,
    }]}))
    header = (0x1F << 27) | (1 << 10)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": [header, 12],
            "metadata": {
                "abstraction": "Candidate", "token": candidate_token,
                "ns_slot": 12,
            },
        })
    assert response.status_code == 201
    plan = response.get_json()
    assert plan["action"] == "replace"
    assert plan["consequence"] == "replace"
    assert plan["current_lump"]["token"] == occupied_token
    assert plan["current_lump"]["filename"] == "occupied.lump"