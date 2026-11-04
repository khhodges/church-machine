"""Isolated read-only handoff tests; never use the live Namespace or board."""
import hashlib
import json
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask

from server.artifact_revisions import RevisionStore
from server.development_image_view import inspect, normalize_rows, register


@pytest.fixture
def backend(tmp_path):
    state = tmp_path / "lumps/ns-state.json"
    state.parent.mkdir()
    state.write_text(json.dumps({"abstractions": [
        {"slot": 0, "name": "Boot.NS", "location": "0x0", "limit": "0xff"},
        {"slot": 1, "name": "Boot.Thread", "location": "0x100", "limit": "0xff"},
        {"slot": 2, "name": "UART_DEV", "location": "0x40000000", "limit": "0x3"},
        {"slot": 6, "name": "SelfTest", "location": "0x200", "limit": "0x3f",
         "filename": "saved.lump", "load_policy": "Resident"},
    ]}))
    snapshots = tmp_path / "snapshots"
    store = RevisionStore(str(snapshots / "revisions"))
    return SimpleNamespace(NS_STATE_PATH=str(state), _BUILD_SNAPSHOTS_DIR=str(snapshots),
                           _artifact_revision_store=lambda: store,
                           _namespace_commit_guard=nullcontext, __file__=str(tmp_path / "server/app.py"))


def original_id(backend):
    return "design:" + hashlib.sha256(Path(backend.NS_STATE_PATH).read_bytes()).hexdigest()


def test_inclusive_extents_and_types():
    rows = normalize_rows([
        {"slot": 0, "name": "Boot.NS", "location": "0x10", "limit": "0x3f"},
        {"slot": 1, "name": "Boot.Thread"},
        {"slot": 2, "name": "UART_DEV", "address": 0x40000000},
    ])
    assert rows[0]["location"] == 16 and rows[0]["allocationWords"] == 64
    assert [row["kind"] for row in rows] == ["namespace", "thread", "mmio"]
    assert rows[1]["location"] is None and rows[1]["allocationWords"] is None


def test_inspection_does_not_bind_generate_or_mutate(backend):
    state = Path(backend.NS_STATE_PATH)
    before = state.read_bytes()
    result = inspect(backend, original_id(backend))
    assert result["rows"][3]["filename"] == "saved.lump"
    assert result["rows"][3]["allocationWords"] == 64
    assert result["image"] is None and result["bindingsChanged"] is False
    assert result["capacitySource"] == "reference"
    assert state.read_bytes() == before
    assert list(state.parent.rglob("*")) == [state]


def test_stale_selection_never_substitutes_current(backend):
    identity = original_id(backend)
    Path(backend.NS_STATE_PATH).write_text('{"abstractions":[]}')
    with pytest.raises(ValueError, match="no longer available"):
        inspect(backend, identity)


def test_named_design_locations_are_not_projected(backend):
    folder = Path(backend.NS_STATE_PATH).parent / "design-drafts"
    folder.mkdir()
    raw = json.dumps({"format": "saved-design", "capacityWords": 16384,
                      "rows": [{"slot": 9, "name": "Mint", "kind": "lump",
                                "selection": {"filename": "exact.lump"}}]}).encode()
    (folder / "ascending-v1.json").write_bytes(raw)
    result = inspect(backend, "design:" + hashlib.sha256(raw).hexdigest())
    assert result["name"] == "New Layout"
    assert result["rows"][0]["location"] is None
    assert result["image"] is None


