"""Pure inspection and real table-only review/CAS routes; all files temporary."""
import ast
import copy
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import struct
import tempfile
from contextlib import nullcontext

from flask import Flask, jsonify, request
import pytest

from server.namespace_authority import namespace_fingerprint
from server.namespace_inspector import inspect_namespace, preview_resolution
from server.change_confirmation import install


@pytest.fixture
def data(tmp_path):
    binary = struct.pack(">64I", (31 << 27) | (1 << 10), *([0] * 63))
    name = "owner.Sample.1.exact.lump"
    (tmp_path / name).write_bytes(binary)
    digest = hashlib.sha256(binary).hexdigest()
    artifact = dict(filename=name, token="12345678", binary_hash=digest)
    (tmp_path / "manifest.json").write_text(json.dumps([
        dict(artifact, abstraction="owner.Sample", issue_n=1, lump_version=4)]))
    selection = dict(filename=name, token="12345678", binaryHash=digest,
                     status="unresolved", diagnostic="Retained exact design selection")
    row = dict(slot=15, name="owner.Sample", seq=7, location="0x00000000",
               limit="0x00000", seal="0xDEADBEEF", symbolic=True,
               implementationMissing=True, resident=True, load_policy="Resident",
               loadPolicy="Lazy", selection=selection, extension={"retain": "verbatim"},
               **artifact)
    rows = [dict(slot=0, name="Boot.NS"), dict(slot=13, name="M_BIT_DEV", location="0xFFFFFF1C"), row]
    return tmp_path, rows, artifact


def proposal(rows, action, **options):
    return dict(namespaceFingerprint=namespace_fingerprint(rows), slot=15, action=action, options=options)


def test_inspection_and_cancel_are_read_only(data):
    root, rows, _ = data
    before = copy.deepcopy(rows)
    files = {p.name: p.read_bytes() for p in root.iterdir()}
    view = inspect_namespace(rows, 15, root)
    assert view["row"] == before[-1]
    assert view["savedAbstractions"] == before
    assert {i["code"] for i in view["issues"]} >= {"mixed-design-executable", "policy-alias-conflict"}
    assert view["claims"]["design"]["verified"]
    assert view["claims"]["executable"]["verified"]
    assert not view["claims"]["executable"]["executionApproved"]
    preview_resolution(rows, proposal(rows, "keep-design"), root)
    assert rows == before
    assert files == {p.name: p.read_bytes() for p in root.iterdir()}


def test_design_cleanup_preserves_exact_selection_slot_sequence_unknown_fields(data):
    root, rows, _ = data
    result = preview_resolution(rows, proposal(rows, "keep-design"), root)
    after = result["after"]
    for key in ("selection", "slot", "seq", "name", "seal", "extension"):
        assert after[key] == rows[-1][key]
    for key in ("resident", "boot_resident", "load_policy", "loadPolicy", "token", "filename", "binary_hash"):
        assert key not in after
    assert result["savePayload"]["ns_state"]["abstractions"][:-1] == rows[:-1]
    assert result["dataChanged"] is False


@pytest.mark.parametrize("slot,row", [
    (0, dict(slot=0, name="Boot.NS")),
    (1, dict(slot=1, name="Boot.Thread")),
    (13, dict(slot=13, name="M_BIT_DEV", location="0xFFFFFF1C")),
    (11, dict(slot=11, name="Thread.2")),
    (17, dict(slot=17, name="CustomThread", type="Thread")),
])
def test_special_entries_visible_but_no_generic_lump_conversion(data, slot, row):
    root, _, _ = data
    assert inspect_namespace([row], slot, root)["row"] == row
    assert inspect_namespace([row], slot, root)["actions"] == []
    with pytest.raises(ValueError, match="not available"):
        preview_resolution([row], dict(proposal([row], "keep-design"), slot=slot), root)


def test_exact_selection_and_policy_not_latest(data):
    root, rows, artifact = data
    result = preview_resolution(rows, proposal(rows, "select-artifact",
        filename=artifact["filename"], token=artifact["token"],
        binaryHash=artifact["binary_hash"], policy="Lazy"), root)
    after = result["after"]
    assert after["filename"] == artifact["filename"]
    assert after["lump_version"] == 4
    assert after["resident"] is False and after["load_policy"] == "Lazy"
    assert not any(k in after for k in ("selection", "symbolic", "implementationMissing", "loadPolicy"))
    assert after["seq"] == 7 and after["location"] == rows[-1]["location"]
    assert after["extension"] == rows[-1]["extension"]


@pytest.mark.parametrize("change", [
    {"filename": "missing.lump"}, {"binaryHash": "0" * 64},
    {"token": "ffffffff"}, {"filename": "../escape.lump"},
])
def test_missing_digest_or_identity_mismatch_rejected(data, change):
    root, rows, artifact = data
    options = dict(filename=artifact["filename"], token=artifact["token"],
                   binaryHash=artifact["binary_hash"], policy="Resident")
    options.update(change)
    with pytest.raises(ValueError):
        preview_resolution(rows, proposal(rows, "select-artifact", **options), root)


