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


def test_latest_sources_build_with_private_binding_and_no_live_mutation(setup_design, monkeypatch):
    root, client, document, path, _ = setup_design
    report = binding_report(document, root, digest(document), bind_now=True)
    assert report["status"] == "complete"
    before = snapshots(root)
    raw, prepared = build_saved_design(app_module, identity(path))
    assert len(raw) == 65536
    assert prepared["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert prepared["namespace_revision_id"] == identity(path)
    assert prepared["bindings_changed"] is True
    assert prepared["freshness_policy"] == "latest-every-lump"
    assert prepared["saved_namespace_changed"] is False
    assert {item["kind"] for item in prepared["build_inputs"]} == {"namespace", "thread", "lump"}
    assert prepared["hardware_certified"] is False
    assert prepared["trace_rows"]
    for row in prepared["layout_rows"]:
        assert row["location"] == struct.unpack_from("<I", raw, row["slot"] * 16)[0]
        assert row["allocationWords"] == row["limit"] + 1
    assert next(r for r in prepared["layout_rows"] if r["kind"] == "namespace")["allocationWords"] == len(raw)//4
    memory_map = prepared["memory_map"]
    assert memory_map["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert memory_map["namespace_revision_id"] == identity(path)
    assert memory_map["address_unit"] == "byte"
    assert memory_map["size"] == len(raw)
    for region in memory_map["regions"]:
        assert region["byteAddress"] == struct.unpack_from("<I", raw, region["slot"] * 16)[0] * 4
        if region["kind"] == "namespace":
            assert region["byteLength"] == document["slotCount"] * 16
        elif region["kind"] == "thread":
            definition = next(r for r in document["rows"] if r["slot"] == region["slot"])
            assert region["byteLength"] == definition["words"] * 4
        elif region["kind"] == "lump":
            mapped = prepared["trace_rows"][str(region["byteAddress"])]
            assert mapped["pet_name"] == region["name"]
            assert str(region["byteAddress"] + region["byteLength"] - 4) in prepared["trace_rows"]
    for address, mapped in prepared["trace_rows"].items():
        assert mapped["map_instr_word"] == struct.unpack_from("<I", raw, int(address))[0]
        assert mapped["source_map"] == "uploaded"
    assert snapshots(root) == before
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 200, response.json
    assert response.json["artifact_sha256"] == prepared["artifact_sha256"]
    assert snapshots(root) == before


def test_missing_snapshot_is_rebuilt_privately(setup_design):
    root, client, document, path, _ = setup_design
    before = snapshots(root)
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 200, response.json
    assert response.json["bindings_changed"] is True
    assert snapshots(root) == before


def test_mmio_map_is_not_resident_ram(setup_design):
    root, client, document, path, _ = setup_design
    document["rows"].append(dict(slot=8, name="UART_DEV", kind="mmio",
        policy="Hardware", sequence=1, address=0x40000014, limit=2))
    path.write_text(json.dumps(document))
    raw, prepared = build_saved_design(app_module, identity(path))
    region = next(r for r in prepared["memory_map"]["regions"] if r["slot"] == 8)
    assert region["kind"] == "mmio"
    assert region["resident"] is False
    assert region["byteAddress"] == struct.unpack_from("<I", raw, 8 * 16)[0] * 4
    assert region["byteLength"] == 12
    assert str(region["byteAddress"]) not in prepared["trace_rows"]


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


def test_newest_compilation_overrides_saved_selection(setup_design):
    root, client, document, path, save = setup_design
    original = document["rows"][-1]["selection"]
    latest = save("abstraction ide.SelfTest {\ncapabilities { SELF E }\nmethod Run {\nIADD DR1, DR0, #91\nHALT\n}\n}")
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 200, response.json
    item = next(i for i in response.json["build_inputs"] if i["kind"] == "lump")
    assert item["sourceArtifact"] == latest["filename"]
    assert item["sourceBinaryHash"] != original["binaryHash"]
    assert json.loads(path.read_text())["rows"][-1]["selection"] == original
    assert any(row["map_instr_word"] == 0xAF08405B for row in response.json["trace_rows"].values())


def test_invalid_newest_never_uses_old_valid_compilation(setup_design):
    root, client, document, path, save = setup_design
    latest = save("abstraction ide.SelfTest {\ncapabilities { SELF E }\nmethod Run {\nIADD DR1, DR0, #92\nHALT\n}\n}")
    (root / latest["filename"]).write_bytes(b"invalid newest binary")
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 409
    assert "No older copy" in response.json["error"]


def test_lazy_lump_also_uses_newest_source(setup_design):
    root, client, document, path, save = setup_design
    def helper(n):
        return save(f"abstraction ide.Helper {{\ncapabilities {{ SELF E }}\nmethod Run {{\nIADD DR1, DR0, #{n}\nHALT\n}}\n}}", name="ide.Helper")
    old = helper(1)
    document["rows"].append(dict(slot=9, name="ide.Helper", kind="lump",
        policy="Lazy", sequence=0, selection=dict(filename=old["filename"],
        binaryHash=old["binary_hash"], token=old["token"], revision=old["lump_version"])))
    path.write_text(json.dumps(document))
    new = helper(2)
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 200, response.json
    item = next(i for i in response.json["build_inputs"] if i["name"] == "ide.Helper")
    assert item["sourceArtifact"] == new["filename"]
    lazy = next(r for r in response.json["memory_map"]["regions"] if r["slot"] == 9)
    assert lazy["byteAddress"] is None
    assert lazy["byteLength"] == 0
    assert lazy["resident"] is False


def test_concurrent_compilation_invalidates_prepared_image(setup_design, monkeypatch):
    root, client, document, path, save = setup_design
    original = app_module._compile_development_source
    def changed(body):
        response = original(body)
        manifest = root / "manifest.json"
        manifest.write_text(manifest.read_text() + "\n")
        return response
    monkeypatch.setattr(app_module, "_compile_development_source", changed)
    response = client.post("/api/development-image/prepare", json={"id": identity(path)})
    assert response.status_code == 409
    assert "inputs changed" in response.json["error"]


@pytest.mark.parametrize("payload", [{"id": "../../etc/passwd"},
                                    {"id": "design:" + "0" * 64, "source_image_base64": "AA=="}])
def test_prepare_does_not_accept_browser_bytes_or_paths(setup_design, payload):
    _, client, _, _, _ = setup_design
    assert client.post("/api/development-image/prepare", json=payload).status_code == 409
