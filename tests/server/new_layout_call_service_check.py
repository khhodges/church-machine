"""Opt-in real New-layout service replay in a disposable clone, not a UI test."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bootstrap_test_support import isolate_application

private = isolate_application()
from server.app import app
from server.namespace_design_v1 import digest
from test_artifact_only_publication import publish


def main():
    root = private / "lumps"
    client = app.test_client()
    source = (Path(__file__).resolve().parents[1] /
              "fixtures/amoeba-named-call.cloomc").read_text()
    document = json.loads((root / "design-drafts/ascending-v1.json").read_text())
    original = copy.deepcopy(document)
    response = client.post("/api/compile", json={
        "source": source, "language": "assembly", "tier": 2,
        "call_api_bindings": [{"petname": "ide.CapabilityTest"}]})
    compiled = response.json
    assert compiled["ok"], compiled
    assert compiled["words"][3] == 0x17040021
    saved = publish(client, {"binary": compiled["words"], "metadata": {
        "original_source": source, "language": "assembly", "compiler_candidate": True,
        "abstraction": "ide.AmoebaStartup", "capabilities": compiled["capabilities"],
        "content_type": "code", "grants": ["E"], "methods": [], "artifact_only": True}})
    raw = (root / saved["filename"]).read_bytes()
    assert struct.unpack_from(">I", raw, 12)[0] == 0x17040021
    reopened = app.test_client().get(f"/api/lumps/{saved['token']}/detail")
    assert reopened.status_code == 200, reopened.json
    assert reopened.json["source"] == source
    assert reopened.json["binary_hash"] == saved["binary_hash"]
    row = next(r for r in document["rows"] if r["name"] == "ide.AmoebaStartup")
    old_selection = copy.deepcopy(row["selection"])
    row["selection"] = dict(filename=saved["filename"], binaryHash=saved["binary_hash"],
                            token=saved["token"], revision=saved["lump_version"])
    headers = {"X-Requested-With": "NamespaceDesign"}
    bound = client.put("/api/namespace/design-v1?profile=ascending",
                       json=dict(document=document, fingerprint=digest(original), bind=True),
                       headers=headers)
    if bound.status_code == 428:
        bound = client.put("/api/namespace/design-v1?profile=ascending",
                           json=dict(document=document, fingerprint=digest(original), bind=True),
                           headers={**headers, "X-Change-Confirmation":
                                    bound.json["change_confirmation"]["id"]})
    assert bound.status_code == 200, bound.json
    document = json.loads((root / "design-drafts/ascending-v1.json").read_text())
    prepared = client.post("/api/simulation/design/ascending/prepare",
                           json={"namespaceFingerprint": digest(document)}, headers=headers)
    assert prepared.status_code == 200, prepared.json
    ids = {k: prepared.json[k] for k in ("preparationId", "configurationHash")}
    approved = client.post("/api/simulation/design/ascending/approve",
                           json=ids, headers=headers)
    assert approved.status_code == 200, approved.json
    activated = client.post("/api/simulation/design/ascending/activate", json=ids, headers=headers)
    assert activated.status_code == 200, activated.json
    image = struct.pack(f"<{len(activated.json['words'])}I", *activated.json["words"])
    assert hashlib.sha256(image).hexdigest() == prepared.json["imageHash"]
    path = private / "simulation.bin"
    path.write_bytes(image)
    fresh_threads = [r["slot"] for r in document["rows"] if r["kind"] == "thread"
                     and isinstance(r.get("preparedThread", {}).get("entryNia"), int)]
    trace = subprocess.run(["node", "-e", """
const fs=require('fs'), Simulator=require('./simulator/simulator');
const sim=Simulator.fromAscendingNamespaceImage(fs.readFileSync(process.argv[1]),
    {word0:0x02000001,word1:0,word2:Number(process.argv[2])*4-1,word3:0,m:1});
sim.beginBoot({clearNonBootThreads:true, freshThreadSlots:JSON.parse(process.argv[3])});
const trace=[];
for(let i=0;i<30 && !sim.halted;i++){
 const cr6=sim.cr[6], cr14=sim.cr[14];
 trace.push({pc:sim.pc,cr6:{...cr6},cr14:{...cr14},
   word:sim.memory[cr14.word1+1+sim.pc]});
 if(!sim.bootComplete) sim._bootStep(); else sim.step();
}
console.log(JSON.stringify({trace,faults:sim.faultLog,halted:sim.halted}));
""", str(path), str(document["slotCount"]), json.dumps(fresh_threads)],
        capture_output=True, text=True, check=True)
    execution = json.loads(trace.stdout)
    target = next(r for r in document["rows"] if r["name"] == "ide.CapabilityTest")
    target_raw = (root / target["selection"]["filename"]).read_bytes()
    assert hashlib.sha256(target_raw).hexdigest() == target["selection"]["binaryHash"]
    target_words = struct.unpack(f">{len(target_raw)//4}I", target_raw)
    from server.symbolic_binding import embedded_api
    target_api = embedded_api(target_words)
    call = next(i for i, step in enumerate(execution["trace"]) if step.get("word") == 0x17040021)
    entered = execution["trace"][call + 1]
    assert entered["cr6"]["word0"] & 65535 == target["slot"], entered
    assert entered["cr6"]["m"] == 1
    assert entered["pc"] == target_words[1] - 1
    assert entered["word"] == target_words[target_words[1]]
    report = dict(sourceHash=hashlib.sha256(source.encode()).hexdigest(),
                  oldSelection=old_selection, candidate=row["selection"],
                  targetSelection=target["selection"], targetAPI=target_api,
                  imageHash=prepared.json["imageHash"], execution=execution,
                  browserVerified=False)
    if "--retain-review" in sys.argv:
        review = Path("generated-artifacts/new-layout-call-review")
        review.mkdir(parents=True, exist_ok=True)
        (review / saved["filename"]).write_bytes(raw)
        (review / "candidate-source.cloomc").write_text(source)
        (review / "evidence.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
