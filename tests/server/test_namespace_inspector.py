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
    name = f"owner.Sample.1.{hashlib.sha256(b'owner.Sample' + binary).hexdigest()[:8]}.lump"
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
    assert "lump_version" not in after  # Catalog history is not revision authority.
    assert after["resident"] is False and after["load_policy"] == "Lazy"
    assert not any(k in after for k in ("selection", "symbolic", "implementationMissing", "loadPolicy"))
    assert after["seq"] == 7 and after["location"] == rows[-1]["location"]
    assert after["extension"] == rows[-1]["extension"]


@pytest.mark.parametrize("change", [
    {"filename": "missing.lump"}, {"binaryHash": "0" * 64},
    {"token": "not-a-token"}, {"filename": "../escape.lump"},
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
             "_atomic_write_json", "_atomic_write_json_unchecked", "_check_namespace_allocation",
             "_describe_protected_change", "namespace_inspect", "namespace_resolve_preview"}
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


def legacy_assignment(root, slot=15, sequence=0, self_gt=None):
    words = [(31 << 27) | (1 << 10) | 1] + [0] * 63
    words[-1] = self_gt if self_gt is not None else 0x4A000000 | (sequence << 16) | slot
    raw = struct.pack(">64I", *words)
    filename = f"Sample{slot}.1.{hashlib.sha256(f'Sample{slot}'.encode() + raw).hexdigest()[:8]}.lump"
    (root / filename).write_bytes(raw)
    return dict(slot=slot, seq=sequence, name=f"Sample{slot}", type="Inform",
                filename=filename, binary_hash=hashlib.sha256(raw).hexdigest(),
                token="12345678", cache_token="99999999", location="0x400",
                limit=1, resident=True, load_policy="Resident", seal="0xDEADBEEF")


def test_lookup_token_is_not_runtime_self_and_cannot_be_rewritten(tmp_path):
    row = legacy_assignment(tmp_path, sequence=3)
    rows = [row]
    before = {p: p.read_bytes() for p in tmp_path.iterdir()}
    view = inspect_namespace(rows, 15, tmp_path)
    assert not any(i["code"].startswith("simulation-") for i in view["issues"])
    assert "repair-binding" not in view["actions"]
    with pytest.raises(ValueError):
        preview_resolution(rows, proposal(rows, "repair-binding"), tmp_path)
    assert before == {p: p.read_bytes() for p in tmp_path.iterdir()}
    assert row["token"] == "12345678"


@pytest.mark.parametrize("change", ["wrong-self", "unresolved", "digest", "short", "type", "seq"])
def test_binding_repair_refuses_unproven_inputs(tmp_path, change):
    row = legacy_assignment(tmp_path, self_gt={
        "wrong-self": 0x4A00000E, "unresolved": 0xFEED5E1F}.get(change))
    if change == "digest":
        row["binary_hash"] = "0" * 64
    if change == "short":
        path = tmp_path / row["filename"]
        path.write_bytes(path.read_bytes()[:16])
        row["binary_hash"] = hashlib.sha256(path.read_bytes()).hexdigest()
    if change == "type":
        row["type"] = "Other"
    if change == "seq":
        row["seq"] = 1
    view = inspect_namespace([row], 15, tmp_path)
    assert "repair-binding" not in view["actions"]
    assert any(i["code"].startswith("simulation-") for i in view["issues"])
    with pytest.raises(ValueError):
        preview_resolution([row], proposal([row], "repair-binding"), tmp_path)


def test_portable_evidence_uses_existing_validator_never_legacy_repair(tmp_path, monkeypatch):
    row = legacy_assignment(tmp_path, self_gt=0xFEED5E1F)
    import server.lump_approvals as approvals
    import server.simulation_preparation as simulation
    (tmp_path / "approvals.json").write_text("{}")
    monkeypatch.setattr(approvals, "read_approvals", lambda _: {
        row["binary_hash"]: {"portable_binding": {"fixture": True}}})
    calls = []
    monkeypatch.setattr(simulation, "artifact_bindings", lambda rows, directory: calls.append(rows))
    view = inspect_namespace([row], 15, tmp_path)
    assert calls
    assert view["claims"]["executable"]["binding"]["status"] == "portable"
    assert "repair-binding" not in view["actions"]
    def reject(*args):
        raise ValueError("Portable simulation requires authenticated compiler evidence")
    monkeypatch.setattr(simulation, "artifact_bindings", reject)
    view = inspect_namespace([row], 15, tmp_path)
    assert "simulation-binding-invalid" in {i["code"] for i in view["issues"]}


def test_saved_full_allocation_overlaps_not_limit_and_not_private_image(tmp_path):
    alice = legacy_assignment(tmp_path, slot=14)
    other = legacy_assignment(tmp_path, slot=7)
    other["location"] = "0x3f0"
    rows = [dict(slot=0, name="Boot.NS"), alice, other]
    view = inspect_namespace(rows, 14, tmp_path)
    overlap = next(i for i in view["issues"] if i["code"] == "saved-allocation-overlap")
    assert "[0x400,0x440)" in overlap["message"]
    assert "Private simulation" in overlap["nextAction"]
    assert "saved-geometry-incomplete" in {i["code"] for i in view["issues"]}
    alice["location"] = 0
    view = inspect_namespace(rows, 14, tmp_path)
    assert any("NS[0]" in i["message"] for i in view["issues"] if i["code"] == "saved-allocation-overlap")


def test_select_canonical_artifact_preserves_issue_without_catalog_issue(tmp_path):
    row = legacy_assignment(tmp_path)
    (tmp_path / "manifest.json").write_text(json.dumps([
        dict(filename=row["filename"], token=row["token"], abstraction=row["name"], lump_version=4)]))
    preview = preview_resolution([row], proposal([row], "select-artifact",
        filename=row["filename"], token=row["token"], binaryHash=row["binary_hash"],
        policy="Resident"), tmp_path)
    assert preview["after"]["issue_n"] == 1


def test_exact_namespace_selection_does_not_depend_on_catalog(tmp_path):
    row = legacy_assignment(tmp_path)
    row["lump_version"] = 8
    row["name"] = "User chosen Pet Name"
    original = copy.deepcopy(row)
    options = dict(filename=row["filename"], token=row["token"],
                   binaryHash=row["binary_hash"], policy="Resident")
    # Absent catalog, then conflicting duplicated metadata, cannot veto bytes.
    for catalog in (None, [dict(filename=row["filename"], token="ffffffff",
                               abstraction="Wrong name", archived=True)] * 2):
        if catalog is not None:
            (tmp_path / "manifest.json").write_text(json.dumps(catalog))
        after = preview_resolution([row], proposal([row], "select-artifact", **options), tmp_path)["after"]
        assert after["token"] == row["token"]
        assert after["name"] == row["name"]
        assert after["lump_version"] == 8
        assert after["issue_n"] == 1
        assert row == original


def test_new_selection_rejects_filename_not_bound_to_bytes(tmp_path):
    row = legacy_assignment(tmp_path)
    wrong = "Other.1.12345678.lump"
    (tmp_path / wrong).write_bytes((tmp_path / row["filename"]).read_bytes())
    with pytest.raises(ValueError, match="canonical filename"):
        preview_resolution([row], proposal([row], "select-artifact",
            filename=wrong, token=row["token"], binaryHash=row["binary_hash"],
            policy="Resident"), tmp_path)


def test_keep_design_without_nested_selection_requires_explicit_choice(tmp_path):
    row = legacy_assignment(tmp_path)
    rows = [row]
    original = copy.deepcopy(rows)
    files = {p: p.read_bytes() for p in tmp_path.iterdir()}
    with pytest.raises(ValueError, match="No existing design selection"):
        preview_resolution(rows, proposal(rows, "keep-design"), tmp_path)
    with pytest.raises(ValueError, match="No existing design selection"):
        preview_resolution(rows, proposal(rows, "keep-design", selection="existing"), tmp_path)
    kept = preview_resolution(rows, proposal(rows, "keep-design", selection="executable"), tmp_path)["after"]
    assert kept["selection"]["filename"] == row["filename"]
    assert kept["selection"]["binaryHash"] == row["binary_hash"]
    assert kept["selection"]["token"] == row["token"]
    empty = preview_resolution(rows, proposal(rows, "keep-design", selection="none"), tmp_path)["after"]
    assert empty["symbolic"] is True and "selection" not in empty and "filename" not in empty
    assert rows == original
    assert files == {p: p.read_bytes() for p in tmp_path.iterdir()}
    unbound = [dict(slot=15, name="Unbound", symbolic=True, implementationMissing=True)]
    with pytest.raises(ValueError, match="No existing design selection"):
        preview_resolution(unbound, proposal(unbound, "keep-design"), tmp_path)
    assert preview_resolution(unbound, proposal(unbound, "keep-design", selection="none"), tmp_path)["after"]["symbolic"]