def test_supported_saved_design_uses_shared_read_only_layout(backend):
    from server.namespace_design_v1 import seed, project
    folder = Path(backend.NS_STATE_PATH).parent / "design-drafts"
    folder.mkdir()
    document = seed({"abstractions": []})
    raw = json.dumps(document).encode()
    path = folder / "ascending-v1.json"
    path.write_bytes(raw)
    before = {p: p.read_bytes() for p in folder.parent.rglob("*") if p.is_file()}
    result = inspect(backend, "design:" + hashlib.sha256(raw).hexdigest())
    expected = normalize_rows(project(document, folder.parent)["rows"])
    assert result["layoutRows"] == expected
    assert result["layoutSource"] == "saved-design-layout"
    assert next(r for r in result["layoutRows"] if r["kind"] == "namespace")["allocationWords"] == 256
    thread = next(r for r in result["layoutRows"] if r["name"] == "Boot.Thread")
    assert thread["location"] == 256 and thread["allocationWords"] == 256
    assert all(r["location"] is None for r in result["rows"] if r["kind"] != "mmio")
    assert result["image"] is None and result["bindingsChanged"] is False
    assert before == {p: p.read_bytes() for p in folder.parent.rglob("*") if p.is_file()}


def test_routes_read_only_and_no_arbitrary_file_selection(backend):
    app = Flask(__name__)
    register(app, backend)
    client = app.test_client()
    catalog = client.get("/api/development-image/catalog")
    assert catalog.status_code == 200
    assert catalog.json["entries"][0]["name"] == "Original"
    assert client.post("/api/development-image/inspect").status_code == 405
    invalid = client.get("/api/development-image/inspect?id=../../etc/passwd")
    assert invalid.status_code == 409 and invalid.json["dataChanged"] is False
    response = client.get("/api/development-image/inspect", query_string={"id": original_id(backend)})
    assert response.status_code == 200 and response.headers["Cache-Control"] == "no-store"


def test_compiled_view_and_assets_are_served_by_primary_flask(backend):
    root = Path(backend.__file__).parents[1] / "artifacts/development-image/dist/public"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text('<script src="/development-image/assets/app.js"></script>')
    (root / "assets/app.js").write_text("console.log('compiled');")
    app = Flask(__name__)
    register(app, backend)
    client = app.test_client()
    page = client.get("/development-image/?namespace=design:exact")
    assert page.status_code == 200
    assert b"/development-image/assets/app.js" in page.data
    assert client.get("/development-image/assets/app.js").status_code == 200
    assert client.get("/development-image/assets/missing.js").status_code == 404


def test_retained_image_requires_hardware_authority(backend):
    store = backend._artifact_revision_store()
    raw = Path(backend.NS_STATE_PATH).read_bytes()
    identity = store.publish("namespace", {"purpose": "private-simulation"},
                             {"namespace.json": raw, "boot-image.bin": bytes(65536)})
    def denied(_record):
        raise ValueError("Simulation is not hardware approval.")
    backend._require_hardware_namespace_revision = denied
    result = inspect(backend, identity)
    assert result["image"] is None
    assert result["imageBytes"] == 65536
    assert result["hardwareError"] == "Simulation is not hardware approval."


def test_prepare_load_handoff_selects_exact_saved_profile(backend):
    from server.namespace_design_v1 import seed, digest
    folder = Path(backend.NS_STATE_PATH).parent / "design-drafts"
    folder.mkdir()
    document = seed({"abstractions": []})
    raw = json.dumps(document).encode()
    (folder / "ascending-v1.json").write_bytes(raw)
    app = Flask(__name__)
    register(app, backend)
    client = app.test_client()
    response = client.get("/api/development-image/open", query_string={
        "profile": "ascending", "fingerprint": digest(document)})
    assert response.status_code == 302
    assert response.headers["Location"] == "/development-image/?namespace=design:" + hashlib.sha256(raw).hexdigest()
    assert (folder / "ascending-v1.json").read_bytes() == raw
    stale = client.get("/api/development-image/open?profile=ascending&fingerprint=stale")
    assert stale.status_code == 409 and stale.json["dataChanged"] is False
    assert client.get("/api/development-image/open?profile=ascending&design=../../etc").status_code == 409
    original = client.get("/api/development-image/open?profile=legacy")
    assert original.status_code == 302
    assert original.headers["Location"].endswith(original_id(backend))
