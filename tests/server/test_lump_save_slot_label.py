"""Atomic label publication tests, run with disposable CHURCH_TEST_* roots."""
import ast
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import struct
from unittest.mock import patch

import pytest
from flask import Flask, request

from test_lump_save_atomic import app_module
from server.change_confirmation import install


@pytest.fixture
def store(tmp_path, monkeypatch):
    repo = tmp_path / "lumps"
    repo.mkdir()
    config = tmp_path / "boot-config.json"  # deliberately outside LUMP store
    config.write_text('{"slotLabels":{"7":"Before","8":"Keep"},"step1":{"keep":true}}')
    (repo / "manifest.json").write_text("[]")
    (repo / "approvals.json").write_text('{"version":1,"algorithm":"sha256","approvals":{}}')
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config))
    monkeypatch.setattr(app_module, "_append_lump_diagnostic_event", lambda *a, **k: None)
    return repo, config


def publish(repo, config):
    raw = struct.pack(">64I", (0x1F << 27) | (1 << 10), *([0] * 63))
    digest = hashlib.sha256(raw).hexdigest()
    # Execute the production endpoint's additional-document builder, rather
    # than a second test implementation of how the label joins the transaction.
    tree = ast.parse(Path(app_module.__file__).read_text())
    builder = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "_save_additional_json")
    scope = {
        "_resident_additional_json": lambda entry: {},
        "_label_document": app_module._lump_save_slot_label_document(
            {"slot_label": "After"}, 7),
        "BOOT_CONFIG_PATH": str(config),
        "g": type("G", (), {})(),
    }
    exec(compile(ast.Module(body=[builder], type_ignores=[]), "<save-builder>", "exec"), scope)
    return app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={"token": "a70f0001", "filename": "saved.lump",
                        "abstraction": "Example", "lump_version": 1},
        binary_filename="saved.lump", binary_bytes=raw,
        approval_hash=digest, approval={"binary_hash": digest},
        additional_json_builder=scope["_save_additional_json"],
    )


def test_label_and_binary_committed_once_in_same_journal(store):
    repo, config = store
    calls = []
    replace = os.replace

    def tracked(source, dest):
        if str(dest) == str(config):
            journal = json.loads((repo / app_module._LUMP_TRANSITION_JOURNAL).read_text())
            assert str(config) in journal["destinations"]
            assert any(row["destination"] == str(config) for row in journal["backups"])
            calls.append(dest)
        return replace(source, dest)

    with patch.object(app_module.os, "replace", tracked):
        publish(repo, config)
    assert len(calls) == 1
    assert (repo / "saved.lump").exists()
    assert json.loads(config.read_text()) == {
        "slotLabels": {"7": "After", "8": "Keep"}, "step1": {"keep": True}}
    assert not (repo / app_module._LUMP_TRANSITION_JOURNAL).exists()


@pytest.mark.parametrize("existing", [True, False])
def test_failure_after_label_install_rolls_back_every_target(store, existing):
    repo, config = store
    if not existing:
        config.unlink()
    before = config.read_bytes() if existing else None
    replace = os.replace
    installed = []

    def fail_manifest(source, dest):
        if str(dest) == str(config):
            installed.append(True)
        if str(dest) == str(repo / "manifest.json"):
            raise OSError("injected final manifest failure")
        return replace(source, dest)

    with patch.object(app_module.os, "replace", fail_manifest):
        with pytest.raises(OSError, match="injected"):
            publish(repo, config)
    assert installed
    assert (config.read_bytes() if config.exists() else None) == before
    assert not (repo / "saved.lump").exists()
    assert json.loads((repo / "manifest.json").read_text()) == []


def test_review_reject_never_calls_transaction_and_confirm_writes_once(store):
    repo, config = store
    app = Flask(__name__)
    app.secret_key = "isolated"
    calls = []
    install(app, lambda: [config, repo / "manifest.json"], nullcontext,
            store_path=repo / "review.sqlite")

    @app.post("/api/lumps/save")
    def save():
        assert request.json["metadata"]["slot_label"] == "After"
        calls.append(publish(repo, config))
        return {"ok": True, "committed": True, "slot_label": "After"}

    client = app.test_client()
    payload = {"metadata": {"ns_slot": 7, "slot_label": "After"}}
    before = config.read_bytes()
    rejected = client.post("/api/lumps/save", json=payload)
    assert rejected.status_code == 428
    # Reject sends no approved request; every protected byte remains unchanged.
    assert not calls and config.read_bytes() == before
    review = client.post("/api/lumps/save", json=payload)
    token = review.json["change_confirmation"]["id"]
    changed = client.post("/api/lumps/save", json={"metadata": {
        "ns_slot": 7, "slot_label": "Other"}}, headers={"X-Change-Confirmation": token})
    assert changed.status_code == 409 and not calls
    review = client.post("/api/lumps/save", json=payload)
    confirmed = client.post("/api/lumps/save", json=payload, headers={
        "X-Change-Confirmation": review.json["change_confirmation"]["id"]})
    assert confirmed.status_code == 200 and len(calls) == 1
    assert json.loads(config.read_text())["slotLabels"]["7"] == "After"


