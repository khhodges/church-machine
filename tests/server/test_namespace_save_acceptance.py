"""Real production endpoints; invoke only via the isolated acceptance runner."""
import copy
import hashlib
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1", "Use the isolated runner"
for key in ("CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH",
            "CHURCH_TEST_BUILD_SNAPSHOTS_DIR", "CHURCH_TEST_DB_PATH"):
    path = Path(os.environ[key]).resolve(strict=True)
    assert not path.is_relative_to(ROOT / "server"), "Refusing live writable state"

from server import app as server

LUMPS = Path(server.LUMPS_DIR)
STATE = Path(server.NS_STATE_PATH)


def protected():
    paths = [p for p in LUMPS.rglob("*") if p.is_file()
             and p.suffix in (".json", ".lump", ".bin", ".cloomc")
             and p != STATE and not p.name.startswith(".")]
    paths.append(Path(server.BOOT_CONFIG_PATH))
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


@pytest.fixture
def client():
    state = STATE.read_bytes()
    manifest = Path(server.LUMPS_MANIFEST_PATH)
    original_manifest = manifest.read_bytes()
    # Exact Namespace choices remain authoritative with no active catalog row.
    selected = {row.get("filename") for row in json.loads(state)["abstractions"]}
    manifest.write_text(json.dumps([row for row in json.loads(original_manifest)
                                   if row.get("filename") not in selected]))
    before = protected()
    try:
        yield server.app.test_client()
        assert protected() == before
    finally:
        STATE.write_bytes(state)
        manifest.write_bytes(original_manifest)


def load(client):
    response = client.get("/api/boot-image/ns-state")
    assert response.status_code == 200, response.json
    return response.json


def payload(state, rows):
    return {"namespaceFingerprint": state["namespaceFingerprint"],
            "ns_state": {"abstractions": rows}}


def confirm(client, data):
    before = STATE.read_bytes()
    review = client.post("/api/namespace/save-table", json=data)
    assert review.status_code == 428, review.json
    assert STATE.read_bytes() == before
    response = client.post("/api/namespace/save-table", json=data, headers={
        "X-Change-Confirmation": review.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    assert response.json["imageRebuilt"] is False
    assert response.json["savedAbstractions"] == data["ns_state"]["abstractions"]
    assert load(client)["savedAbstractions"] == data["ns_state"]["abstractions"]
    return response.json


def test_save_reload_resident_and_exact_identity_without_catalog_membership(client):
    original = load(client)
    rows = copy.deepcopy(original["savedAbstractions"])
    row = next(r for r in rows if r["slot"] == 7)
    row.update(resident=False, load_policy="Lazy")
    saved = confirm(client, payload(original, rows))
    row.update(resident=True, load_policy="Resident")
    confirm(client, payload(saved, rows))
    assert rows == original["savedAbstractions"]


def test_incomplete_design_save_reload_is_not_image_admission(client):
    original = load(client)
    rows = copy.deepcopy(original["savedAbstractions"])
    rows.append({"slot": 14, "name": "Acceptance.Future", "seq": 0,
                 "symbolic": True, "implementationMissing": True,
                 "resident": False, "location": "0x00000000",
                 "selection": {"status": "missing", "filename": "missing.lump",
                               "diagnostic": "Implementation not yet written"}})
    confirm(client, payload(original, rows))


def test_cancel_and_stale_tabs_leave_exact_saved_state(client):
    original = load(client)
    rows = copy.deepcopy(original["savedAbstractions"])
    next(r for r in rows if r["slot"] == 7).update(resident=False, load_policy="Lazy")
    data = payload(original, rows)
    before = STATE.read_bytes()
    review = client.post("/api/namespace/save-table", json=data)
    assert review.status_code == 428, review.json
    receipt = review.json["change_confirmation"]
    assert client.post("/api/change-reviews/reject", json={
        "review_id": receipt["review_id"], "outcome": "rejected"}).status_code == 200
    assert client.post("/api/namespace/save-table", json=data, headers={
        "X-Change-Confirmation": receipt["id"]}).status_code == 409
    assert STATE.read_bytes() == before
    confirm(client, data)
    before = STATE.read_bytes()
    stale = client.post("/api/namespace/save-table", json=payload(
        original, original["savedAbstractions"]))
    assert stale.status_code == 409, stale.json
    assert "reload" in stale.json["message"].lower()
    assert "change_confirmation" not in stale.json
    assert STATE.read_bytes() == before


def test_boot_selection_exact_revision_reload_and_stale_rejection(client):
    original = load(client)
    row = next(r for r in original["savedAbstractions"] if r["slot"] == 7)
    data = dict(slot=7, revision=row.get("revision", row.get("lump_version", row.get("issue_n"))),
                token=row["token"], filename=row["filename"],
                namespaceFingerprint=original["namespaceFingerprint"])
    headers = {"Authorization": "Bearer namespace-acceptance-test-only"}
    response = client.post("/api/namespace/boot-marker", json=data, headers=headers)
    if response.status_code == 428:
        headers["X-Change-Confirmation"] = response.json["change_confirmation"]["id"]
        response = client.post("/api/namespace/boot-marker", json=data, headers=headers)
    assert response.status_code == 200, response.json
    reloaded = load(client)
    expected = copy.deepcopy(original["savedAbstractions"])
    for r in expected:
        r.pop("boot", None)
        if r["slot"] == 7:
            r["boot"] = True
    assert reloaded["savedAbstractions"] == expected
    before = STATE.read_bytes()
    rejected = client.post("/api/namespace/boot-marker", json=data, headers={
        "Authorization": "Bearer namespace-acceptance-test-only"})
    if rejected.status_code == 428:
        rejected = client.post("/api/namespace/boot-marker", json=data, headers={
            "Authorization": "Bearer namespace-acceptance-test-only",
            "X-Change-Confirmation": rejected.json["change_confirmation"]["id"]})
    assert rejected.status_code == 409, rejected.json
    assert STATE.read_bytes() == before
