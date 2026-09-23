"""AST-isolated production routes; synthetic bytes only, no live app/artifacts."""
import ast
import base64
from contextlib import nullcontext
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import struct
import tempfile
import time
from types import SimpleNamespace
import uuid

from flask import Flask, g, jsonify, request
import pytest

from server.change_confirmation import (
    install, describe_namespace_save, describe_boot_config_change,
    resolve_saved_lump_versions,
)


@pytest.fixture
def isolated(tmp_path):
    root = Path(__file__).parents[2]
    tree = ast.parse((root / "server/app.py").read_text())
    names = {"boot_image_save_ns", "_stage_namespace_save_image",
             "_describe_protected_change"}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    app = Flask(__name__)
    app.secret_key = "isolated-test"
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    row = dict(slot=0, name="Demo.Entry", filename="entry.lump", token="12345678",
               boot=True, resident=True, boot_resident=True, load_policy="Resident")
    paths = {name: lumps / filename for name, filename in {
        "NS_STATE_PATH": "ns-state.json", "LUMPS_MANIFEST_PATH": "manifest.json",
        "BOOT_IMAGE_PATH": "boot-image.bin", "BOOT_CONFIG_PATH": "config.json",
        "BOOT_IMAGE_PROVENANCE_PATH": "boot-image.provenance.json",
    }.items()}
    config = {"step1": {"totalNamespaceWords": 8}, "step2": {"lumps": []}}
    paths["NS_STATE_PATH"].write_text(json.dumps({"abstractions": [row]}))
    paths["LUMPS_MANIFEST_PATH"].write_text(json.dumps([
        dict(row, abstraction="Demo.Entry", lump_version=7)]))
    paths["BOOT_CONFIG_PATH"].write_text(json.dumps(config))
    (lumps / "entry.lump").write_bytes(b"immutable synthetic saved revision")
    image = struct.pack("<8I", 0, 0, 0, 0, 16, 64, 123, 0x12345678)
    calls = []
    def validate(*args, **kwargs):
        calls.append("validate")
    def generate(cfg, directory, **kwargs):
        assert Path(directory) != lumps
        calls.append("generate")
        # Prove private writes cannot reach the saved revision.
        (Path(directory) / "entry.lump").write_bytes(b"private-only")
        return image
    def write_image(data, **kwargs):
        paths["BOOT_IMAGE_PATH"].write_bytes(data)
        paths["BOOT_IMAGE_PROVENANCE_PATH"].write_text("new provenance")
    scope = dict(
        app=app, request=request, g=g, jsonify=jsonify, os=os, json=json,
        uuid=uuid, time=time, re=re, struct=struct, tempfile=tempfile,
        hashlib=hashlib, logging=logging, __file__=str(root / "server/app.py"),
        LUMPS_DIR=str(lumps), _LUMP_SAVE_OPERATION_ID_RE=re.compile(r"[a-z]+"),
        _save_lump_diagnostic_event=lambda **kw: None,
        _expected_namespace_fingerprint=lambda payload: payload.get("namespaceFingerprint"),
        _namespace_state_fingerprint=lambda rows: "current",
        _read_authoritative_namespace_rows=lambda: ([dict(row)], "current"),
        _validate_boot_image_bytes=validate,
        _validate_symbolic_namespace_entries=validate,
        _validate_active_namespace_lumps=validate,
        _validate_namespace_boot_marker=lambda rows: 0,
        _optional_report_token_check=lambda: (True, None),
        _validated_boot_config_candidate=lambda candidate, **kw: (candidate, None),
        _read_saved_boot_config=lambda **kw: (config, None),
        _load_existing_boot_config_unchecked=lambda: config,
        _boot_image_preparation_status=lambda *a, **kw: {"status": "prepared"},
        _couple_selftest_next_to_selected_target=lambda data, *a, **kw: data,
        _namespace_commit_guard=nullcontext,
        _lump_history_transition_lock=lambda *a: nullcontext(),
        _write_ns_state=lambda rows: paths["NS_STATE_PATH"].write_text(
            json.dumps({"abstractions": rows})),
        _atomic_write_json=lambda path, data: Path(path).write_text(json.dumps(data)),
        _write_boot_image_bytes=write_image, _load_boot_ns_lump=lambda: None,
        _describe_namespace_save=describe_namespace_save,
        _describe_boot_config_change=describe_boot_config_change,
        _resolve_saved_lump_versions=resolve_saved_lump_versions,
        _boot_image_gen=SimpleNamespace(
            generate_boot_image=generate, validate_boot_image=validate,
            read_boot_entry_info=lambda data: {"entry_slot": 0}, _MMIO_SLOT_SPECS={}),
        **{key: str(value) for key, value in paths.items()},
    )
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<isolated routes>", "exec"), scope)
    app.add_url_rule("/api/boot-image/save-ns", view_func=scope["boot_image_save_ns"],
                     methods=["POST"])
    install(app, lambda: list(paths.values()) + [lumps / "entry.lump"], nullcontext,
            describe=scope["_describe_protected_change"],
            store_path=tmp_path / "reviews.sqlite")
    payload = dict(generate=True, data_b64=None, ns_state={"abstractions": [row]},
                   namespaceFingerprint="current", boot_config=config)
    return app, payload, paths, calls, scope, image


def snapshot(paths):
    return {key: path.read_bytes() if path.exists() else None for key, path in paths.items()}


