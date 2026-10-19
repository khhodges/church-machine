"""Read-only replacement for the retired release checkbox; isolated fixtures."""
import ast
import hashlib
import os
from pathlib import Path
import re
from contextlib import nullcontext
import pytest
from flask import Flask, request
from server.build_handoff import install


@pytest.fixture
def fixture(tmp_path):
    raw = b"exact saved artifact"
    name = "Example.lump"
    (tmp_path / name).write_bytes(raw)
    rows = [dict(token="1234abcd", filename=name, lump_version=2, compiled_at=1700000000)]
    tree = ast.parse(Path("server/app.py").read_text())
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
                 ("_resolve_build_handoff_identity", "_ide_origin_is_same_site")]
    env = dict(os=os, re=re, request=request, LUMPS_DIR=str(tmp_path),
               _read_manifest_safe=lambda _: rows,
               _validate_lump_snapshot=lambda path, row: {
                   "binary_hash": hashlib.sha256(Path(path).read_bytes()).hexdigest()})
    exec(compile(ast.Module(body=functions, type_ignores=[]), "isolated", "exec"), env)
    app = Flask(__name__)
    install(app, env["_resolve_build_handoff_identity"], nullcontext, env["_ide_origin_is_same_site"])
    locator = dict(token="1234abcd", filename=name, binary_hash=hashlib.sha256(raw).hexdigest())
    return app.test_client(), locator, rows, tmp_path


def test_read_only_metadata_and_retired_setting(fixture):
    client, locator, rows, root = fixture
    old = root / "build-handoff.sqlite"
    old.write_bytes(b"old unused metadata must never be read")
    before = {p.name:p.read_bytes() for p in root.iterdir()}
    response = client.get("/api/saved-artifact-metadata", query_string=locator)
    assert response.status_code == 200
    assert response.json["identity"]["lump_version"] == 2
    assert response.json["identity"]["compiled_at"] == "2023-11-14T22:13:20+00:00"
    assert set(response.json) == {"identity"}
    assert response.headers["Cache-Control"] == "no-store"
    assert client.post("/api/saved-artifact-metadata", json=locator).status_code == 405
    assert client.get("/api/build-handoff").status_code == 404
    assert client.post("/api/build-handoff", json={"released": True}).status_code == 404
    assert before == {p.name:p.read_bytes() for p in root.iterdir()}


def test_exact_identity_and_origin(fixture):
    client, locator, rows, root = fixture
    for field, value in (("binary_hash", "0"*64), ("token", "00000000"), ("filename", "../bad.lump")):
        assert client.get("/api/saved-artifact-metadata",
                          query_string={**locator, field:value}).status_code == 409
    assert client.get("/api/saved-artifact-metadata", query_string=locator,
                      headers={"Origin":"https://attacker.example"}).status_code == 403
    rows.append(dict(rows[0]))
    assert client.get("/api/saved-artifact-metadata", query_string=locator).status_code == 409
    rows.pop()
    rows[0]["lump_version"] = True
    assert client.get("/api/saved-artifact-metadata", query_string=locator).status_code == 409
    rows[0]["lump_version"] = 2
    (root / locator["filename"]).unlink()
    (root / locator["filename"]).symlink_to(root / "missing")
    assert client.get("/api/saved-artifact-metadata", query_string=locator).status_code == 409
