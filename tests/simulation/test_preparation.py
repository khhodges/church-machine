"""Private simulation lifecycle; no live server, library, or workflow needed."""
import ast
import contextlib
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server import boot_image
from server.simulation_preparation import (
    PreparationStore, digest, stage_image, validate_simulator_resident_inventory,
)


@pytest.fixture
def saved(tmp_path):
    # A real frozen resident identity: row zero is the full E-only SELF GT
    # for NS[6]/sequence 0. The runtime W3 is derived from this SELF, not
    # from an IDE catalog token.
    raw = struct.pack(">64I", (31 << 27) | (3 << 10) | 1,
                      *([0] * 62), 0x4A000006)
    filename = "SelfTest.1.12345678.lump"
    (tmp_path / filename).write_bytes(raw)
    rows = [
        {"slot": 0, "name": "Boot.NS", "type": "Inform"},
        {"slot": 1, "name": "Boot.Thread", "type": "Inform"},
        {"slot": 6, "name": "SelfTest", "type": "Inform", "filename": filename,
         "token": "4a000006", "binary_hash": hashlib.sha256(raw).hexdigest(),
         "boot": True, "seq": 0, "resident": False, "boot_resident": False,
         "load_policy": "Lazy"},
    ]
    cfg = {"targetBoard": "wukong-xc7a100t", "step1": {
        "totalNamespaceWords": 16384, "namespaceLumpWords": 64,
        "threadLumpWords": 256, "nsSlotsMax": 64}}
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    (tmp_path / "boot-config.json").write_text(json.dumps(cfg))
    (tmp_path / "approvals.json").write_text(
        '{"version":1,"algorithm":"sha256","approvals":{}}')
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "boot-image.bin").write_bytes(b"previous shared image")
    return tmp_path, rows, cfg


def snapshot(root):
    return {p.name: p.read_bytes() for p in root.iterdir() if p.is_file()}


def ids(prepared):
    return {key: prepared[key] for key in ("preparationId", "configurationHash")}


def test_uncertified_preparation_is_private_and_hardware_still_rejects(saved):
    root, rows, cfg = saved
    before = snapshot(root)
    store = PreparationStore()
    result = store.prepare(rows, cfg, root, 6)
    assert snapshot(root) == before
    assert result["sourceNamespaceFingerprint"] == digest(rows)
    assert result["layoutChanges"]
    assert result["preparedRows"][-1]["resident"] is True
    assert rows[-1]["resident"] is False
    assert result["hardwareCertified"] is False
    with pytest.raises(ValueError, match="approval"):
        boot_image.generate_boot_image(cfg, str(root), 6)
    assert snapshot(root) == before


def test_exact_approval_activation_and_result_binding(saved):
    root, rows, cfg = saved
    store = PreparationStore()
    prepared = store.prepare(rows, cfg, root, 6)
    with pytest.raises(ValueError, match="Approve"):
        store.transition(ids(prepared), rows, root, activate=True)
    with pytest.raises(ValueError, match="hash mismatch"):
        store.transition({**ids(prepared), "configurationHash": "wrong"}, rows, root)
    approved = store.transition(ids(prepared), rows, root)
    assert approved["approved"] and not approved["hardwareCertified"]
    activated = store.transition(ids(prepared), rows, root, activate=True)
    image = struct.pack(f"<{len(activated['words'])}I", *activated["words"])
    assert hashlib.sha256(image).hexdigest() == prepared["imageHash"]
    assert activated["configurationHash"] == approved["configurationHash"]
    assert activated["entries"] == prepared["preparedRows"]
    assert activated["totalWords"] == len(activated["words"])
    with pytest.raises(ValueError, match="already activated"):
        store.transition(ids(prepared), rows, root, activate=True)
    with pytest.raises(ValueError, match="already activated"):
        store.transition(ids(prepared), rows, root)


