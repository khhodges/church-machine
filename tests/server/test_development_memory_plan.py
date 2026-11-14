"""Disposable fixtures for exact next-build memory sizing."""
import copy
import hashlib
import json
import struct
from types import SimpleNamespace

import pytest

from server.development_memory_plan import resolve_inspection


def fixture(tmp_path, *, policy="Resident"):
    name = "ide.Example"
    api = json.dumps({"name": name}).encode()
    words = [(31 << 27) | (2 << 23) | (2 << 10) | 1, 0, 0,
             0xAB000000 | len(api)]
    padded = api + b"\0" * (-len(api) % 4)
    words += list(struct.unpack(f">{len(padded)//4}I", padded))
    words += [0] * (256 - len(words))
    raw = struct.pack(">256I", *words)
    path = tmp_path / "example.lump"
    path.write_bytes(raw)
    record = dict(abstraction=name, filename=path.name, lump_version=3, token="12345678")
    (tmp_path / "manifest.json").write_text(json.dumps([record]))
    backend = SimpleNamespace(LUMPS_DIR=str(tmp_path),
        _latest_primary_compilation=lambda *a, **kw: (record, dict(binary_hash=hashlib.sha256(raw).hexdigest())))
    row = dict(slot=22, name=name, kind="lump", policy=policy, unresolved=True,
               filename="stale.lump", allocationWords=None, selection=None)
    inspection = dict(rows=[copy.deepcopy(row)], layoutRows=[row], layoutSource="saved-design-layout")
    return backend, inspection, record


def test_resolves_resident_runtime_and_binary_sizes_without_mutation(tmp_path):
    backend, source, _ = fixture(tmp_path)
    before = copy.deepcopy(source)
    files = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    result = resolve_inspection(backend, source)
    row = result["layoutRows"][0]
    assert row["allocationWords"] == row["plannedWords"] == 64
    assert row["geometry"]["sizeWords"] == 256
    assert row["selection"]["revision"] == 3
    assert row["unresolved"] is False
    assert source == before
    assert files == {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert result["image"] is None and result["bindingsChanged"] is False


def test_lazy_size_does_not_allocate_resident_memory(tmp_path):
    backend, source, _ = fixture(tmp_path, policy="Lazy")
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert row["plannedWords"] == 64
    assert row["allocationWords"] is None
    assert row["geometry"]["sizeBytes"] == 1024


def test_missing_input_names_concrete_correction(tmp_path):
    backend, source, _ = fixture(tmp_path)
    source["layoutRows"][0]["name"] = "ide.Missing"
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert "No saved compilation exists for ide.Missing" in row["resolutionError"]
    assert row["plannedWords"] is row["selection"] is row["geometry"] is None
    assert row["unresolved"] is True
    assert "filename" not in row


def test_invalid_newest_never_falls_back_to_older(tmp_path):
    backend, source, record = fixture(tmp_path)
    newest = dict(record, lump_version=4, filename="bad.lump")
    (tmp_path / "manifest.json").write_text(json.dumps([record, newest]))
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert "no older copy" in row["resolutionError"]
    assert row["allocationWords"] is None


def test_changed_binary_cannot_supply_geometry(tmp_path):
    backend, source, _ = fixture(tmp_path)
    (tmp_path / "example.lump").write_bytes(b"\0" * 1024)
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert "hash has changed" in row["resolutionError"]
    assert row["geometry"] is None


def test_changed_manifest_rejects_mixed_snapshot(tmp_path):
    backend, source, record = fixture(tmp_path)
    original = backend._latest_primary_compilation
    def changing(*args, **kwargs):
        result = original()
        (tmp_path / "manifest.json").write_text("[]")
        return result
    backend._latest_primary_compilation = changing
    with pytest.raises(ValueError, match="changed during resolution"):
        resolve_inspection(backend, source)


def test_ambiguous_newest_and_wrong_embedded_name_are_rejected(tmp_path):
    backend, source, record = fixture(tmp_path)
    (tmp_path / "manifest.json").write_text(json.dumps([record, dict(record, filename="other.lump")]))
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert "ambiguous" in row["resolutionError"]
    record["abstraction"] = source["layoutRows"][0]["name"] = "ide.Other"
    (tmp_path / "manifest.json").write_text(json.dumps([record]))
    row = resolve_inspection(backend, source)["layoutRows"][0]
    assert "Embedded API names" in row["resolutionError"]


def test_http_planning_is_opt_in_and_saved_inspection_unchanged(tmp_path, monkeypatch):
    from contextlib import nullcontext
    from flask import Flask
    from server import development_image_view
    backend, source, _ = fixture(tmp_path)
    backend._namespace_commit_guard = nullcontext
    monkeypatch.setattr(development_image_view, "inspect", lambda *args: copy.deepcopy(source))
    app = Flask(__name__)
    development_image_view.register(app, backend)
    client = app.test_client()
    ordinary = client.get("/api/development-image/inspect?id=fixture").get_json()
    assert ordinary["layoutRows"][0]["allocationWords"] is None
    planned = client.get("/api/development-image/inspect?id=fixture&planning=latest").get_json()
    assert planned["planning"] is True
    assert planned["layoutRows"][0]["allocationWords"] == 64
    assert planned["rows"] == source["rows"]
    assert client.get("/api/development-image/inspect?id=fixture").get_json() == ordinary
