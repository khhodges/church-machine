"""Test-owned files, real admission/allocation and protected save confirmation."""
import copy
from contextlib import nullcontext
import hashlib
import json
import struct

import pytest
from test_namespace_table_save import isolated, snapshot, review as protected_review
from server import boot_image
from server.lump_approvals import sign_compiler_record, write_approvals
from server.namespace_authority import namespace_fingerprint


@pytest.fixture
def upgrades(isolated, monkeypatch):
    app, payload, state, paths, scope = isolated
    root = state.parent
    key = b"namespace-upgrade-test-only-key" * 2
    monkeypatch.setattr(boot_image, "compiler_record_verification_key", lambda _: key)
    scope["_boot_image_gen"] = boot_image
    scope["_lump_history_transition_lock"] = lambda _: nullcontext()
    catalog, approvals, rows = [], {}, []

    def artifact(name, version, slot, size=256, admitted=True, token=None):
        n = size.bit_length() - 7
        raw = struct.pack(f">{size}I",
                          (31 << 27) | (n << 23) | (1 << 10) | 1,
                          version, *([0] * (size - 3)), 0x4a000000 | slot)
        digest = hashlib.sha256(raw).hexdigest()
        filename = f"{name}.1.{digest[:8]}.lump"
        (root / filename).write_bytes(raw)
        row = dict(abstraction=name, filename=filename, binary_hash=digest,
                   lump_version=version, token=token or f"{slot * 100 + version:08x}",
                   issue_n=1, archived=version == 1)
        catalog.append(row)
        if admitted:
            approvals[digest] = {
                "binary_hash": digest, "filename": filename,
                "dot_name": name, "issue_n": 1, "trust_origin": "trusted-home-ide",
                "compiler_identity": "CLOOMC", "compiler_version": "test",
                "compiler_record": sign_compiler_record(
                    {"binary_hash": digest}, signing_key=key),
            }
        publish()
        return row

    def publish():
        (root / "manifest.json").write_text(json.dumps(catalog))
        write_approvals(str(root / "approvals.json"), approvals)

    for slot, name in ((14, "Alice"), (15, "Bob")):
        old = artifact(name, 1, slot)
        artifact(name, 2, slot)
        rows.append(dict(name=name, slot=slot, type="Inform", seq=0, f=0, g=0,
                         resident=True, boot_resident=True, load_policy="Resident",
                         location=1024 + (slot - 14) * 256, limit=254, seal=123,
                         boot=slot == 14, **{k: old[k] for k in
                         ("filename", "token", "lump_version", "binary_hash")}))
    state.write_text(json.dumps({"abstractions": rows, "save_mode": "table-only"}))
    payload = dict(namespaceFingerprint=namespace_fingerprint(rows),
                   ns_state={"abstractions": copy.deepcopy(rows)})
    return app.test_client(), payload, state, scope, catalog, artifact, publish


def check(client, payload):
    response = client.post("/api/namespace/review-upgrades", json=payload)
    assert response.status_code == 200, response.json
    return response.json


def approved_payload(payload, report, slots):
    from server.namespace_upgrades import apply
    result = copy.deepcopy(payload)
    draft = result["ns_state"]["abstractions"]
    result["upgradeReview"] = dict(draft=copy.deepcopy(draft),
                                  reviewFingerprint=report["reviewFingerprint"], slots=slots)
    result["ns_state"]["abstractions"] = apply(report, draft, slots)
    return result


@pytest.mark.parametrize("slots", [[14], [], [14, 15]])
def test_independent_choices_preserve_exact_skipped_artifacts(upgrades, slots):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    originals = snapshot([p for p in state.parent.iterdir() if not p.name.startswith("reviews.sqlite")])
    report = check(client, payload)
    assert len(report["upgrades"]) == 2
    assert all(not c["blocked"] for c in report["upgrades"]), report
    assert all(c["selected"]["token"] != c["proposed"]["token"] for c in report["upgrades"])
    candidate = approved_payload(payload, report, slots)
    receipt = protected_review(client, candidate)
    assert snapshot([__import__("pathlib").Path(p) for p in originals]) == originals
    result = client.post("/api/namespace/save-table", json=candidate,
                         headers={"X-Change-Confirmation": receipt["id"]})
    assert result.status_code == 200, result.json
    assert result.json["imageRebuilt"] is False
    for before, after in zip(payload["ns_state"]["abstractions"], result.json["abstractions"]):
        assert after["boot"] == before["boot"]
        assert after["location"] == before["location"]
        if after["slot"] not in slots:
            assert after == before
        else:
            assert after["lump_version"] == 2
            assert after["artifact_pin"]["revision"] == 2
    for path, data in originals.items():
        if path != str(state):
            assert __import__("pathlib").Path(path).read_bytes() == data