@pytest.mark.parametrize("generated", [True, False])
def test_one_review_preflights_then_commits_every_component(isolated, generated):
    app, payload, paths, calls, scope, image = isolated
    if not generated:
        payload.update(generate=False, data_b64=base64.b64encode(image).decode())
    before = snapshot(paths)
    client = app.test_client()
    review = client.post("/api/boot-image/save-ns", json=payload)
    assert review.status_code == 428, review.json
    assert snapshot(paths) == before
    assert calls and ("generate" in calls) == generated
    text = str(review.json["change_confirmation"])
    assert "Review Namespace save" in text
    assert "Demo.Entry" in text and "saved version 7" in text
    assert "update source" not in text and "may become stale" not in text
    # Cancelling is not a second request: all files are still exact originals.
    headers = {"X-Change-Confirmation": review.json["change_confirmation"]["id"]}
    committed = client.post("/api/boot-image/save-ns", json=payload, headers=headers)
    assert committed.status_code == 200, committed.json
    assert paths["BOOT_IMAGE_PATH"].read_bytes() == image
    assert paths["BOOT_IMAGE_PROVENANCE_PATH"].read_text() == "new provenance"
    assert (paths["NS_STATE_PATH"].parent / "entry.lump").read_bytes() == b"immutable synthetic saved revision"
    assert client.post("/api/boot-image/save-ns", json=payload, headers=headers).status_code == 409


@pytest.mark.parametrize("mismatch", ["session", "request", "state", "fingerprint"])
def test_rejects_mismatch_consumes_review_and_preserves_files(isolated, mismatch):
    app, payload, paths, calls, scope, image = isolated
    client = app.test_client()
    review = client.post("/api/boot-image/save-ns", json=payload)
    token = review.json["change_confirmation"]["id"]
    if mismatch == "session":
        client = app.test_client()
    elif mismatch == "request":
        payload = dict(payload, generate=False)
    elif mismatch == "state":
        paths["BOOT_IMAGE_PROVENANCE_PATH"].write_text("external change")
    else:
        payload = dict(payload, namespaceFingerprint="stale")
    before = snapshot(paths)
    headers = {"X-Change-Confirmation": token}
    response = client.post("/api/boot-image/save-ns", json=payload, headers=headers)
    assert response.status_code == 409
    assert snapshot(paths) == before
    assert client.post("/api/boot-image/save-ns", json=payload, headers=headers).json[
        "rejection_reason"] == "missing_or_used"


def test_failed_preflight_does_not_issue_approval_or_publish(isolated):
    app, payload, paths, calls, scope, image = isolated
    scope["_optional_report_token_check"] = lambda: (
        False, (jsonify(error="unauthorized"), 403))
    before = snapshot(paths)
    with app.app_context():
        response = app.test_client().post("/api/boot-image/save-ns", json=payload)
    assert response.status_code == 409
    assert "change_confirmation" not in response.json
    assert snapshot(paths) == before


def test_commit_failure_rolls_back_all_components(isolated):
    app, payload, paths, calls, scope, image = isolated
    client = app.test_client()
    review = client.post("/api/boot-image/save-ns", json=payload)
    before = snapshot(paths)
    def fail(*args, **kwargs):
        raise OSError("isolated simulated publication failure")
    scope["_write_boot_image_bytes"] = fail
    response = client.post("/api/boot-image/save-ns", json=payload, headers={
        "X-Change-Confirmation": review.json["change_confirmation"]["id"]})
    assert response.status_code == 500
    assert snapshot(paths) == before


def test_commit_rechecks_route_authorization_after_review(isolated):
    app, payload, paths, calls, scope, image = isolated
    client = app.test_client()
    review = client.post("/api/boot-image/save-ns", json=payload)
    before = snapshot(paths)
    scope["_optional_report_token_check"] = lambda: (
        False, (jsonify(error="authorization no longer valid"), 403))
    headers = {"X-Change-Confirmation": review.json["change_confirmation"]["id"]}
    response = client.post("/api/boot-image/save-ns", json=payload, headers=headers)
    assert response.status_code == 403
    assert snapshot(paths) == before
    assert client.post("/api/boot-image/save-ns", json=payload, headers=headers).status_code == 409


def test_client_stages_dependencies_without_separate_protected_requests():
    text = (Path(__file__).parents[2] / "simulator/app-memory.js").read_text()
    save = text.split("window._nsTableSave = async function(btn) {", 1)[1].split(
        "\n};", 1)[0]
    assert "_ensureNamespaceBuildConfig(true)" in save
    assert "fetch('/api/boot-image/generate'" not in save
    assert "fetch('/api/boot-config'" not in save
    assert save.count("method:  'POST'") == 1
    assert "boot_config: stagedBuildConfig" in save


def test_config_diff_is_reviewed_and_published_in_same_commit(isolated):
    app, payload, paths, calls, scope, image = isolated
    payload["boot_config"] = dict(payload["boot_config"], slotRules={"0": "Resident"})
    client = app.test_client()
    before = snapshot(paths)
    review = client.post("/api/boot-image/save-ns", json=payload)
    assert review.status_code == 428
    text = "\n".join(review.json["change_confirmation"]["changes"])
    assert "slotRules" in text and "Resident" in text and "→" in text
    assert "Demo.Entry" in text and "saved version 7" in text
    assert snapshot(paths) == before
    response = client.post("/api/boot-image/save-ns", json=payload, headers={
        "X-Change-Confirmation": review.json["change_confirmation"]["id"]})
    assert response.status_code == 200
    assert json.loads(paths["BOOT_CONFIG_PATH"].read_text())["slotRules"] == {"0": "Resident"}


def test_unverified_browser_version_is_never_reported_as_saved():
    rows = [{"slot": 3, "name": "Example", "filename": "missing.lump",
             "_review_saved_version": 999, "lump_version": 888}]
    resolved = resolve_saved_lump_versions(rows, [])
    review = "\n".join(describe_namespace_save([], resolved))
    assert "saved version unresolved" in review
    assert "saved version 999" not in review and "saved version 888" not in review