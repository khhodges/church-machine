"""Exact saved-design admission, isolated from installed images and hardware."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess

import pytest
from bootstrap_test_support import isolate_application

isolate_application()
from test_artifact_only_publication import app_module, isolated_lumps, publish
from server.artifact_revisions import RevisionStore
from server.simulation_preparation import PreparationStore
from server.namespace_design_v1 import FORMAT, PHASE1_FORMAT, digest
from server import design_simulation
from server.selftest_authoring import declared_source


@pytest.fixture
def setup_design(isolated_lumps, monkeypatch):
    root = isolated_lumps
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "design-simulation-test-only-" + "x" * 40)
    monkeypatch.setattr(app_module, "_design_simulation_stores", {
        profile: PreparationStore(revision_store=RevisionStore(str(root / "history")),
            binding_reader=design_simulation.bindings, purpose="approved-design-simulation")
        for profile in ("ascending", "phase1")})
    client = app_module.app.test_client()

    def save(source, name="ide.SelfTest", language="assembly"):
        response = client.post("/api/compile", json={"source": source, "language": language, "tier": 2})
        assert response.status_code == 200 and response.json["ok"], response.json
        compiled = response.json
        record = compiled["compiler_record"]
        return publish(client, {"binary": compiled["words"], "metadata": {
            "abstraction": name, "language": language, "content_type": "code",
            "capabilities": compiled["capabilities"], "submitted_source": source,
            "trust_origin": compiled["trust_origin"], "compiler_record": record,
            "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"], "grants": ["E"]}})

    saved = save("abstraction ide.SelfTest {\ncapabilities { SELF E }\nmethod Run {\nIADD DR1, DR0, #73\nHALT\n}\n}")
    document = dict(format=FORMAT, capacityWords=16384, slotCount=64, outputProfile="api", rows=[
        dict(slot=1, name="Boot.NS", kind="namespace", policy="Resident", sequence=0),
        dict(slot=2, name="Boot.Thread", kind="thread", policy="Resident", sequence=0, words=256),
        dict(slot=6, name="ide.SelfTest", kind="lump", policy="Resident", sequence=4, boot=True,
             selection=dict(filename=saved["filename"], binaryHash=saved["binary_hash"],
                            token=saved["token"], revision=saved["lump_version"])),
    ])
    folder = root / "design-drafts"
    folder.mkdir(exist_ok=True)
    path = folder / "ascending-v1.json"
    path.write_text(json.dumps(document))
    (root / "absent-boot.bin").write_bytes(b"installed image remains untouched")
    return root, client, document, path, save


def request(client, action, payload, profile="ascending"):
    return client.post(f"/api/simulation/design/{profile}/{action}", json=payload,
                       headers={"X-Requested-With": "NamespaceDesign"})


def identifiers(response):
    return {key: response.json[key] for key in ("preparationId", "configurationHash")}


@pytest.mark.parametrize("profile", ["ascending", "phase1"])
def test_real_saved_revision_admits_exact_private_runtime(setup_design, tmp_path, profile):
    root, client, document, path, _ = setup_design
    document["rows"].extend([
        dict(slot=12, name="Thread.4", kind="thread", policy="Resident", sequence=2, words=256),
        dict(slot=8, name="UART_DEV", kind="mmio", policy="Hardware", sequence=1,
             address=0x40000014, limit=2)])
    if profile == "phase1":
        document.update(format=PHASE1_FORMAT, slotCount=256)
        path = path.parent / "phase1.json"
    path.write_text(json.dumps(document))
    protected = {p: p.read_bytes() for p in root.iterdir() if p.is_file()}
    before = path.read_bytes()
    prepared = request(client, "prepare", {"namespaceFingerprint": digest(document)}, profile)
    assert prepared.status_code == 200, prepared.json
    assert prepared.json["artifactBindings"][0]["binaryHash"] == document["rows"][2]["selection"]["binaryHash"]
    assert prepared.json["imageFormat"] == FORMAT
    assert prepared.json["installationAllowed"] is False
    assert request(client, "activate", identifiers(prepared), profile).status_code == 409
    approved = request(client, "approve", identifiers(prepared), profile)
    assert approved.status_code == 200, approved.json
    active = request(client, "activate", identifiers(prepared), profile)
    assert active.status_code == 200, active.json
    image = struct.pack(f"<{len(active.json['words'])}I", *active.json["words"])
    assert hashlib.sha256(image).hexdigest() == prepared.json["imageHash"]
    image_path = tmp_path / "private.bin"
    image_path.write_bytes(image)
    script = """
const fs=require('fs'), Simulator=require('./simulator/simulator');
const sim=Simulator.fromAscendingNamespaceImage(fs.readFileSync(process.argv[1]),
    {word0:0x02000001,word1:0,word2:Number(process.argv[2])*4-1,word3:0,m:1});