@pytest.mark.parametrize("activate", [False, True])
@pytest.mark.parametrize("mutation", ["namespace", "artifact", "missing"])
def test_stale_source_rejected_at_both_transitions(saved, activate, mutation):
    root, rows, cfg = saved
    store = PreparationStore()
    prepared = store.prepare(rows, cfg, root, 6)
    store.transition(ids(prepared), rows, root)
    if mutation == "namespace":
        rows[0]["name"] = "renamed"
    elif mutation == "artifact":
        (root / rows[-1]["filename"]).write_bytes(b"changed immutable bytes")
    else:
        (root / rows[-1]["filename"]).unlink()
    with pytest.raises((ValueError, OSError)):
        store.transition(ids(prepared), rows, root, activate=activate)


def test_never_uses_latest_or_returns_mutable_provenance(saved):
    root, rows, cfg = saved
    newer = root / "SelfTest.2.87654321.lump"
    newer.write_bytes(b"not the selected artifact")
    (root / "manifest.json").write_text(json.dumps([
        {"filename": newer.name, "name": "SelfTest", "issue_n": 2}]))
    store = PreparationStore()
    prepared = store.prepare(rows, cfg, root, 6)
    assert prepared["artifactBindings"][0]["filename"] == rows[-1]["filename"]
    payload = ids(prepared)
    prepared["preparedRows"][0]["name"] = "tampered"
    prepared["artifactBindings"][0]["binaryHash"] = "tampered"
    approved = store.transition(payload, rows, root)
    assert approved["preparedRows"][0]["name"] == "Boot.NS"
    (root / rows[-1]["filename"]).unlink()
    with pytest.raises(OSError):
        store.prepare(rows, cfg, root, 6)


def test_expiry_and_cross_preparation_hash_replay(saved):
    root, rows, cfg = saved
    store = PreparationStore()
    first = store.prepare(rows, cfg, root, 6)
    second = store.prepare(rows, cfg, root, 6)
    with pytest.raises(ValueError, match="hash mismatch"):
        store.transition({"preparationId": second["preparationId"],
                          "configurationHash": first["configurationHash"]}, rows, root)
    store.records[first["preparationId"]]["expires"] = 0
    with pytest.raises(ValueError, match="expired"):
        store.transition(ids(first), rows, root)


def test_unresolved_clist_cannot_trigger_later_catalog_injection(saved):
    root, rows, cfg = saved
    path = root / rows[-1]["filename"]
    words = list(struct.unpack(">64I", path.read_bytes()))
    words[1] = (6 << 15) | 1  # LOAD using CR6 row 1, but cc=1.
    raw = struct.pack(">64I", *words)
    path.write_bytes(raw)
    rows[-1]["binary_hash"] = hashlib.sha256(raw).hexdigest()
    with pytest.raises(ValueError, match="unresolved c-list"):
        PreparationStore().prepare(rows, cfg, root, 6)


@pytest.mark.parametrize("defect", ["missing_self", "wrong_self"])
def test_invalid_immutable_resident_identity_rejected_without_repair(saved, defect):
    root, rows, cfg = saved
    path = root / rows[-1]["filename"]
    words = list(struct.unpack(">64I", path.read_bytes()))
    if defect == "missing_self":
        words[0] &= ~255
    else:
        words[-1] = 0x4A000007
    raw = struct.pack(">64I", *words)
    path.write_bytes(raw)
    rows[-1]["binary_hash"] = hashlib.sha256(raw).hexdigest()
    before = snapshot(root)
    store = PreparationStore()
    with pytest.raises(ValueError, match="SELF|W3"):
        store.prepare(rows, cfg, root, 6)
    assert not store.records
    assert snapshot(root) == before


def test_artifact_bound_outform_is_rejected_before_review(saved, monkeypatch):
    root, rows, cfg = saved
    outform = copy.deepcopy(rows[-1])
    outform.update(slot=7, name="Output", type="Outform", boot=False,
                   resident=True, boot_resident=True, load_policy="Resident")
    rows.append(outform)
    before = snapshot(root)
    def unexpected_generation(*args, **kwargs):
        pytest.fail("Unsupported Outform must be rejected before image generation")
    monkeypatch.setattr(boot_image, "generate_simulation_image", unexpected_generation)
    store = PreparationStore()
    with pytest.raises(ValueError, match=r"NS\[7\].*Outform.*not supported"):
        store.prepare(rows, cfg, root, 6)
    assert not store.records
    assert snapshot(root) == before


