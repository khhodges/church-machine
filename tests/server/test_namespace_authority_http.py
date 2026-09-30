"""Real HTTP save-plan/commit regressions; run only with isolated server paths."""
import copy
import hashlib
import json
import os

assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1"
from test_lump_save_endpoint import app_module, isolated_lumps, _words


def candidate():
    return {"binary": _words(), "metadata": {
        "token": "7c501001", "abstraction": "LumpSaveTest",
        "content_type": "code", "language": "assembly", "ns_slot": 7,
        "capabilities": [], "methods": [], "grants": ["E"],
        "namespaceFingerprint": app_module._read_authoritative_namespace_rows()[1],
    }}


def test_http_missing_and_stale_revision_do_not_publish(isolated_lumps):
    client = app_module.app.test_client()
    before = (isolated_lumps / "ns-state.json").read_bytes()
    payload = candidate()
    for fingerprint in (None, "stale"):
        payload["metadata"]["namespaceFingerprint"] = fingerprint
        response = client.post("/api/lumps/save-plan", json=payload)
        assert response.status_code == 409, response.json
        assert response.json["committed"] is False
    assert (isolated_lumps / "ns-state.json").read_bytes() == before
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def approved(client, payload):
    planned = client.post("/api/lumps/save-plan", json=payload)
    assert planned.status_code == 201, planned.json
    plan = planned.json
    approval = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"],
        "plan_id": plan["plan_id"], "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"}})
    assert approval.status_code == 201, approval.json
    payload = copy.deepcopy(payload)
    payload["metadata"].update(save_plan_id=plan["plan_id"],
                               approval_intent=approval.json["intent"])
    return payload


def commit(client, payload):
    response = client.post("/api/lumps/save", json=payload)
    if response.status_code == 428:
        response = client.post("/api/lumps/save", json=payload, headers={
            "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
    return response


def test_http_commit_preserves_policy(isolated_lumps):
    state = isolated_lumps / "ns-state.json"
    rows = json.loads(state.read_text())
    rows["abstractions"][1].update(resident=False, load_policy="Lazy")
    state.write_text(json.dumps(rows))
    client = app_module.app.test_client()
    payload = approved(client, candidate())
    response = commit(client, payload)
    assert response.status_code == 200, response.json
    row = json.loads(state.read_text())["abstractions"][1]
    assert row["resident"] is False and row["load_policy"] == "Lazy"


def test_http_commit_rejects_namespace_changed_after_review(isolated_lumps):
    client = app_module.app.test_client()
    payload = approved(client, candidate())
    state = isolated_lumps / "ns-state.json"
    rows = json.loads(state.read_text())
    rows["abstractions"][0]["name"] = "Renamed.Boot"
    state.write_text(json.dumps(rows))
    before = state.read_bytes()
    response = commit(client, payload)
    assert response.status_code == 409, response.json
    assert response.json["committed"] is False
    assert state.read_bytes() == before
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def test_http_design_destination_cannot_be_installed_by_save(isolated_lumps):
    state = isolated_lumps / "ns-state.json"
    rows = json.loads(state.read_text())
    rows["abstractions"][1].update(
        symbolic=True, implementationMissing=True, location="0x00000000")
    state.write_text(json.dumps(rows))
    before = state.read_bytes()
    client = app_module.app.test_client()
    planned = client.post("/api/lumps/save-plan", json=candidate())
    # Rejection must be explicit, either during planning or before publication.
    if planned.status_code == 201:
        payload = approved(client, candidate())
        rejected = commit(client, payload)
    else:
        rejected = planned
    assert rejected.status_code in (409, 422), rejected.json
    assert state.read_bytes() == before
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def test_http_new_entry_plan_is_read_only_until_confirmed(isolated_lumps):
    state = isolated_lumps / "ns-state.json"
    before = state.read_bytes()
    client = app_module.app.test_client()
    payload = candidate()
    payload["metadata"].update(ns_slot=None, new_entry=True)
    payload = approved(client, payload)
    assert state.read_bytes() == before
    response = commit(client, payload)
    assert response.status_code == 200, response.json
    added = [row for row in json.loads(state.read_text())["abstractions"]
             if row["name"] == "LumpSaveTest"]
    assert len(added) == 1 and added[0]["resident"] is True


def test_http_new_fingerprint_cannot_reuse_old_approval(isolated_lumps):
    client = app_module.app.test_client()
    payload = approved(client, candidate())
    state = isolated_lumps / "ns-state.json"
    rows = json.loads(state.read_text())
    rows["abstractions"][0]["name"] = "Renamed.Boot"
    state.write_text(json.dumps(rows))
    payload["metadata"]["namespaceFingerprint"] = (
        app_module._read_authoritative_namespace_rows()[1])
    response = commit(client, payload)
    assert response.status_code == 409, response.json
    assert response.json["committed"] is False


def test_image_writer_fingerprints_final_published_rows(isolated_lumps, monkeypatch):
    # Isolate image validation: this test targets writer ordering, not binary
    # validity (covered by full-body/provenance tests with real images).
    state = isolated_lumps / "ns-state.json"
    rows, old = app_module._read_authoritative_namespace_rows()
    rows[1]["location"] = "0x00000800"
    app_module._write_ns_state(rows)
    final = app_module._namespace_state_fingerprint(rows)
    assert final != old
    observed = []

    def build(_image, _directory, ns_state_path):
        actual = json.loads(open(ns_state_path).read())["abstractions"]
        fingerprint = app_module._namespace_state_fingerprint(actual)
        observed.append(fingerprint)
        return {"namespace_fingerprint": fingerprint}

    monkeypatch.setattr(app_module._boot_image_gen, "validate_boot_image", lambda _: None)
    monkeypatch.setattr(app_module._boot_image_gen, "build_boot_image_provenance", build)
    app_module._write_boot_image_bytes(
        b"isolated-writer-order-test", invalidate_ns_state=False, boot_config={})
    provenance = json.loads((isolated_lumps / "boot-image-provenance.json").read_text())
    assert observed == [final]
    assert provenance["namespace_fingerprint"] == final
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(state.read_bytes()).hexdigest()