def test_review_displays_label_and_revision_and_never_writes(store, monkeypatch):
    repo, config = store
    monkeypatch.setattr(app_module, "_LUMP_SAVE_PLANS", {
        "test": {"ns_slot": 7, "lump_name": "Example", "current_version": 15,
                 "proposed_version": 16, "session": "session", "expires": 1e20}})
    before = config.read_bytes()
    with app_module.app.test_request_context("/api/lumps/save", method="POST"):
        app_module.session["_lump_approval_session"] = "session"
        text = "\n".join(app_module._describe_protected_change({
            "metadata": {"save_plan_id": "test", "slot_label": "After"}}))
    assert 'NS[7] slot label: "Before" → "After"' in text
    assert "Version: 15 → 16" in text and "Example" in text
    assert config.read_bytes() == before


def test_bad_config_and_invalid_label_fail_without_writing(store):
    _, config = store
    for value in [None, "", " spaced ", 4]:
        with pytest.raises(ValueError):
            app_module._lump_save_slot_label_document({"slot_label": value}, 7)
    config.write_text("invalid")
    with pytest.raises(ValueError):
        app_module._lump_save_slot_label_document({"slot_label": "After"}, 7)
    assert config.read_text() == "invalid"


def test_transaction_does_not_allow_arbitrary_external_json(store):
    repo, config = store
    outside = config.parent / "not-boot-config.json"
    with pytest.raises(ValueError, match="outside lumps_dir"):
        app_module._commit_lump_history_transition(
            lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
            token8="a70f0001", manifest_entry={
                "token": "a70f0001", "filename": "saved.lump", "abstraction": "Example"},
            additional_json_builder=lambda _: {str(outside): {"unsafe": True}})
    assert not outside.exists()


@pytest.mark.parametrize("fail_commit", [False, True])
def test_real_save_endpoint_includes_label_in_first_review_and_receipt(store, monkeypatch, fail_commit):
    from test_lump_save_endpoint import _actual_client_new_entry_payload
    repo, config = store
    state = repo / "ns-state.json"
    state.write_text(json.dumps({"abstractions": [{
        "slot": 2, "name": "Boot", "boot": True, "token": "4a000002",
        "location": "0x100", "limit": "0x3F", "type": "Inform", "seq": 0,
    }]}))
    for key, value in {
        "LUMPS_DIR": str(repo), "_LUMPS_DIR": str(repo),
        "LUMPS_MANIFEST_PATH": str(repo / "manifest.json"),
        "NS_STATE_PATH": str(state), "BOOT_IMAGE_PATH": str(repo / "missing.bin"),
    }.items():
        monkeypatch.setattr(app_module, key, value)
    candidate = _actual_client_new_entry_payload(
        "abstraction Task3430RoundTrip {\n method Ping() { return(3430) }\n}\n")
    candidate["metadata"]["slot_label"] = "Reviewed label"
    before = config.read_bytes()
    with app_module.app.test_client() as client:
        planned = client.post("/api/lumps/save-plan", json=candidate)
        assert planned.status_code == 201, planned.get_data(as_text=True)
        plan = planned.json
        issued = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"], "plan_id": plan["plan_id"],
            "confirmation": True, "approval": {"grants": ["E"], "capability_type": "inform"}})
        assert issued.status_code == 201, issued.get_data(as_text=True)
        commit = dict(candidate, binary=plan["final_binary"], metadata=dict(
            candidate["metadata"], ns_slot=plan["ns_slot"], save_plan_id=plan["plan_id"],
            approval_intent=issued.json["intent"]))
        review = client.post("/api/lumps/save", json=commit)
        assert review.status_code == 428, review.get_data(as_text=True)
        assert "Reviewed label" in str(review.json["change_confirmation"]["changes"])
        assert config.read_bytes() == before
        original_replace = os.replace
        if fail_commit:
            def fail_after_label(source, destination):
                if str(destination) == str(repo / "manifest.json"):
                    assert json.loads(config.read_text())["slotLabels"][str(plan["ns_slot"])] == "Reviewed label"
                    raise OSError("injected manifest replacement failure")
                return original_replace(source, destination)
            monkeypatch.setattr(app_module.os, "replace", fail_after_label)
        saved = client.post("/api/lumps/save", json=commit, headers={
            "X-Change-Confirmation": review.json["change_confirmation"]["id"]})
        if fail_commit:
            assert saved.status_code == 500, saved.get_data(as_text=True)
            assert saved.json["committed"] is False
            assert config.read_bytes() == before
            assert json.loads((repo / "manifest.json").read_text()) == []
            return
        assert saved.status_code == 200, saved.get_data(as_text=True)
        assert saved.json["slot_label"] == "Reviewed label"
        assert json.loads(config.read_text())["slotLabels"][str(plan["ns_slot"])] == "Reviewed label"