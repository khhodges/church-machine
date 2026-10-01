"""Programmer publication must not touch engineer or tester state."""
import copy
import json
import os
import pytest

assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1"
for key in ("CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH",
            "CHURCH_TEST_BUILD_SNAPSHOTS_DIR", "CHURCH_TEST_DB_PATH"):
    assert os.environ.get(key), key

from test_lump_save_endpoint import (
    app_module, isolated_lumps, _words, _actual_client_new_entry_payload)


def publish(client, candidate, on_review=None):
    response = client.post("/api/lumps/save-plan", json=candidate)
    assert response.status_code == 201, response.json
    plan = response.json
    assert plan["ns_slot"] is None
    intent = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"],
        "plan_id": plan["plan_id"], "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"}})
    assert intent.status_code == 201, intent.json
    payload = copy.deepcopy(candidate)
    payload["binary"] = plan["final_binary"]
    payload["metadata"].update(save_plan_id=plan["plan_id"],
                               approval_intent=intent.json["intent"])
    if plan.get("portable_binding"):
        payload["metadata"]["portable_binding"] = plan["portable_binding"]
    if plan.get("compiler_record"):
        record = plan["compiler_record"]
        payload["metadata"].update(compiler_record=record,
            compiler_identity=record["compiler_identity"],
            compiler_version=record["compiler_version"],
            trust_origin="trusted-home-ide")
    response = client.post("/api/lumps/save", json=payload)
    if response.status_code == 428:
        if on_review is not None:
            on_review(response)
        response = client.post("/api/lumps/save", json=payload, headers={
            "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    assert response.json["ns_slot"] is None
    return response.json


def candidate():
    return {"binary": _words(), "metadata": {
        "token": "ab501001", "abstraction": "LumpSaveTest",
        "content_type": "code", "capabilities": [], "grants": ["E"],
        "methods": [], "language": "assembly"}}


def test_document_bootstraps_stable_review_session_before_parallel_work(isolated_lumps):
    client = app_module.app.test_client()
    response = client.get("/simulator/", follow_redirects=True)
    assert response.status_code == 200
    keys = ("_lump_approval_session", "_change_review_session",
            "_lump_save_diagnostic_session")
    with client.session_transaction() as browser_session:
        original = {key: browser_session[key] for key in keys}
    # A request launched from the initial document can finish after review.
    # Its old cookie must already include every independently used binding.
    polling = app_module.app.test_client()
    polling.set_cookie("session", client.get_cookie("session").value)
    reviews = []

    def review_pending(response):
        reviews.append(response.json["change_confirmation"]["id"])
        late = polling.get("/simulator/~/" + app_module._SIMULATOR_HTML_VERSION)
        assert late.status_code == 200
        assert "Set-Cookie" not in late.headers
        with client.session_transaction() as browser_session:
            assert {key: browser_session[key] for key in keys} == original

    publish(client, candidate(), on_review=review_pending)
    assert len(reviews) == 1  # exercised the real 428 -> confirmed repeat
    with client.session_transaction() as browser_session:
        assert {key: browser_session[key] for key in keys} == original


@pytest.mark.parametrize("deployment", [
    {"ns_slot": 7}, {"new_entry": True}, {"ns_slot_policy": "dynamic"},
    {"slot_label": "Other"}, {"promotion_binding": {"ns_slot": 7}}])
def test_deployment_requires_engineer_workflow(isolated_lumps, deployment):
    payload = candidate()
    payload["metadata"].update(deployment)
    before = (isolated_lumps / "ns-state.json").read_bytes()
    response = app_module.app.test_client().post("/api/lumps/save-plan", json=payload)
    assert response.status_code == 422, response.json
    assert response.json["artifact_only_required"] is True
    assert (isolated_lumps / "ns-state.json").read_bytes() == before
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


@pytest.mark.parametrize("symbolic", [False, True])
def test_publish_with_unreadable_namespace_leaves_all_deployments_unchanged(
        isolated_lumps, symbolic):
    # Namespace health is deliberately unrelated to artifact publication.
    (isolated_lumps / "ns-state.json").write_text("not JSON; must not be read")
    (isolated_lumps / "absent-boot.bin").write_bytes(b"existing image")
    (isolated_lumps / "boot-image-provenance.json").write_text('{"old":true}')
    paths = [isolated_lumps / name for name in (
        "ns-state.json", "boot-config.json", "absent-boot.bin",
        "boot-image-provenance.json")]
    before = {path: path.read_bytes() for path in paths}
    payload = candidate()
    if symbolic:
        payload = _actual_client_new_entry_payload(
            "abstraction Task3430RoundTrip { method Ping() { return(3430) } }")
        for key in ("ns_slot_policy", "new_entry", "replacement"):
            payload["metadata"].pop(key, None)
        payload["metadata"]["portable_binding"] = {
            "schema": "church.portable-lump-binding/v1",
            "owner": "Task3430RoundTrip#1",
            "dependencies": payload["metadata"]["capabilities"],
        }
    result = publish(app_module.app.test_client(), payload)
    assert {path: path.read_bytes() for path in paths} == before
    assert (isolated_lumps / result["filename"]).exists()
    if symbolic:
        assert result["final_binary"][-1] == 0xFEED5E1F


def test_authenticated_compiler_self_is_portable_without_namespace(
        isolated_lumps, monkeypatch):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "isolated-artifact-key-" + "x" * 40)
    client = app_module.app.test_client()
    source = """abstraction ArtifactSelf {
    method Ping() { return(7) }
}
"""
    response = client.post("/api/compile", json={
        "source": source, "language": "javascript", "tier": 2})
    assert response.status_code == 200 and response.json["ok"], response.json
    compiled = response.json
    record = compiled["compiler_record"]
    payload = {"binary": compiled["words"], "metadata": {
        "abstraction": "ArtifactSelf", "language": "javascript",
        "content_type": "code", "capabilities": compiled["capabilities"],
        "submitted_source": source, "trust_origin": compiled["trust_origin"],
        "compiler_record": record, "compiler_identity": record["compiler_identity"],
        "compiler_version": record["compiler_version"], "grants": ["E"]}}
    before = (isolated_lumps / "ns-state.json").read_bytes()
    result = publish(client, payload)
    assert result["final_binary"][-1] == 0xFEED5E1F
    assert (isolated_lumps / "ns-state.json").read_bytes() == before


def test_new_revision_does_not_adopt_it_into_namespace(isolated_lumps):
    client = app_module.app.test_client()
    first = publish(client, candidate())
    old_bytes = (isolated_lumps / first["filename"]).read_bytes()
    state = {"abstractions": [{
        "slot": 14, "name": "LumpSaveTest", "token": first["token"],
        "filename": first["filename"], "binary_hash": first["binary_hash"],
        "resident": True, "load_policy": "Resident"}]}
    path = isolated_lumps / "ns-state.json"
    path.write_text(json.dumps(state))
    before = path.read_bytes()
    updated = candidate()
    updated["binary"] = _words(marker=3)
    second = publish(client, updated)
    assert second["lump_version"] > first["lump_version"]
    assert second["filename"] != first["filename"]
    assert path.read_bytes() == before
    assert (isolated_lumps / first["filename"]).read_bytes() == old_bytes


def test_copy_uses_new_pet_name_not_opened_artifact_identity(isolated_lumps):
    client = app_module.app.test_client()
    first = publish(client, candidate())
    copied = candidate()
    copied["metadata"].update(artifact_only=True, save_as_copy=True,
                              save_as_latest=False, abstraction="SeparateCopy")
    result = publish(client, copied)
    assert result["token"] != first["token"]
    assert result["abstraction"] == "SeparateCopy"
    repeated = client.post("/api/lumps/save-plan", json=copied)
    assert repeated.status_code == 409, repeated.json
    assert repeated.json["artifact_copy_conflict"]