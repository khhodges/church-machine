"""Cross-store retention checks; fixtures only, never import the live Flask app.

This exercises real image preparation and immutable revision storage. Artifact
publication HTTP and browser activation are verified by their owning suites.
"""
import copy
import hashlib
import json
import struct

import pytest

from server.artifact_revisions import RevisionStore
from server.simulation_preparation import PreparationStore, digest


@pytest.fixture
def isolated_roles(tmp_path, monkeypatch):
    library = tmp_path / "lumps"
    library.mkdir()
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    config = tmp_path / "boot-config.json"
    db = tmp_path / "test.sqlite"
    db.touch()
    for key, value in {
        "CHURCH_TEST_ISOLATED_MODE": "1",
        "CHURCH_TEST_LUMPS_DIR": library,
        "CHURCH_TEST_BOOT_CONFIG_PATH": config,
        "CHURCH_TEST_BUILD_SNAPSHOTS_DIR": snapshots,
        "CHURCH_TEST_DB_PATH": db,
    }.items():
        monkeypatch.setenv(key, str(value))
    filename = "SelfTest.1.12345678.lump"
    raw = struct.pack(">64I", (31 << 27) | (3 << 10) | 1,
                      *([0] * 62), 0x4A000006)
    (library / filename).write_bytes(raw)
    rows = [
        {"slot": 0, "name": "Boot.NS", "type": "Inform"},
        {"slot": 1, "name": "Boot.Thread", "type": "Inform"},
        {"slot": 6, "name": "SelfTest", "type": "Inform", "filename": filename,
         "token": "4a000006", "binary_hash": hashlib.sha256(raw).hexdigest(),
         "boot": True, "seq": 0, "resident": False, "load_policy": "Lazy"},
    ]
    cfg = {"targetBoard": "wukong-xc7a100t", "step1": {
        "totalNamespaceWords": 16384, "namespaceLumpWords": 64,
        "threadLumpWords": 256, "nsSlotsMax": 64}}
    config.write_text(json.dumps(cfg))
    (library / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    (library / "manifest.json").write_text("[]")
    (library / "approvals.json").write_text(
        '{"version":1,"algorithm":"sha256","approvals":{}}')
    (library / "boot-image.bin").write_bytes(b"unrelated shared image")
    return library, rows, cfg, RevisionStore(str(snapshots / "revisions"))


def identity(prepared):
    return {key: prepared[key] for key in ("preparationId", "configurationHash")}


def test_active_n1_and_historical_outputs_survive_new_lump_and_n2_draft(isolated_roles):
    library, rows, cfg, history = isolated_roles
    a = (library / rows[-1]["filename"]).read_bytes()
    saved_before = (library / "ns-state.json").read_bytes()
    disk_before = (library / "boot-image.bin").read_bytes()
    preparations = PreparationStore()
    reviewed = preparations.prepare(rows, cfg, library, 6)
    approved = preparations.transition(identity(reviewed), rows, library)
    active = preparations.transition(identity(reviewed), rows, library, activate=True)
    image = struct.pack(f"<{len(active['words'])}I", *active["words"])
    n1 = history.publish("namespace", {
        "sourceNamespaceFingerprint": digest(rows),
        "configurationHash": approved["configurationHash"],
    }, {"selected.lump": a, "boot-image.bin": image})
    # Synthetic tester output tests retention, not hardware certification.
    bit = history.publish("bitstream", {"namespace_revision_id": n1,
                                      "source_commit": "a" * 40},
                          {"bitstream.bit": b"isolated test output"})
    active_before = copy.deepcopy(active)
    b = library / "SelfTest.2.87654321.lump"
    b.write_bytes(b"new programmer artifact not selected by N1")
    (library / "manifest.json").write_text(json.dumps([{"filename": b.name}]))
    n2_draft = copy.deepcopy(rows)
    n2_draft[-1]["filename"] = b.name
    assert active == active_before
    assert history.read("bitstream", bit)["metadata"]["namespace_revision_id"] == n1
    assert open(history.file_path("namespace", n1, "selected.lump"), "rb").read() == a
    assert open(history.file_path("namespace", n1, "boot-image.bin"), "rb").read() == image
    assert (library / "ns-state.json").read_bytes() == saved_before
    assert (library / "boot-image.bin").read_bytes() == disk_before
    with pytest.raises(ValueError, match="already activated"):
        preparations.transition(identity(reviewed), rows, library, activate=True)


def test_pending_review_rejects_stale_configuration_without_saved_writes(isolated_roles):
    library, rows, cfg, _ = isolated_roles
    before = {p.name: p.read_bytes() for p in library.iterdir()}
    preparations = PreparationStore()
    reviewed = preparations.prepare(rows, cfg, library, 6)
    changed = copy.deepcopy(rows)
    changed[0]["name"] = "Changed"
    with pytest.raises(ValueError, match="Namespace changed"):
        preparations.transition(identity(reviewed), changed, library)
    assert {p.name: p.read_bytes() for p in library.iterdir()} == before


def test_missing_frozen_input_does_not_fall_back_to_current_library(isolated_roles):
    library, rows, _, history = isolated_roles
    raw = (library / rows[-1]["filename"]).read_bytes()
    revision = history.publish("namespace", {}, {"selected.lump": raw})
    path = history.file_path("namespace", revision, "selected.lump")
    from pathlib import Path
    Path(path).unlink()
    assert (library / rows[-1]["filename"]).exists()
    with pytest.raises((OSError, ValueError)):
        history.read("namespace", revision)


def test_approved_simulation_survives_restart_and_changed_upstream(isolated_roles):
    library, rows, cfg, history = isolated_roles
    store = PreparationStore(revision_store=history)
    pending = store.prepare(rows, cfg, library, 6)
    with pytest.raises(ValueError, match="Approve"):
        store.transition(identity(pending), rows, library, activate=True)
    assert history.history("namespace") == []
    approved = store.transition(identity(pending), rows, library)
    revision = approved["approvedRevisionId"]
    assert store.history()[0]["revisionId"] == revision
    # Neither mutable configuration nor mutable artifact remains an input.
    (library / rows[-1]["filename"]).unlink()
    (library / "ns-state.json").write_text("invalid newer draft")
    activated = store.transition(identity(pending), None, library, activate=True)
    with pytest.raises(ValueError, match="already activated"):
        store.transition(identity(pending), None, library, activate=True)
    restarted = PreparationStore(revision_store=history)
    reopened = restarted.reopen({"revisionId": revision})
    assert reopened["approved"] is True and reopened["activated"] is False
    assert reopened["preparationId"] != pending["preparationId"]
    with pytest.raises(ValueError, match="hash mismatch"):
        restarted.transition({**identity(reopened),
                              "configurationHash": pending["configurationHash"]},
                             None, library, activate=True)
    again = restarted.transition(identity(reopened), None, library, activate=True)
    assert again["words"] == activated["words"]
    assert again["preparedRows"] == approved["preparedRows"]
    assert again["hardwareCertified"] is False


def test_durable_approval_rejects_stale_review_and_non_simulation_revision(isolated_roles):
    library, rows, cfg, history = isolated_roles
    store = PreparationStore(revision_store=history)
    pending = store.prepare(rows, cfg, library, 6)
    changed = copy.deepcopy(rows)
    changed[0]["name"] = "New draft"
    with pytest.raises(ValueError, match="Namespace changed"):
        store.transition(identity(pending), changed, library)
    assert history.history("namespace") == []
    unrelated = history.publish("namespace", {}, {"body.bin": b"not simulation approval"})
    with pytest.raises(ValueError, match="not an approved simulation"):
        store.reopen({"revisionId": unrelated})
    with pytest.raises(ValueError, match="revisionId only"):
        store.reopen({"revisionId": unrelated, "approved": True})


def test_retained_simulation_tamper_blocks_reopen_and_activation(isolated_roles):
    library, rows, cfg, history = isolated_roles
    store = PreparationStore(revision_store=history)
    pending = store.prepare(rows, cfg, library, 6)
    approved = store.transition(identity(pending), rows, library)
    revision = approved["approvedRevisionId"]
    from pathlib import Path
    Path(history.file_path("namespace", revision, "simulation.bin")).write_bytes(b"tamper")
    with pytest.raises(ValueError, match="integrity"):
        store.reopen({"revisionId": revision})
    with pytest.raises(ValueError, match="integrity"):
        store.transition(identity(pending), None, library, activate=True)


def test_history_reopen_http_uses_retained_inputs_not_current_design(isolated_roles):
    import ast
    from contextlib import nullcontext
    from pathlib import Path
    from flask import Flask, jsonify, request

    library, rows, cfg, history = isolated_roles
    first = PreparationStore(revision_store=history)
    pending = first.prepare(rows, cfg, library, 6)
    approved = first.transition(identity(pending), rows, library)
    store = PreparationStore(revision_store=history)
    app = Flask(__name__)
    names = {"simulation_history", "simulation_reopen", "simulation_approve",
             "simulation_activate", "_simulation_transition"}
    source = Path(__file__).resolve().parents[2] / "server" / "app.py"
    tree = ast.parse(source.read_text())
    selected = [node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(selected) == len(names)
    def reject_mutable_design():
        raise AssertionError("approved activation must not read current Namespace")
    scope = dict(app=app, jsonify=jsonify, request=request,
                 _simulation_preparations=store,
                 _namespace_commit_guard=nullcontext,
                 _read_namespace_design_document=reject_mutable_design,
                 LUMPS_DIR=str(library))
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), scope)
    client = app.test_client()
    response = client.get("/api/simulation/history")
    assert response.status_code == 200
    assert response.json["revisions"][0]["revisionId"] == approved["approvedRevisionId"]
    reopened = client.post("/api/simulation/reopen",
                           json={"revisionId": approved["approvedRevisionId"]})
    assert reopened.status_code == 200
    payload = identity(reopened.json)
    response = client.post("/api/simulation/activate", json=payload)
    assert response.status_code == 200 and response.json["activated"]
    assert client.post("/api/simulation/activate", json=payload).status_code == 409
    assert client.post("/api/simulation/reopen",
                       json={"revisionId": "latest"}).status_code == 409