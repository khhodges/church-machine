"""Namespace-only save exercises production review/CAS/persistence in isolation."""
import ast
import copy
from contextlib import nullcontext
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import struct
import tempfile

from flask import Flask, jsonify, request
import pytest

from server.change_confirmation import install
from server.namespace_authority import namespace_fingerprint


@pytest.fixture
def isolated(tmp_path):
    root = Path(__file__).resolve().parents[2]
    names = {
        "_read_namespace_design_document", "_namespace_table_candidate",
        "namespace_save_table", "_atomic_write_json", "_describe_protected_change",
        "boot_image_ns_state",
        "_ensure_ns_state", "_validate_namespace_boot_marker",
        "_project_effective_thread_policies", "_thread_slots_from_namespace_rows",
        "_resolve_namespace_saved_artifacts", "_read_manifest_safe", "_file_sha256",
    }
    tree = ast.parse((root / "server/app.py").read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    app = Flask(__name__)
    app.secret_key = "isolated-namespace-design-test"
    state = tmp_path / "ns-state.json"
    rows = [dict(slot=14, name="ide.Alice", filename="ide.Alice.1.a91d33f7.lump",
                 binary_hash="2" * 64, token="4730c311", lump_version=2,
                 issue_n=1, resident=True, load_policy="Resident",
                 location="0x00000400", limit="0x00009", seq=0)]
    state.write_text(json.dumps({"abstractions": rows, "committed_raw_fingerprint": "old"}))
    for name in ("boot-image.bin", "boot-image.provenance.json", "boot-config.json",
                 "manifest.json", "ide.Alice.1.a91d33f7.lump", "source.cloomc"):
        (tmp_path / name).write_bytes(b"synthetic immutable test artifact")
    scope = dict(app=app, request=request, jsonify=jsonify, json=json, os=os,
                 re=re, tempfile=tempfile, logging=logging, copy=copy, struct=struct,
                 hashlib=hashlib,
                 __file__=str(root / "server/app.py"),
                 NS_STATE_PATH=str(state), MAX_NS_ENTRIES=256,
                 LUMPS_DIR=str(tmp_path),
                 BOOT_IMAGE_PATH=str(tmp_path / "boot-image.bin"),
                 BOOT_CONFIG_PATH=str(tmp_path / "boot-config.json"),
                 _boot_execution_freshness=lambda *args: {"status": "unknown"},
                 _namespace_state_fingerprint=namespace_fingerprint,
                 _namespace_commit_guard=nullcontext)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<table routes>", "exec"), scope)
    app.add_url_rule("/api/namespace/save-table",
                     view_func=scope["namespace_save_table"], methods=["POST"])
    app.add_url_rule("/api/boot-image/ns-state",
                     view_func=scope["boot_image_ns_state"], methods=["GET"])
    paths = list(tmp_path.iterdir())
    install(app, lambda: paths, nullcontext,
            describe=scope["_describe_protected_change"],
            store_path=tmp_path / "reviews.sqlite")
    payload = dict(namespaceFingerprint=namespace_fingerprint(rows),
                   ns_state={"abstractions": copy.deepcopy(rows)})
    payload["ns_state"]["abstractions"][0]["location"] = "0x00001400"
    return app, payload, state, paths, scope


def snapshot(paths):
    return {str(p): p.read_bytes() for p in paths}


def review(client, payload):
    result = client.post("/api/namespace/save-table", json=payload)
    assert result.status_code == 428, result.json
    return result.json["change_confirmation"]


def test_unattested_missing_and_malformed_choices_save_exactly_and_reload(isolated):
    app, payload, state, paths, scope = isolated
    # Broken file bytes, nonexistent artifacts, contradictory design policy and
    # no boot marker are all permitted as design state, never executable approval.
    payload["ns_state"]["abstractions"].extend([
        dict(slot=15, name="Future", symbolic=True, resident=True,
             implementationMissing=True, selection={
                 "status": "missing", "filename": "missing.lump",
                 "diagnostic": "No saved implementation"}),
        dict(slot=16, name="Overlap", location="0x00001400", limit="0x000FF"),
    ])
    original = snapshot(paths)
    client = app.test_client()
    pending = review(client, payload)
    assert snapshot(paths) == original
    text = "\n".join(pending["changes"])
    assert "ide.Alice" in text and "submitted saved revision 2" in text
    assert "location" in text and "0x00001400" in text and "resident" in text
    result = client.post("/api/namespace/save-table", json=payload,
                         headers={"X-Change-Confirmation": pending["id"]})
    assert result.status_code == 200, result.json
    expected = payload["ns_state"]["abstractions"]
    assert result.json["abstractions"] == expected
    assert result.json["savedAbstractions"] == expected
    assert result.json["namespaceFingerprint"] == namespace_fingerprint(expected)
    assert result.json["imageRebuilt"] is False
    assert result.json["imageStatus"] == "not-rebuilt"
    saved = json.loads(state.read_text())
    assert saved["abstractions"] == expected
    assert "committed_raw_fingerprint" not in saved
    assert saved["save_mode"] == "table-only"
    restored = client.get("/api/boot-image/ns-state")
    assert restored.status_code == 200, restored.json
    assert restored.json["abstractions"] == expected
    assert restored.json["savedAbstractions"] == expected
    assert restored.json["namespaceFingerprint"] == namespace_fingerprint(expected)
    assert "committed" not in restored.json  # old image never overlaid
    for path in paths:
        if path != state:
            assert path.read_bytes() == original[str(path)]
    replay = client.post("/api/namespace/save-table", json=payload,
                         headers={"X-Change-Confirmation": pending["id"]})
    assert replay.status_code == 409


def test_first_save_uses_persisted_rows_not_legacy_display_enrichment(isolated):
    """Real GET + Thread/catalogue projectors -> protected review -> commit."""
    app, payload, state, paths, scope = isolated
    rows = [
        {"slot": 6, "name": "Legacy.Unbound", "type": "Inform", "seq": 0},
        {"slot": 12, "name": "Thread.3", "location": "0x00000001", "seq": 0},
        {"slot": 14, "name": "Editable", "boot": True, "seq": 0,
         "selectionNotes": {"owner": "programmer"}},
    ]
    state.write_text(json.dumps({"abstractions": rows}))
    candidate_file = state.parent / "Legacy.Unbound.1.12345678.lump"
    candidate_file.write_bytes(b"synthetic unique catalogue candidate")
    paths.append(candidate_file)
    (state.parent / "manifest.json").write_text(json.dumps([{
        "abstraction": "Legacy.Unbound", "filename": candidate_file.name,
        "token": "12345678", "lump_version": 9,
    }]))
    # Real Thread inference from the old image, not from the saved name.
    (state.parent / "boot-image.bin").write_bytes(
        struct.pack("<2I", 0, (31 << 27) | (2 << 23) | (2 << 8)))
    before = snapshot(paths)
    client = app.test_client()
    result = client.get("/api/boot-image/ns-state")
    assert result.status_code == 200, result.json
    display, saved = result.json["abstractions"], result.json["savedAbstractions"]
    assert saved == rows
    assert result.json["namespaceFingerprint"] == namespace_fingerprint(saved)
    assert display[0]["filename"] == candidate_file.name
    assert display[0]["token"] == "12345678"
    assert display[0]["lump_version"] == 9
    assert display[1]["resident"] is True
    assert display[1]["load_policy"] == "Resident"
    assert display[1]["header_typ"] == 2
    assert snapshot(paths) == before
    # Engineer edits another row, based only on the persisted snapshot.
    proposed = copy.deepcopy(saved)
    proposed[2]["name"] = "Edited"
    payload = {"namespaceFingerprint": result.json["namespaceFingerprint"],
               "ns_state": {"abstractions": proposed}}
    pending = review(client, payload)
    description = "\n".join(pending["changes"])
    assert "NS[6]" not in description and "NS[12]" not in description
    committed = client.post("/api/namespace/save-table", json=payload, headers={
        "X-Change-Confirmation": pending["id"]})
    assert committed.status_code == 200, committed.json
    persisted = json.loads(state.read_text())["abstractions"]
    assert persisted[:2] == rows[:2]
    assert persisted == proposed
    assert committed.json["savedAbstractions"] == proposed
    reloaded = client.get("/api/boot-image/ns-state")
    assert reloaded.json["savedAbstractions"] == proposed
    assert reloaded.json["abstractions"] == proposed
    for path in paths:
        if path != state:
            assert path.read_bytes() == before[str(path)]


def test_legacy_saved_snapshot_is_deeply_detached_before_projection(isolated):
    app, payload, state, paths, scope = isolated
    rows = [{"slot": 0, "name": "Design", "boot": True,
             "selectionNotes": {"owner": "programmer"}}]
    state.write_text(json.dumps({"abstractions": rows}))
    def mutate_display(document):
        document["abstractions"][0]["selectionNotes"]["owner"] = "display-only"
        return document
    scope["_project_effective_thread_policies"] = mutate_display
    scope["_resolve_namespace_saved_artifacts"] = lambda state, directory: state
    response = app.test_client().get("/api/boot-image/ns-state")
    assert response.status_code == 200
    assert response.json["savedAbstractions"] == rows
    assert response.json["abstractions"][0]["selectionNotes"]["owner"] == "display-only"


@pytest.mark.parametrize("mismatch", ["request", "session", "namespace"])
def test_changed_review_rejected_and_consumed(isolated, mismatch):
    app, payload, state, paths, scope = isolated
    client = app.test_client()
    pending = review(client, payload)
    if mismatch == "request":
        payload["ns_state"]["abstractions"][0]["name"] = "Different"
    elif mismatch == "session":
        client = app.test_client()
    else:
        state.write_text(json.dumps({"abstractions": []}))
    before = snapshot(paths)
    headers = {"X-Change-Confirmation": pending["id"]}
    rejected = client.post("/api/namespace/save-table", json=payload, headers=headers)
    assert rejected.status_code == 409
    assert snapshot(paths) == before
    replay = client.post("/api/namespace/save-table", json=payload, headers=headers)
    assert replay.json["rejection_reason"] == "missing_or_used"


def test_cancel_preserves_all_and_invalidates_token(isolated):
    app, payload, state, paths, scope = isolated
    client = app.test_client()
    before = snapshot(paths)
    pending = review(client, payload)
    cancelled = client.post("/api/change-reviews/reject", json={
        "review_id": pending["review_id"], "outcome": "rejected"})
    assert cancelled.status_code == 200
    result = client.post("/api/namespace/save-table", json=payload,
                         headers={"X-Change-Confirmation": pending["id"]})
    assert result.status_code == 409
    assert snapshot(paths) == before


@pytest.mark.parametrize("invalid", ["stale", "missing", "duplicate", "field", "image"])
def test_invalid_request_never_issues_review(isolated, invalid):
    app, payload, state, paths, scope = isolated
    if invalid == "stale":
        payload["namespaceFingerprint"] = "0" * 64
    elif invalid == "missing":
        payload.pop("namespaceFingerprint")
    elif invalid == "duplicate":
        payload["ns_state"]["abstractions"] *= 2
    elif invalid == "field":
        payload["ns_state"]["abstractions"][0]["location"] = -1
    else:
        payload["generate"] = True
    before = snapshot(paths)
    response = app.test_client().post("/api/namespace/save-table", json=payload)
    assert response.status_code == 409
    assert response.json["error"] == "change_preflight_failed"
    assert "change_confirmation" not in response.json
    assert snapshot(paths) == before


def test_atomic_failure_retains_namespace_and_all_artifacts(isolated, monkeypatch):
    app, payload, state, paths, scope = isolated
    client = app.test_client()
    pending = review(client, payload)
    before = snapshot(paths)
    def fail(*args):
        raise OSError("synthetic atomic replacement failure")
    monkeypatch.setattr(os, "replace", fail)
    response = client.post("/api/namespace/save-table", json=payload, headers={
        "X-Change-Confirmation": pending["id"]})
    assert response.status_code == 500
    assert snapshot(paths) == before
    assert not list(state.parent.glob("*.tmp"))


def test_hardware_executable_admission_still_rejects_unattested_bytes(tmp_path):
    from server.boot_image import _require_approved_executable_lump
    import struct
    # A structurally valid executable without compiler/bootstrap provenance.
    filename = "ide.Alice.1.a91d33f7.lump"
    raw = struct.pack(">256I", (31 << 27) | (2 << 23) | (8 << 10) | 1,
                      *([0] * 255))
    digest = hashlib.sha256(raw).hexdigest()
    path = tmp_path / filename
    path.write_bytes(raw)
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {digest: {
            "binary_hash": digest, "filename": filename,
            "dot_name": "ide.Alice", "issue_n": 1,
            "grants": ["E"], "capability_type": "inform"}}}))
    with pytest.raises(ValueError, match="artifact lacks authenticated compiler or bootstrap provenance"):
        _require_approved_executable_lump(str(path), str(tmp_path), "test Alice")