@pytest.mark.parametrize("defect", ["omitted_descriptor", "substituted_body"])
def test_every_binding_requires_its_exact_physical_body(saved, monkeypatch, defect):
    root, rows, cfg = saved
    resident = copy.deepcopy(rows[-1])
    resident.update(slot=7, name="Other", filename="Other.1.87654321.lump",
                    token="4a000007", boot=False, resident=True,
                    boot_resident=True, load_policy="Resident")
    words = list(struct.unpack(">64I", (root / rows[-1]["filename"]).read_bytes()))
    words[-1] = 0x4A000007
    raw = struct.pack(">64I", *words)
    (root / resident["filename"]).write_bytes(raw)
    resident["binary_hash"] = hashlib.sha256(raw).hexdigest()
    rows.append(resident)
    before = snapshot(root)
    generate = boot_image.generate_simulation_image
    def faulty_generator(*args, **kwargs):
        image = generate(*args, **kwargs)
        words = list(struct.unpack(f"<{len(image) // 4}I", image))
        offset = len(words) - 8 * 4
        if defect == "omitted_descriptor":
            words[offset:offset + 4] = [0] * 4
        else:
            # Keep SELF and header valid, but substitute a code word.
            words[words[offset] + 1] ^= 1
        return struct.pack(f"<{len(words)}I", *words)
    monkeypatch.setattr(boot_image, "generate_simulation_image", faulty_generator)
    store = PreparationStore()
    with pytest.raises(ValueError, match=r"NS\[7\].*physical simulation descriptor/body"):
        store.prepare(rows, cfg, root, 6)
    assert not store.records
    assert snapshot(root) == before


def test_real_church_simulator_accepts_activation_and_rejects_inventory_tampering(saved):
    root, rows, cfg = saved
    # Include a second resident and nonzero sequence: inventory admission must
    # not stop after checking the selected boot entry.
    resident = copy.deepcopy(rows[-1])
    resident.update(slot=7, name="Other", filename="Other.1.87654321.lump",
                    token="4a020007", seq=2, boot=False, resident=True,
                    boot_resident=True, load_policy="Resident")
    words = list(struct.unpack(">64I", (root / rows[-1]["filename"]).read_bytes()))
    words[-1] = 0x4A020007
    raw = struct.pack(">64I", *words)
    (root / resident["filename"]).write_bytes(raw)
    resident["binary_hash"] = hashlib.sha256(raw).hexdigest()
    rows.append(resident)
    before = snapshot(root)
    store = PreparationStore()
    prepared = store.prepare(rows, cfg, root, 6)
    store.transition(ids(prepared), rows, root)
    result = store.transition(ids(prepared), rows, root, activate=True)
    image = struct.pack(f"<{len(result['words'])}I", *result["words"])
    validate_simulator_resident_inventory(image)
    assert hashlib.sha256(image).hexdigest() == result["imageHash"]
    image_path = root / "private-node-roundtrip.bin"
    image_path.write_bytes(image)
    node = """
const assert = require('assert');
const fs = require('fs');
global.window = { bootConfig: JSON.parse(process.argv[2]) };
const ChurchSimulator = require('./simulator/simulator.js');
const raw = fs.readFileSync(process.argv[1]);
const words = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const sim = new ChurchSimulator();
assert.strictEqual(sim.loadBootImage(words.buffer), true, sim.lastBootImageError);
assert.strictEqual(sim._bootstrapResidentSlots[6], true);
assert.strictEqual(sim._bootstrapResidentSlots[7], true);
for (const defect of ['missing_self', 'wrong_self', 'wrong_w3']) {
    const bad = words.slice();
    const descriptor = bad.length - 8 * 4; // non-entry NS[7]
    const location = bad[descriptor];
    const size = 2 ** (((bad[location] >>> 23) & 15) + 6);
    const cc = bad[location] & 255;
    if (defect === 'missing_self') bad[location] &= ~255;
    if (defect === 'wrong_self') bad[location + size - cc] ^= 1;
    if (defect === 'wrong_w3') bad[descriptor + 3] ^= 1;
    const rejected = new ChurchSimulator();
    assert.strictEqual(rejected.loadBootImage(bad.buffer), false, defect);
    assert.match(rejected.lastBootImageError, /Bootstrap resident identity/);
}
console.log('real ChurchSimulator image admission passed');
"""
    outcome = subprocess.run(["node", "-e", node, str(image_path), json.dumps(cfg)],
                             cwd=Path(__file__).resolve().parents[2],
                             capture_output=True, text=True, timeout=60)
    assert outcome.returncode == 0, outcome.stdout + outcome.stderr
    assert "real ChurchSimulator image admission passed" in outcome.stdout
    for defect in ("missing_self", "wrong_self", "wrong_w3"):
        bad = list(result["words"])
        descriptor = len(bad) - 8 * 4
        location = bad[descriptor]
        size, cc = 1 << (((bad[location] >> 23) & 15) + 6), bad[location] & 255
        if defect == "missing_self":
            bad[location] &= ~255
        elif defect == "wrong_self":
            bad[location + size - cc] ^= 1
        else:
            bad[descriptor + 3] ^= 1
        with pytest.raises(ValueError, match="SELF|W3"):
            validate_simulator_resident_inventory(struct.pack(f"<{len(bad)}I", *bad))
    image_path.unlink()
    assert snapshot(root) == before


