"""Named CALLs must survive the real save-plan/review/publication path."""
import copy
import hashlib
import json
import struct
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
    assert compiled["words"][3] == 0x17030021
    return {"binary": compiled["words"], "metadata": {
        "original_source": source, "language": "assembly", "compiler_candidate": True,
        "abstraction": "ide.AmoebaStartup", "capabilities": compiled["capabilities"],
        "content_type": "code", "grants": ["E"], "methods": [], "artifact_only": True}}


def test_named_call_save_plan_and_publication(named_candidate, isolated_lumps):
    namespace = (isolated_lumps / "ns-state.json").read_bytes()
    saved = publish(app_module.app.test_client(), named_candidate)
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    assert struct.unpack_from(">I", raw, 12)[0] == 0x17030021
    assert (isolated_lumps / "ns-state.json").read_bytes() == namespace


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
