"""Real HTTP Programmer publication -> engineer table -> private activation."""
import copy
import hashlib
import json
import struct
import subprocess
from pathlib import Path

import pytest

from test_artifact_only_publication import app_module, isolated_lumps, publish
from server.artifact_revisions import RevisionStore
from server.simulation_preparation import PreparationStore


@pytest.mark.parametrize("defect", [None, "signature", "missing-approval", "missing-key"])
def test_published_portable_a_is_privately_bound_without_rewriting_source(
        isolated_lumps, monkeypatch, defect):
    root = isolated_lumps
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "isolated-handoff-key-" + "x" * 40)
    monkeypatch.setattr(app_module, "_simulation_preparations",
                       PreparationStore(revision_store=RevisionStore(str(root / "history"))))
    rows = [{"slot": 0, "name": "Boot.NS", "type": "Inform"},
            {"slot": 1, "name": "Boot.Thread", "type": "Inform"}]
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    cfg = {"targetBoard": "wukong-xc7a100t", "step1": {
        "totalNamespaceWords": 16384, "namespaceLumpWords": 64,
        "threadLumpWords": 256, "nsSlotsMax": 64}}
    (root / "boot-config.json").write_text(json.dumps(cfg))
    (root / "absent-boot.bin").write_bytes(b"untouched shared image")
    client = app_module.app.test_client()
    def compile_and_publish(name):
        source = """abstraction NAME {
    method Ping() {
        return(7)
    }
}
""".replace("NAME", name)
        response = client.post("/api/compile", json={
            "source": source, "language": "javascript", "tier": 2})
        assert response.status_code == 200 and response.json["ok"], response.json
        compiled = response.json
        record = compiled["compiler_record"]
        return publish(client, {"binary": compiled["words"], "metadata": {
            "abstraction": name, "language": "javascript",
            "content_type": "code", "capabilities": compiled["capabilities"],
            "submitted_source": source, "trust_origin": compiled["trust_origin"],
            "compiler_record": record, "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"], "grants": ["E"]}})
    # The generator explicitly requires a selected SelfTest. Publish that real
    # bootstrap input too, then separately publish/adopt an ordinary user A.
    bootstrap = compile_and_publish("SelfTest")
    saved = compile_and_publish("PortableHandoff")
    original = (root / saved["filename"]).read_bytes()
    assert int.from_bytes(original[-4:], "big") == 0xFEED5E1F
    assert json.loads((root / "ns-state.json").read_text())["abstractions"] == rows
    before_rows = copy.deepcopy(rows)
    rows.append({"slot": 6, "name": "SelfTest", "type": "Inform",
                 "seq": 0, "boot": False, "resident": True, "load_policy": "Resident",
                 "filename": bootstrap["filename"], "token": bootstrap["token"],
                 "binary_hash": bootstrap["binary_hash"]})
    rows.append({"slot": 14, "name": "PortableHandoff", "type": "Inform",
                 "seq": 3, "boot": True, "resident": False, "load_policy": "Lazy",
                 "filename": saved["filename"], "token": saved["token"],
                 "binary_hash": saved["binary_hash"]})
    payload = {"namespaceFingerprint": app_module._namespace_state_fingerprint(before_rows),
               "ns_state": {"abstractions": rows}}
    response = client.post("/api/namespace/save-table", json=payload)
    if response.status_code == 428:
        response = client.post("/api/namespace/save-table", json=payload, headers={
            "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    saved_design = (root / "ns-state.json").read_bytes()
    if defect:
        approvals_path = root / "approvals.json"
        approvals = json.loads(approvals_path.read_text())
        approval = approvals["approvals"][saved["binary_hash"]]
        if defect == "signature":
            approval["compiler_record"]["signature"] = "0" * 64
        elif defect == "missing-approval":
            approvals["approvals"].clear()
        else:
            monkeypatch.delenv("COMPILER_SIGNING_SECRET")
        approvals_path.write_text(json.dumps(approvals))
    response = client.post("/api/simulation/prepare", json={
        "namespaceFingerprint": app_module._namespace_state_fingerprint(rows)})
    if defect:
        assert response.status_code == 409, response.json
        assert response.json["dataChanged"] is False
        assert (root / saved["filename"]).read_bytes() == original
        assert (root / "ns-state.json").read_bytes() == saved_design
        assert app_module._simulation_preparations.history() == []
        return
    assert response.status_code == 200, response.json
    reviewed = response.json
    identity = {key: reviewed[key] for key in ("preparationId", "configurationHash")}
    prepared = next(row for row in reviewed["preparedRows"] if row["slot"] == 14)
    assert prepared["token"] == saved["token"]
    assert prepared["binary_hash"] == hashlib.sha256(original).hexdigest()
    assert prepared["simulationBinding"]["localSelfGT"] == "4a03000e"
    assert prepared["simulationBinding"]["sourceArtifact"]["filename"] == saved["filename"]
    approved = client.post("/api/simulation/approve", json=identity)
    assert approved.status_code == 200, approved.json
    # Retained approval remains independent from current library changes.
    (root / saved["filename"]).unlink()
    active = client.post("/api/simulation/activate", json=identity)
    assert active.status_code == 200, active.json
    words = active.json["words"]
    location, authority, seal, token = words[-60:-56]
    assert token == 0x4A03000E
    original_words = list(struct.unpack(f">{len(original) // 4}I", original))
    expected = copy.deepcopy(original_words)
    expected[-1] = 0x4A03000E
    assert words[location:location + len(expected)] == expected
    # Real JavaScript engine admission, not merely the server's image validator.
    result = subprocess.run(["node", "-e", """
const fs = require('fs'), assert = require('assert');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
global.window = {bootConfig: input.cfg};
const Simulator = require('./simulator/simulator.js');
const sim = new Simulator();
const bytes = Uint32Array.from(input.active.words).buffer;
assert.strictEqual(sim.activateSimulationConfiguration(bytes, input.active), true);
assert.strictEqual(sim._bootstrapResidentSlots[14], true);
assert.strictEqual(sim.stepCount, 0);
"""], input=json.dumps({"cfg": cfg, "active": active.json}), text=True,
        capture_output=True, cwd=Path(__file__).resolve().parents[2])
    assert result.returncode == 0, result.stderr
    store = app_module._simulation_preparations._history_store()
    retained = store.file_path("namespace", approved.json["approvedRevisionId"], saved["filename"])
    assert Path(retained).read_bytes() == original
    assert (root / "ns-state.json").read_bytes() == saved_design
    assert (root / "absent-boot.bin").read_bytes() == b"untouched shared image"