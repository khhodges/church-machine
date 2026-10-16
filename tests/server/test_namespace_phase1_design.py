import ast
import copy
import json
from contextlib import nullcontext
from pathlib import Path

from flask import Flask, jsonify, request
import pytest
from server.change_confirmation import install
from server.namespace_design_v1 import DesignStore, phase1_seed, project, validate, seed


def test_phase1_table_and_members(tmp_path):
    d = phase1_seed()
    validate(d)
    p = project(d, tmp_path)
    assert d["slotCount"] == 256
    assert p["tableWords"] == 1024
    assert p["metadataWords"][0] == 0xF8840100
    rows = {r["slot"]: r for r in p["rows"]}
    assert rows[1]["limit"] == 1023
    assert rows[2]["location"] == 1024
    assert [rows[i]["name"] for i in (9, 14, 15)] == ["ide.Mint", "nstab", "pkverify"]
    assert not p["activationAllowed"] and not p["buildReady"]
    assert all(rows[i]["location"] is None for i in (9, 14, 15))


def test_separate_persistence_and_high_slot(tmp_path):
    live = tmp_path / "ns-state.json"
    live.write_text('{"abstractions":[]}')
    old = DesignStore(tmp_path / "old.json", tmp_path, live)
    new = DesignStore(tmp_path / "phase1.json", tmp_path, live, phase1=True)
    old_before = old.read()
    r = new.read()
    d = copy.deepcopy(r["document"])
    d["rows"].append(dict(slot=255, name="ide.Future", kind="lump",
                          policy="Resident", sequence=0))
    saved = new.save(dict(fingerprint=r["fingerprint"], document=d))
    assert new.read()["document"] == d
    assert saved["persisted"]
    assert old.read() == old_before
    assert live.read_text() == '{"abstractions":[]}'
    with pytest.raises(ValueError, match="another tab"):
        new.save(dict(fingerprint=r["fingerprint"], document=d))
    with pytest.raises(ValueError, match="profile"):
        old.save(dict(fingerprint=old_before["fingerprint"], document=d))
    d["slotCount"] = 128
    with pytest.raises(ValueError, match="slot"):
        validate(d)


def test_capacity_is_configurable_and_old_geometry_stays(tmp_path):
    d = phase1_seed()
    d["slotCount"] = 512
    assert project(d, tmp_path)["tableWords"] == 2048
    assert project(seed({}), tmp_path)["tableWords"] == 256
    for bad in (True, 15, 4097, 256.5):
        d["slotCount"] = bad
        with pytest.raises(ValueError):
            validate(d)

@pytest.fixture
def design_http(tmp_path):
    """Run production route/review functions without importing app startup.

    Even the protected-path collector sees only this temporary project tree;
    review tokens and sessions are private to each test.
    """
    source = Path(__file__).resolve().parents[2] / "server/app.py"
    names = {"namespace_design_v1", "_change_confirmation_paths",
             "_describe_protected_change"}
    nodes = [node for node in ast.parse(source.read_text()).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == names
    for node in nodes:
        node.decorator_list = []
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="private-phase1-test-session")
    state = tmp_path / "ns-state.json"
    state.write_text('{"abstractions":[]}')
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    drafts = tmp_path / "design-drafts"
    drafts.mkdir()
    paths = {"state": state, "ascending": drafts / "ascending-v1.json",
             "phase1": drafts / "phase1.json"}
    paths["ascending"].write_text(json.dumps(seed({})))
    paths["phase1"].write_text(json.dumps(phase1_seed()))
    scope = dict(app=app, request=request, jsonify=jsonify,
                 __file__=str(tmp_path / "server/app.py"),
                 NS_STATE_PATH=str(state), LUMPS_DIR=str(lumps),
                 _LUMP_LEASE_REGISTRY="leases.json")
    for name in ("BOOT_CONFIG_PATH", "LUMPS_MANIFEST_PATH", "BOOT_IMAGE_PATH",
                 "BOOT_IMAGE_PROVENANCE_PATH"):
        scope[name] = str(tmp_path / name)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), scope)
    app.add_url_rule("/api/namespace/design-v1",
                     view_func=scope["namespace_design_v1"], methods=["GET", "PUT"])
    install(app, scope["_change_confirmation_paths"], nullcontext,
            describe=scope["_describe_protected_change"],
            store_path=tmp_path / "reviews.sqlite")
    return app.test_client(), paths


def test_phase1_rejects_lazy_and_recovers_named_slots(tmp_path):
    live = tmp_path / "ns-state.json"
    live.write_text('{"abstractions":[]}')
    store = DesignStore(tmp_path / "phase1.json", tmp_path, live, phase1=True)
    response = store.read()
    document = response["document"]
    assert all(r["policy"] == "Resident" for r in document["rows"] if r["kind"] == "lump")
    for slot, name in [(16, "ide.Alace"), (17, "ide.Mallory")]:
        document["rows"].append(dict(slot=slot, name=name, kind="lump",
                                    policy="Resident", sequence=0))
    store.save(dict(fingerprint=response["fingerprint"], document=document))
    reopened = DesignStore(tmp_path / "phase1.json", tmp_path, live, phase1=True).read()
    assert reopened["persisted"]
    assert reopened["document"] == document
    document["rows"][-1]["policy"] = "Lazy"
    with pytest.raises(ValueError, match="must be Resident"):
        store.save(dict(fingerprint=reopened["fingerprint"], document=document))
    assert store.read() == reopened