def test_bad_references_visible_not_hidden(data):
    root, rows, _ = data
    rows[-1]["selection"]["filename"] = "missing.lump"
    rows[-1]["binary_hash"] = "0" * 64
    view = inspect_namespace(rows, 15, root)
    assert view["claims"]["design"]["status"] == "missing"
    assert view["claims"]["executable"]["status"] == "digest-mismatch"


def test_orphan_policy_and_explicit_geometry_actions(data):
    root, rows, _ = data
    row = rows[-1]
    row.pop("symbolic")
    row.pop("implementationMissing")
    result = preview_resolution(rows, proposal(rows, "clear-selection"), root)
    assert "selection" not in result["after"]
    policy = preview_resolution(rows, proposal(rows, "set-policy", policy="Preload"), root)["after"]
    assert policy["load_policy"] == "Preload" and "loadPolicy" not in policy
    assert policy["resident"] is False
    geometry = preview_resolution(rows, proposal(rows, "edit-geometry", location="0x1400", limit="0xFF"), root)
    assert geometry["after"]["location"] == "0x1400"
    assert geometry["after"]["seal"] == row["seal"]
    with pytest.raises(ValueError, match="Unexpected"):
        preview_resolution(rows, proposal(rows, "edit-geometry", seq=8), root)
    with pytest.raises(ValueError):
        preview_resolution(rows, proposal(rows, "edit-geometry", location=-1), root)


def test_boot_marker_never_removed_implicitly(data):
    root, rows, _ = data
    rows[-1]["boot"] = True
    with pytest.raises(ValueError, match="boot marker"):
        preview_resolution(rows, proposal(rows, "keep-design"), root)


@pytest.fixture
def routes(data):
    root, rows, artifact = data
    state = root / "ns-state.json"
    state.write_text(json.dumps({"abstractions": rows}))
    (root / "boot-image.bin").write_bytes(b"unchanged image")
    names = {"_read_namespace_design_document", "_namespace_table_candidate", "namespace_save_table",
             "_atomic_write_json", "_describe_protected_change", "namespace_inspect", "namespace_resolve_preview"}
    tree = ast.parse(Path("server/app.py").read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    app = Flask(__name__)
    app.secret_key = "isolated-inspector-test"
    scope = dict(app=app, request=request, jsonify=jsonify, json=json, os=os, re=re,
                 tempfile=tempfile, logging=logging, copy=copy,
                 __file__=str(Path("server/app.py").resolve()), NS_STATE_PATH=str(state),
                 MAX_NS_ENTRIES=256, LUMPS_DIR=str(root),
                 _namespace_state_fingerprint=namespace_fingerprint, _namespace_commit_guard=nullcontext)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<inspector routes>", "exec"), scope)
    for endpoint, name, methods in [
        ("/api/namespace/inspect", "namespace_inspect", ["GET"]),
        ("/api/namespace/resolve-preview", "namespace_resolve_preview", ["POST"]),
        ("/api/namespace/save-table", "namespace_save_table", ["POST"]),
    ]:
        app.add_url_rule(endpoint, view_func=scope[name], methods=methods)
    paths = list(root.iterdir())
    install(app, lambda: paths, nullcontext, describe=scope["_describe_protected_change"],
            store_path=root / "reviews.sqlite")
    return app.test_client(), rows, state, paths


def test_real_routes_preview_and_protected_apply(routes):
    client, rows, state, paths = routes
    before = {p: p.read_bytes() for p in paths}
    assert client.get("/api/namespace/inspect?slot=15").status_code == 200
    response = client.post("/api/namespace/resolve-preview", json=proposal(rows, "keep-design"))
    assert response.status_code == 200
    assert before == {p: p.read_bytes() for p in paths}
    payload = response.json["savePayload"]
    review = client.post("/api/namespace/save-table", json=payload)
    assert review.status_code == 428
    assert before == {p: p.read_bytes() for p in paths}
    confirmation = review.json["change_confirmation"]
    saved = client.post("/api/namespace/save-table", json=payload,
                        headers={"X-Change-Confirmation": confirmation["id"]})
    assert saved.status_code == 200, saved.json
    assert saved.json["imageRebuilt"] is False
    assert json.loads(state.read_text())["abstractions"] == payload["ns_state"]["abstractions"]
    assert all(p == state or p.read_bytes() == data for p, data in before.items())


def test_stale_inspection_and_save_do_not_overwrite(routes):
    client, rows, state, _ = routes
    payload = client.post("/api/namespace/resolve-preview", json=proposal(rows, "keep-design")).json["savePayload"]
    rows[0]["extension"] = "another engineer changed this"
    state.write_text(json.dumps({"abstractions": rows}))
    before = state.read_bytes()
    assert client.post("/api/namespace/resolve-preview", json={
        **proposal(rows, "keep-design"), "namespaceFingerprint": payload["namespaceFingerprint"]
    }).status_code == 409
    assert client.post("/api/namespace/save-table", json=payload).status_code in (409, 422)
    assert state.read_bytes() == before