"""Actual Flask routes, disposable copied state only; no route stubs or activation."""
import copy
import hashlib
import json
from pathlib import Path

import pytest

# Reuse the historical harness's fail-closed isolation checks, not its target.
from tests.server.test_namespace_save_acceptance import ROOT, LUMPS, STATE, server

URL = "/api/namespace/design-v1?profile=phase1"
HEADERS = {"X-Requested-With": "NamespaceDesign"}
TARGET = json.loads((ROOT / "tests/fixtures/phase1_namespace_target.json").read_text())
DESIGN = LUMPS / "design-drafts/phase1.json"


def protected():
    paths = list(LUMPS.rglob("*")) + [Path(server.BOOT_CONFIG_PATH)]
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths
            if p.is_file() and p != DESIGN and not p.name.startswith(".")
            and p.suffix != ".lock"}


@pytest.fixture
def client():
    before = protected()
    original = DESIGN.read_bytes()
    # No fixture upgrade: assert the copied selections and geometry exactly,
    # allowing only the known spelling to be corrected through the endpoint.
    copied = json.loads(original)
    next(r for r in copied["rows"] if r["slot"] == 16)["name"] = "ide.Alice"
    assert copied == TARGET
    for row in TARGET["rows"]:
        if "selection" in row:
            selected = row["selection"]
            assert hashlib.sha256((LUMPS / selected["filename"]).read_bytes()).hexdigest() == selected["binaryHash"]
    try:
        yield server.app.test_client()
        assert protected() == before
    finally:
        DESIGN.write_bytes(original)


def load(client, url=URL):
    response = client.get(url)
    assert response.status_code == 200, response.json
    return response.json


def payload(client, document):
    return dict(fingerprint=load(client)["fingerprint"], document=copy.deepcopy(document))


def review(client, data, url=URL):
    before = DESIGN.read_bytes()
    response = client.put(url, json=data, headers=HEADERS)
    assert response.status_code == 428, response.json
    assert DESIGN.read_bytes() == before
    return response.json["change_confirmation"]


def commit(client, data):
    receipt = review(client, data)
    response = client.put(URL, json=data, headers={
        **HEADERS, "X-Change-Confirmation": receipt["id"]})
    assert response.status_code == 200, response.json
    assert response.json["document"] == data["document"]
    assert load(client)["document"] == data["document"]
    assert json.loads(DESIGN.read_bytes()) == data["document"]
    assert response.json["projection"]["activationAllowed"] is False
    return response.json


def test_approved_target_edits_save_reload_exact_revisions(client):
    result = commit(client, payload(client, TARGET))
    projection = result["projection"]
    assert projection["tableWords"] == 1024
    assert projection["metadataWords"] == [0xF8840100, 0, 16, 0]
    assert len(projection["rows"]) == 17
    assert all(r["policy"] != "Lazy" for r in projection["rows"])
    assert [r["slot"] for r in projection["rows"] if r.get("unresolved")] == [9, 14, 15, 16, 17]
    assert next(r for r in projection["rows"] if r["slot"] == 1)["limit"] == 1023
    # Reopening from a new client reads disk, not a previous response or session.
    assert load(server.app.test_client())["document"] == TARGET


def test_boot_selection_roundtrip_preserves_every_other_field(client):
    commit(client, payload(client, TARGET))
    document = copy.deepcopy(TARGET)
    for slot in (7, 10):
        for row in document["rows"]:
            row["boot"] = row["slot"] == slot
        result = commit(client, payload(client, document))
        assert [r["slot"] for r in result["document"]["rows"] if r.get("boot")] == [slot]
        assert {r["slot"]: r.get("selection") for r in result["document"]["rows"]} == {
            r["slot"]: r.get("selection") for r in TARGET["rows"]}


def test_rejection_stale_tab_and_lazy_do_not_write(client):
    data = payload(client, TARGET)
    receipt = review(client, data)
    before = DESIGN.read_bytes()
    assert client.post("/api/change-reviews/reject", json={
        "review_id": receipt["review_id"], "outcome": "rejected"}).status_code == 200
    assert client.put(URL, json=data, headers={
        **HEADERS, "X-Change-Confirmation": receipt["id"]}).status_code == 409
    assert DESIGN.read_bytes() == before
    commit(client, data)
    # Guarantee a change even if a future source snapshot already spells Alice correctly.
    winner = copy.deepcopy(TARGET)
    winner["rows"][-1]["name"] = "ide.MalloryDraft"
    commit(client, payload(client, winner))
    before = DESIGN.read_bytes()
    receipt = review(client, data)
    response = client.put(URL, json=data, headers={
        **HEADERS, "X-Change-Confirmation": receipt["id"]})
    assert response.status_code == 409, response.json
    assert DESIGN.read_bytes() == before
    invalid = payload(client, TARGET)
    invalid["document"]["rows"][-1]["policy"] = "Lazy"
    response = client.put(URL, json=invalid, headers=HEADERS)
    assert response.status_code == 409, response.json
    assert "Resident" in response.json["message"]
    assert DESIGN.read_bytes() == before


def test_profile_cannot_overwrite_other_profile(client):
    ascending_url = "/api/namespace/design-v1?profile=ascending"
    ascending = load(client, ascending_url)
    before = protected(), DESIGN.read_bytes()
    data = payload(client, TARGET)
    receipt = review(client, data)
    response = client.put(ascending_url, json=data, headers={
        **HEADERS, "X-Change-Confirmation": receipt["id"]})
    assert response.status_code == 409, response.json
    # A fresh review cannot bypass the profile's document-format guard either.
    for url, wrong in ((ascending_url, data), (URL, {
            "fingerprint": load(client)["fingerprint"], "document": ascending["document"]})):
        receipt = review(client, wrong, url)
        response = client.put(url, json=wrong, headers={
            **HEADERS, "X-Change-Confirmation": receipt["id"]})
        assert response.status_code == 409, response.json
    assert (protected(), DESIGN.read_bytes()) == before
