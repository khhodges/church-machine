"""Exercise the real route without importing the live server or live stores."""
import contextlib
from pathlib import Path

import pytest
from flask import Flask, request, jsonify


@pytest.fixture
def route(monkeypatch, tmp_path):
    import server.namespace_placement_binding as binding
    calls = []
    monkeypatch.setattr(binding, "bind_saved_placements",
                        lambda *args: calls.append(args) or {"lists": [], "status": "blocked"})
    source = Path("server/app.py").read_text()
    start = source.index('@app.route("/api/namespace/bind-placements"')
    end = source.index('@app.route("/api/namespace/inspect"', start)
    app = Flask(__name__)
    scope = dict(app=app, request=request, jsonify=jsonify,
                 _is_ide_design_request=lambda: request.is_json and request.headers.get(
                     "X-Requested-With") == "NamespaceDesign",
                 _namespace_commit_guard=contextlib.nullcontext,
                 _lump_history_transition_lock=lambda _: contextlib.nullcontext(),
                 _read_namespace_design_document=lambda: {"abstractions": [{"slot": 12}]},
                 _namespace_state_fingerprint=lambda rows: "current",
                 LUMPS_DIR=str(tmp_path))
    exec(source[start:end], scope)
    return app.test_client(), calls


def test_binding_requires_ide_request(route):
    client, calls = route
    assert client.post("/api/namespace/bind-placements",
                       json={"namespaceFingerprint": "current"}).status_code == 403
    assert not calls


def test_stale_namespace_never_binds(route):
    client, calls = route
    response = client.post("/api/namespace/bind-placements",
                           json={"namespaceFingerprint": "old"},
                           headers={"X-Requested-With": "NamespaceDesign"})
    assert response.status_code == 409
    assert not calls


def test_binding_uses_saved_rows_only(route):
    client, calls = route
    response = client.post("/api/namespace/bind-placements",
                           json={"namespaceFingerprint": "current"},
                           headers={"X-Requested-With": "NamespaceDesign"})
    assert response.status_code == 200
    assert response.json["installed"] is False
    assert calls[0][0] == [{"slot": 12}]
    assert calls[0][2] == "current"


def test_browser_cannot_supply_substitute_rows(route):
    client, calls = route
    response = client.post("/api/namespace/bind-placements",
                           json={"namespaceFingerprint": "current", "rows": []},
                           headers={"X-Requested-With": "NamespaceDesign"})
    assert response.status_code == 400
    assert not calls