def test_routes_use_frozen_fingerprint_and_private_store(saved):
    """Exercise actual endpoint functions without app startup side effects."""
    from flask import Flask, jsonify, request
    import os
    import re
    root, rows, cfg = saved
    app = Flask(__name__)
    names = {"simulation_prepare", "simulation_approve", "simulation_activate",
             "_simulation_transition"}
    tree = ast.parse((Path(__file__).resolve().parents[2] / "server/app.py").read_text())
    module = ast.Module(body=[node for node in tree.body
                             if isinstance(node, ast.FunctionDef) and node.name in names],
                        type_ignores=[])
    scope = dict(app=app, jsonify=jsonify, request=request, os=os, re=re, json=json,
                 _namespace_commit_guard=contextlib.nullcontext,
                 _read_namespace_design_document=lambda: {"abstractions": copy.deepcopy(rows)},
                 _namespace_state_fingerprint=digest,
                 _simulation_preparations=PreparationStore(),
                 _migrate_legacy_board=lambda cfg: None, _validate_step1=lambda *args: None,
                 _validate_namespace_boot_marker=lambda rows: 6,
                 BOOT_CONFIG_PATH=str(root / "boot-config.json"),
                 BOOT_CONFIG_LEGACY_PATH=str(root / "missing"), LUMPS_DIR=str(root))
    exec(compile(module, "<simulation routes>", "exec"), scope)
    client = app.test_client()
    before = snapshot(root)
    assert client.post("/api/simulation/prepare", json={}).status_code == 400
    assert client.post("/api/simulation/prepare", json={
        "namespaceFingerprint": "0" * 64}).status_code == 409
    response = client.post("/api/simulation/prepare", json={
        "namespaceFingerprint": digest(rows)})
    assert response.status_code == 200, response.json
    payload = ids(response.json)
    assert client.post("/api/simulation/activate", json=payload).status_code == 409
    assert client.post("/api/simulation/approve", json=payload).json["approved"]
    result = client.post("/api/simulation/activate", json=payload)
    assert result.status_code == 200 and result.json["words"]
    assert not result.json["hardwareCertified"]
    assert client.post("/api/simulation/activate", json=payload).status_code == 409
    assert snapshot(root) == before