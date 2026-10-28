"""Named CALLs must survive the real save-plan/review/publication path."""
import copy
import hashlib
import json
import struct
import subprocess
from pathlib import Path

import pytest
from bootstrap_test_support import isolate_application

isolate_application()
import server.app as app_module
from server.compile_api import run_compile
from test_lump_save_endpoint import isolated_lumps
from test_artifact_only_publication import publish


@pytest.fixture
def named_candidate(isolated_lumps, monkeypatch):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "named-call-save-test-" + "x" * 40)
    target = run_compile({
        "source": "abstraction ide.CapabilityTest {\ncapabilities { SELF E }\nmethod Run {\nRETURN\n}\n}",
        "language": "auto", "tier": 2})
    assert target["ok"], target
    raw = struct.pack(f'>{len(target["words"])}I', *target["words"])
    filename = "target.lump"
    (isolated_lumps / filename).write_bytes(raw)
    (isolated_lumps / "manifest.json").write_text(json.dumps([{
        "abstraction": "ide.CapabilityTest", "filename": filename,
        "token": "563271c6", "binary_hash": hashlib.sha256(raw).hexdigest(),
        "lump_version": 7}]))
    source = (Path(__file__).resolve().parents[1] /
              "fixtures/amoeba-named-call.cloomc").read_text()
    response = app_module.app.test_client().post("/api/compile", json={
        "source": source, "language": "assembly", "tier": 2,
        "call_api_bindings": [{"petname": "ide.CapabilityTest"}]})
    compiled = response.json
    assert response.status_code == 200 and compiled["ok"], compiled
    assert compiled["words"][3] == 0x17040021
    return {"binary": compiled["words"], "metadata": {
        "original_source": source, "language": "assembly", "compiler_candidate": True,
        "abstraction": "ide.AmoebaStartup", "capabilities": compiled["capabilities"],
        "content_type": "code", "grants": ["E"], "methods": [], "artifact_only": True}}


def test_named_call_save_plan_and_publication(named_candidate, isolated_lumps):
    namespace = (isolated_lumps / "ns-state.json").read_bytes()
    saved = publish(app_module.app.test_client(), named_candidate)
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    assert struct.unpack_from(">I", raw, 12)[0] == 0x17040021
    assert (isolated_lumps / "ns-state.json").read_bytes() == namespace
    # Read the actual published bytes, preserving the complete executable
    # region. Only private fixture placement/SELF identity is minted locally.
    subprocess.run(["node", "-e", """
const fs = require('fs'), assert = require('assert');
const {fixture} = require('./tests/simulator/cr6_contract_fixture');
const raw = fs.readFileSync(process.argv[1]);
const words = Array.from({length: raw.length / 4}, (_, i) => raw.readUInt32BE(i * 4));
const {sim, install} = fixture();
const cw = (words[0] >>> 10) & 8191;
const saved = install(30, words.slice(1, 1 + cw));
assert.deepStrictEqual(Array.from(sim.memory.slice(saved.base + 1, saved.base + 1 + cw)),
    words.slice(1, 1 + cw));
sim.cr[0].word0 = saved.gt;
assert(sim._execCall({crDst: 0, imm: 1}));
assert.equal(sim.pc, words[1] - 1);
assert.equal(sim.memory[saved.base + 3], 0x17040021);
""", str(isolated_lumps / saved["filename"])], check=True,
        cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)


@pytest.mark.parametrize("call", ["CALL CR1", "CALLNE CR1", "call(CR1)",
                                  "recall()", "CALL 0, CR6, #1"])
def test_direct_entry_cannot_compile_or_reproduce(named_candidate, isolated_lumps, call):
    candidate = copy.deepcopy(named_candidate)
    source = ("abstraction ide.AmoebaStartup {\ncapabilities { SELF E }\n"
              f"method Start {{\n{call}\nRETURN\n}}\n}}")
    before = {p: p.read_bytes() for p in isolated_lumps.glob("*") if p.is_file()}
    client = app_module.app.test_client()
    compiled = client.post("/api/compile", json={"source": source, "language": "assembly", "tier": 2})
    assert compiled.status_code == 200, compiled.json
    assert not compiled.json.get("ok"), compiled.json
    assert "CALL" in str(compiled.json)
    candidate["metadata"]["original_source"] = source
    rejected = client.post("/api/lumps/save-plan", json=candidate)
    assert rejected.status_code == 403, rejected.json
    assert rejected.json["committed"] is False
    assert {p: p.read_bytes() for p in before} == before


@pytest.mark.parametrize("tamper", ["code", "missing-target", "fake-api", "pin"])
def test_named_call_save_cannot_bypass_verification(named_candidate, isolated_lumps, tamper):
    candidate = copy.deepcopy(named_candidate)
    if tamper == "code":
        candidate["binary"][3] ^= 32
    elif tamper == "pin":
        candidate["metadata"]["capabilities"][1]["T"] = "ffffffff"
    else:
        (isolated_lumps / "manifest.json").write_text("[]")
        if tamper == "fake-api":
            candidate["metadata"]["call_api_authorities"] = {
                "ide.CapabilityTest": {"embedded": True, "api": {
                    "methods": [{"name": "Run", "index": 0}]}}}
    before = {p: p.read_bytes() for p in isolated_lumps.glob("*") if p.is_file()}
    response = app_module.app.test_client().post("/api/lumps/save-plan", json=candidate)
    assert response.status_code == 403, response.json
    assert response.json["committed"] is False
    assert {p: p.read_bytes() for p in before} == before


@pytest.mark.parametrize("word", ["0x47000000", "0x47000020", "0x4f000000",
                                  "0x17000000", "0x17040001"])
def test_raw_retired_calls_cannot_compile_or_save(named_candidate, isolated_lumps, word):
    source = ("abstraction ide.AmoebaStartup {\ncapabilities { SELF E }\n"
              f"method Start [RAW ISA] {{\n{word}\n}}\n}}")
    compiled = run_compile({"source": source, "language": "assembly", "tier": 2})
    assert not compiled["ok"], compiled
    assert "retired" in str(compiled) or "dispatch-table" in str(compiled)
    candidate = copy.deepcopy(named_candidate)
    candidate["metadata"]["original_source"] = source
    before = {p: p.read_bytes() for p in isolated_lumps.glob("*") if p.is_file()}
    rejected = app_module.app.test_client().post("/api/lumps/save-plan", json=candidate)
    assert rejected.status_code == 403, rejected.json
    assert rejected.json["committed"] is False
    assert {p: p.read_bytes() for p in before} == before