if(!sim.startEntryThread()) throw Error(JSON.stringify(sim.faultLog));
for(let i=0;i<12 && !sim.halted;i++) sim.step();
if(sim.dr[1]!==73 || sim.faultLog.length) throw Error(JSON.stringify({dr:sim.dr[1],faults:sim.faultLog}));
"""
    run = subprocess.run(["node", "-e", script, str(image_path), str(document["slotCount"])], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    assert {p: p.read_bytes() for p in protected} == protected
    assert path.read_bytes() == before
    assert request(client, "activate", identifiers(prepared), profile).status_code == 409
    assert client.get("/api/simulation/history").json["revisions"] == []


@pytest.mark.parametrize("defect", ["identity", "hash", "canonical-token", "missing", "lazy", "signature"])
def test_invalid_selected_inputs_remain_blocked(setup_design, defect):
    root, client, document, path, _ = setup_design
    row = document["rows"][-1]
    if defect == "identity":
        row["name"] = "SelfTest"
    elif defect == "hash":
        row["selection"]["binaryHash"] = "0" * 64
    elif defect == "canonical-token":
        old = root / row["selection"]["filename"]
        row["selection"]["filename"] = "ide.SelfTest.1.00000000.lump"
        old.rename(root / row["selection"]["filename"])
    elif defect == "missing":
        (root / row["selection"]["filename"]).unlink()
    elif defect == "lazy":
        row["policy"] = "Lazy"
    else:
        approvals = json.loads((root / "approvals.json").read_text())
        approvals["approvals"][row["selection"]["binaryHash"]]["compiler_record"]["signature"] = "0" * 64
        (root / "approvals.json").write_text(json.dumps(approvals))
    path.write_text(json.dumps(document))
    response = request(client, "prepare", {"namespaceFingerprint": digest(document)})
    assert response.status_code == 409, response.json
    assert response.json["dataChanged"] is False
    assert response.json["hardwareCertified"] is False
    assert response.json["nextAction"]
    if defect == "identity":
        assert "new revision" in response.json["error"]
    assert (root / "absent-boot.bin").read_bytes() == b"installed image remains untouched"


def test_approval_requires_same_design_but_retained_activation_survives_later_save(setup_design):
    root, client, document, path, _ = setup_design
    reviewed = request(client, "prepare", {"namespaceFingerprint": digest(document)})
    assert reviewed.status_code == 200, reviewed.json
    changed = copy.deepcopy(document)
    changed["rows"][-1]["sequence"] += 1
    path.write_text(json.dumps(changed))
    assert request(client, "approve", identifiers(reviewed)).status_code == 409
    path.write_text(json.dumps(document))
    assert request(client, "approve", identifiers(reviewed)).status_code == 200
    path.write_text(json.dumps(changed))
    (root / document["rows"][-1]["selection"]["filename"]).unlink()
    result = request(client, "activate", identifiers(reviewed))
    assert result.status_code == 200, result.json
    assert result.json["sourceNamespaceFingerprint"] == digest(document)
    assert request(client, "activate", identifiers(reviewed), profile="phase1").status_code == 409


def test_corrected_selftest_source_compiles_without_rewriting_history(setup_design):
    root, client, _, _, save = setup_design
    before = {p: p.read_bytes() for p in root.glob("*.lump")}
    response = client.get("/api/namespace/selftest-source")
    assert response.status_code == 200
    assert response.text == declared_source()
    assert "abstraction ide.SelfTest {" in response.text
    saved = save(response.text)
    words = struct.unpack(f">{len((root / saved['filename']).read_bytes())//4}I",
                          (root / saved["filename"]).read_bytes())
    from server.symbolic_binding import embedded_api
    assert embedded_api(words)["name"] == "ide.SelfTest"
    # A different canonical content token keeps the historical immutable bytes.
    assert {p: p.read_bytes() for p in before} == before


def test_save_and_bind_symbolic_design_then_approve_and_activate(setup_design):
    root, client, document, path, save = setup_design
    caller = save("""abstraction ide.Caller {
capabilities { SELF E, ide.SelfTest E }
method Run() {
CALL ide.SelfTest.Run
HALT
}
}""", name="ide.Caller", language="javascript")
    draft = copy.deepcopy(document)
    draft["rows"][-1]["boot"] = False
    draft["rows"].append(dict(slot=10, name="ide.Caller", kind="lump", policy="Resident",
        sequence=1, boot=True, selection=dict(filename=caller["filename"],
            binaryHash=caller["binary_hash"], token=caller["token"], revision=caller["lump_version"])))
    saved_design = client.put("/api/namespace/design-v1",
        json=dict(fingerprint=digest(document), document=draft),
        headers={"X-Requested-With": "NamespaceDesign"})
    if saved_design.status_code == 428:
        saved_design = client.put("/api/namespace/design-v1",
            json=dict(fingerprint=digest(document), document=draft),
            headers={"X-Requested-With": "NamespaceDesign",
                     "X-Change-Confirmation": saved_design.json["change_confirmation"]["id"]})
    assert saved_design.status_code == 200, saved_design.json
    report = next(row for row in saved_design.json["bindingReport"]["lists"] if row["slot"] == 10)
    assert report["status"] == "bound", report
    snapshots = list((root / ".symbolic-bindings").glob("*.json"))
    assert snapshots, "ordinary design save must have generated a real binding snapshot"
    inputs_before = {p: p.read_bytes() for p in [path, *root.glob("*.lump"), *snapshots]}
    prepared = request(client, "prepare", {"namespaceFingerprint": saved_design.json["fingerprint"]})
    assert prepared.status_code == 200, prepared.json
    assert prepared.json["artifactBindings"] == design_simulation.bindings(draft, root)
    binding = next(row for row in prepared.json["artifactBindings"] if row["slot"] == 10)
    assert binding["portableBinding"]["schema"] == "church.symbolic-lump-binding/v1"
    assert "symbolicReport" not in binding
    runtime = next(row for row in prepared.json["preparedRows"] if row["slot"] == 10)
    assert runtime["simulationBinding"]["localizationReport"]["status"] == "bound"
    assert "symbolicReport" not in runtime["simulationBinding"]["sourceArtifact"]
    approved = request(client, "approve", identifiers(prepared))
    assert approved.status_code == 200, approved.json
    activated = request(client, "activate", identifiers(prepared))
    assert activated.status_code == 200, activated.json
    assert activated.json["imageHash"] == prepared.json["imageHash"]
    assert {p: p.read_bytes() for p in inputs_before} == inputs_before
