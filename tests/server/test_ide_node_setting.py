"""Exercise the real route and persistence with a private config only."""
import ast
import json
import subprocess
from pathlib import Path

import pytest
from flask import Flask, jsonify, request
from server import ide_leaf_policy as policy


@pytest.fixture
def setting(tmp_path, monkeypatch):
    path = tmp_path / "ide-hierarchy.json"
    original = {"node": "kjhh1", "aliases": {
        "Thread.2": "kjhh1.Thread2", "Remote": "other.UART"},
        "definitions": {"other.UART": ["W"]}}
    path.write_text(json.dumps(original))
    monkeypatch.setattr(policy, "CONFIG_PATH", str(path))
    app = Flask(__name__)
    tree = ast.parse(Path("server/app.py").read_text())
    route = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_ide_hierarchy")
    exec(compile(ast.Module(body=[route], type_ignores=[]), "server/app.py", "exec"),
         {"app": app, "request": request, "jsonify": jsonify, "subprocess": subprocess})
    return app.test_client(), path, original


def test_save_reload_and_alias_boundary(setting):
    client, path, original = setting
    response = client.put("/api/ide-hierarchy", json={
        "node": "ide", "expected": original, "confirmed": True},
        headers={"X-Requested-With": "NamespaceDesign"})
    assert response.status_code == 200
    saved = client.get("/api/ide-hierarchy").get_json()
    assert saved == json.loads(path.read_text())
    assert saved["node"] == "ide"
    assert saved["aliases"] == {"Thread.2": "ide.Thread2", "Remote": "other.UART"}
    assert saved["definitions"] == original["definitions"]
    assert policy.validate([{"name": "ide.UART", "rights": ["R", "W"]}])[0]["ownership"] == "local"
    stale = client.put("/api/ide-hierarchy", json={
        "node": "elsewhere", "expected": original, "confirmed": True},
        headers={"X-Requested-With": "NamespaceDesign"})
    assert stale.status_code == 422
    assert json.loads(path.read_text()) == saved


@pytest.mark.parametrize("node,confirmed,headers,status", [
    ("", True, {"X-Requested-With": "NamespaceDesign"}, 422),
    ("ide..broken", True, {"X-Requested-With": "NamespaceDesign"}, 422),
    ("ide", False, {"X-Requested-With": "NamespaceDesign"}, 422),
    ("ide", True, {}, 403),
    ("ide", True, {"X-Requested-With": "NamespaceDesign", "Origin": "https://foreign.example"}, 403),
])
def test_rejected_writes_preserve_config(setting, node, confirmed, headers, status):
    client, path, original = setting
    before = path.read_bytes()
    response = client.put("/api/ide-hierarchy", json={
        "node": node, "expected": original, "confirmed": confirmed}, headers=headers)
    assert response.status_code == status
    assert response.get_json()["dataChanged"] is False
    assert path.read_bytes() == before