def design_snapshot(paths):
    return {key: path.read_bytes() if path.exists() else None
            for key, path in paths.items()}

@pytest.mark.parametrize("existing", [False, True])
def test_http_phase1_review_save_reload_and_single_use(design_http, existing):
    client, paths = design_http
    if not existing:
        paths["phase1"].unlink()
    before = design_snapshot(paths)
    payload = design_payload(client)
    token = design_review(client, paths, payload)
    response = design_put(client, payload, token=token)
    assert response.status_code == 200, response.json
    assert response.json["persisted"] is True
    assert response.json["document"] == payload["document"]
    assert response.json["fingerprint"] != payload["fingerprint"]
    assert client.get(design_url("phase1")).json == response.json
    assert json.loads(paths["phase1"].read_bytes()) == payload["document"]
    after = design_snapshot(paths)
    assert after["ascending"] == before["ascending"]
    assert after["state"] == before["state"]
    assert_review_rejected(design_put(client, payload, token=token), "missing_or_used")
    assert design_snapshot(paths) == after

def design_review(client, paths, payload, profile="phase1"):
    before = design_snapshot(paths)
    response = design_put(client, payload, profile)
    assert response.status_code == 428, response.json
    assert response.json["committed"] is False
    assert design_snapshot(paths) == before
    return response.json["change_confirmation"]["id"]

@pytest.mark.parametrize("field", ["document", "fingerprint"])
def test_http_approval_binds_exact_payload(design_http, field):
    client, paths = design_http
    payload = design_payload(client)
    token = design_review(client, paths, payload)
    changed = copy.deepcopy(payload)
    if field == "document":
        changed["document"]["rows"][-1]["name"] = "ide.Unreviewed"
    else:
        changed["fingerprint"] = "0" * 64
    before = design_snapshot(paths)
    assert_review_rejected(design_put(client, changed, token=token), "request_changed")
    assert_review_rejected(design_put(client, payload, token=token), "missing_or_used")
    assert design_snapshot(paths) == before

@pytest.mark.parametrize("source,target", [
    ("phase1", "ascending"), ("ascending", "phase1"),
])
def test_http_approval_cannot_cross_profiles(design_http, source, target):
    client, paths = design_http
    payload = design_payload(client, source)
    token = design_review(client, paths, payload, source)
    before = design_snapshot(paths)
    # Identical body isolates the query-string/profile binding from body binding.
    assert_review_rejected(design_put(client, payload, target, token), "request_changed")
    assert_review_rejected(design_put(client, payload, source, token), "missing_or_used")
    assert design_snapshot(paths) == before

def design_payload(client, profile="phase1"):
    response = client.get(design_url(profile))
    assert response.status_code == 200, response.json
    payload = {key: response.json[key] for key in ("document", "fingerprint")}
    payload["document"]["rows"].append(dict(
        slot=30, name="ide.Proposed", kind="lump", policy="Lazy", sequence=0))
    return payload

def design_url(profile):
    return "/api/namespace/design-v1?profile=" + profile

def design_put(client, payload, profile="phase1", token=None):
    headers = {"X-Requested-With": "NamespaceDesign"}
    if token is not None:
        headers["X-Change-Confirmation"] = token
    return client.put(design_url(profile), json=payload, headers=headers)

def assert_review_rejected(response, reason):
    assert response.status_code == 409, response.json
    assert response.json["error"] == "change_confirmation_invalid"
    assert response.json["rejection_reason"] == reason
    assert response.json["committed"] is False

@pytest.mark.parametrize("changed_profile", ["phase1", "ascending"])
def test_http_save_invalidates_pending_phase1_approval(design_http, changed_profile):
    client, paths = design_http
    pending = design_payload(client)
    token = design_review(client, paths, pending)
    winner = design_payload(client, changed_profile)
    winner["document"]["rows"][-1]["name"] = "ide.Winner"
    winner_token = design_review(client, paths, winner, changed_profile)
    response = design_put(client, winner, changed_profile, winner_token)
    assert response.status_code == 200, response.json
    before = design_snapshot(paths)
    assert_review_rejected(design_put(client, pending, token=token), "saved_state_changed")
    assert_review_rejected(design_put(client, pending, token=token), "missing_or_used")
    assert design_snapshot(paths) == before
    assert client.get(design_url(changed_profile)).json["document"] == winner["document"]

def test_http_new_review_does_not_bypass_stale_design_fingerprint(design_http):
    client, paths = design_http
    stale = design_payload(client)
    winner = copy.deepcopy(stale)
    winner["document"]["rows"][-1]["name"] = "ide.Winner"
    token = design_review(client, paths, winner)
    assert design_put(client, winner, token=token).status_code == 200
    # A fresh approval of an old editor snapshot must still pass DesignStore CAS.
    token = design_review(client, paths, stale)
    before = design_snapshot(paths)
    response = design_put(client, stale, token=token)
    assert response.status_code == 409, response.json
    assert "another tab" in response.json["error"]
    assert response.json["dataChanged"] is False
    assert design_snapshot(paths) == before
