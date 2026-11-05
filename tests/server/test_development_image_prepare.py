"""Offline preparation from real compiler output and saved binding evidence."""
import hashlib
import json
import struct
from pathlib import Path

import pytest

from test_design_simulation import setup_design, isolated_lumps, app_module
from server.development_image_prepare import build_saved_design
from server.namespace_binding_report import binding_report
from server.namespace_design_v1 import digest


def identity(path):
    return "design:" + hashlib.sha256(path.read_bytes()).hexdigest()


def snapshots(root):
    return {str(p.relative_to(root)): p.read_bytes()
            for p in root.rglob("*") if p.is_file()}


def test_exact_saved_bindings_build_without_linker_or_mutation(setup_design, monkeypatch):
    root, client, document, path, _ = setup_design
    report = binding_report(document, root, digest(document), bind_now=True)
    assert report["status"] == "complete"
    before = snapshots(root)
    def forbidden(*args, **kwargs):
        raise AssertionError("Preparation must not bind or materialize SELF")
    monkeypatch.setattr("server.design_simulation._localize_portable", forbidden)
    monkeypatch.setattr("server.boot_image.materialize_compiler_self", forbidden)
    raw, prepared = build_saved_design(app_module, identity(path))
    assert len(raw) == 65536
    assert prepared["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert prepared["namespace_revision_id"] == identity(path)
    assert prepared["bindings_changed"] is False
    assert prepared["hardware_certified"] is False
    assert prepared["trace_rows"]
    for address, mapped in prepared["trace_rows"].items():
        assert mapped["map_instr_word"] == struct.unpack_from("<I", raw, int(address))[0]
        assert mapped["source_map"] == "uploaded"
    assert snapshots(root) == before
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 200, response.json
    assert response.json["artifact_sha256"] == prepared["artifact_sha256"]
    assert snapshots(root) == before


def test_missing_snapshot_is_not_rebound(setup_design):
    root, client, document, path, _ = setup_design
    before = snapshots(root)
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 409
    assert response.json["queued"] is False
    assert "snapshot" in response.json["error"].lower()
    assert snapshots(root) == before


def test_changed_saved_design_is_not_substituted(setup_design):
    root, client, document, path, _ = setup_design
    old = identity(path)
    document["rows"][-1]["sequence"] += 1
    path.write_text(json.dumps(document))
    response = client.post("/api/development-image/prepare", json={"id": old})
    assert response.status_code == 409
    assert response.json["queued"] is False


def test_missing_resident_selection_blocks_image(setup_design):
    root, client, document, path, _ = setup_design
    document["rows"].append(dict(slot=9, name="ide.Unfinished", kind="lump",
                                 policy="Resident", sequence=0))
    path.write_text(json.dumps(document))
    binding_report(document, root, digest(document), bind_now=True)
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 409
    assert "ide.Unfinished" in response.json["error"]


@pytest.mark.parametrize("payload", [{"id": "../../etc/passwd"},
                                    {"id": "design:" + "0" * 64, "source_image_base64": "AA=="}])
def test_prepare_does_not_accept_browser_bytes_or_paths(setup_design, payload):
    _, client, _, _, _ = setup_design
    assert client.post("/api/development-image/prepare", json=payload).status_code == 409