def test_no_updates_and_corrupt_catalog_is_not_no_updates(upgrades):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    catalog[:] = [c for c in catalog if c["lump_version"] == 1]
    publish()
    report = check(client, payload)
    assert report["upgrades"] == []
    before = state.read_bytes()
    (state.parent / "manifest.json").write_text("{")
    response = client.post("/api/namespace/review-upgrades", json=payload)
    assert response.status_code == 409
    assert "Upgrade check failed" in response.json["error"]
    assert state.read_bytes() == before


@pytest.mark.parametrize("mutation", ["new_revision", "bytes", "namespace", "draft", "hash"])
def test_changes_after_review_require_renewed_review(upgrades, mutation):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    report = check(client, payload)
    candidate = approved_payload(payload, report, [14])
    receipt = protected_review(client, candidate)
    if mutation == "new_revision":
        artifact("Alice", 3, 14)
    elif mutation == "bytes":
        (state.parent / report["upgrades"][0]["proposed"]["filename"]).write_bytes(b"changed")
    elif mutation == "namespace":
        saved = json.loads(state.read_text())
        saved["abstractions"][0]["seq"] = 1
        state.write_text(json.dumps(saved))
    elif mutation == "draft":
        candidate["ns_state"]["abstractions"][0]["name"] = "Unreviewed"
    else:
        candidate["ns_state"]["abstractions"][0]["binary_hash"] = "0" * 64
    before = state.read_bytes()
    response = client.post("/api/namespace/save-table", json=candidate,
                           headers={"X-Change-Confirmation": receipt["id"]})
    assert response.status_code == 409, response.json
    assert state.read_bytes() == before
    # Also verify candidate-level checks independently of generic review snapshot.
    with scope["app"].test_request_context():
        with pytest.raises(ValueError):
            scope["_namespace_table_candidate"](candidate)


def test_incompatible_allocation_and_unadmitted_revisions_are_blocked(upgrades):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    catalog[:] = [c for c in catalog if c["lump_version"] == 1]
    artifact("Alice", 3, 14, size=512)  # overlaps Bob
    artifact("Bob", 3, 15, admitted=False)
    report = check(client, payload)
    assert all(c["blocked"] for c in report["upgrades"])
    assert "overlap" in report["upgrades"][0]["blocked"].lower()
    assert "approval" in report["upgrades"][1]["blocked"].lower()
    from server.namespace_upgrades import apply
    with pytest.raises(ValueError, match="not an eligible"):
        apply(report, payload["ns_state"]["abstractions"], [14])
    # Skipping every blocked upgrade is still a valid save.
    candidate = approved_payload(payload, report, [])
    protected_review(client, candidate)


def test_reused_token_and_archived_newer_revision_are_not_lost(upgrades):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    token = payload["ns_state"]["abstractions"][0]["token"]
    entry = artifact("Alice", 3, 14, token=token)
    entry["archived"] = True
    publish()
    report = check(client, payload)
    assert report["upgrades"][0]["proposed"]["token"] == token
    assert report["upgrades"][0]["proposed"]["lump_version"] == 3
    assert report["upgrades"][0]["blocked"] is None


@pytest.mark.parametrize("exact_catalog_match", [True, False])
def test_inspector_selection_without_revision_preserves_unrelated_save(upgrades, exact_catalog_match):
    client, payload, state, scope, catalog, artifact, publish = upgrades
    rows = copy.deepcopy(payload["ns_state"]["abstractions"])
    rows[0].pop("lump_version")  # Exact inspector selection without ordering metadata.
    state.write_text(json.dumps({"abstractions": rows, "save_mode": "table-only"}))
    payload["namespaceFingerprint"] = namespace_fingerprint(rows)
    payload["ns_state"]["abstractions"] = copy.deepcopy(rows)
    payload["ns_state"]["abstractions"][1]["seal"] = 456  # unrelated design edit
    if not exact_catalog_match:
        catalog[:] = [r for r in catalog
                      if not (r["abstraction"] == "Alice" and r["lump_version"] == 1)]
        publish()
    report = check(client, payload)
    alice = next(u for u in report["upgrades"] if u["slot"] == 14)
    if exact_catalog_match:
        assert alice["selected"]["lump_version"] == 1
        assert alice["proposed"]["lump_version"] == 2
        assert not alice["blocked"]
    else:
        assert "Revision ordering is unavailable" in alice["blocked"]
        assert alice["replacement"] is None
    candidate = approved_payload(payload, report, [])
    receipt = protected_review(client, candidate)
    response = client.post("/api/namespace/save-table", json=candidate,
                           headers={"X-Change-Confirmation": receipt["id"]})
    assert response.status_code == 200, response.json
    assert response.json["abstractions"][0] == rows[0]
    assert response.json["abstractions"][1]["seal"] == 456
    assert response.json["imageRebuilt"] is False