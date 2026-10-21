"""Ordinary signed compile -> approved save -> exact fault attribution."""
import copy
import hashlib
import json
import struct
import subprocess
import pytest

from tests.server.test_lump_save_endpoint import app_module, isolated_lumps

SOURCE = '''abstraction ide.FaultExample {
method Run() {
HARDFAULT "Mint test fault"
IADD DR1, DR0, #99
}
method Other() {
HARDFAULT OTHER_FAILURE
IADD DR1, DR0, #99
}
}'''


@pytest.mark.parametrize("browser_candidate", [False, True])
def test_signed_save_fault_map(isolated_lumps, monkeypatch, browser_candidate):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "isolated-hardfault-test-key-" + "x" * 40)
    with app_module.app.test_client() as client:
        compiled = client.post("/api/compile", json={
            "source": SOURCE, "language": "assembly", "tier": 0}).get_json()
        assert compiled["ok"], compiled
        record = compiled["compiler_record"]
        sites = compiled["hardfault_sites"]
        assert len(sites) == 2
        assert sites == record["hardfault_sites"]
        assert sites[0]["sourceLine"] == 3
        assert sites[1]["reason"] == "OTHER_FAILURE"
        assert sites[1]["offset"] > sites[0]["offset"], "different reasons must not be code-deduplicated"
        payload = {"binary": compiled["words"], "metadata": {
            "abstraction": "ide.FaultExample", "language": "assembly",
            "artifact_only": True, "content_type": "code", "grants": ["E"],
            "capabilities": compiled["capabilities"], "submitted_source": None,
            "source_required": True, "original_source": SOURCE, "save_variants": True,
            "compiler_record": record, "trust_origin": compiled["trust_origin"],
            "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"]}}
        if browser_candidate:
            for key in ("compiler_record", "trust_origin", "compiler_identity", "compiler_version"):
                payload["metadata"].pop(key)
            payload["metadata"]["compiler_candidate"] = True
        planned = client.post("/api/lumps/save-plan", json=payload)
        assert planned.status_code == 201, planned.json
        plan = planned.json
        intent = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"], "plan_id": plan["plan_id"],
            "confirmation": True, "approval": {"grants": ["E"], "capability_type": "inform"}})
        assert intent.status_code == 201, intent.json
        payload["binary"] = plan["final_binary"]
        payload["metadata"].update(save_plan_id=plan["plan_id"], approval_intent=intent.json["intent"])
        if isinstance(plan.get("compiler_record"), dict):
            payload["metadata"]["compiler_record"] = plan["compiler_record"]
        response = client.post("/api/lumps/save", json=payload)
        assert response.status_code == 428, response.json
        response = client.post("/api/lumps/save", json=payload, headers={
            "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
        assert response.status_code == 200, response.json
        loaded = client.get("/api/lumps/latest-primary/ide.FaultExample")
        assert loaded.status_code == 200, loaded.json
        words = loaded.json["words"]
        digest = hashlib.sha256(struct.pack(f">{len(words)}I", *words)).hexdigest()
        cw = (words[0] >> 10) & 8191
        executed = json.loads(subprocess.run(
            ["node", "tests/simulator/hardfault_saved_execution.js"],
            input=json.dumps({"words": words, "digest": digest}), text=True,
            capture_output=True, check=True).stdout)
        assert executed["offset"] == sites[0]["offset"]
        evidence = {"artifactWords": words, "capturedCodeWords": words[:cw + 1],
                    "capturedIdentity": {"secure": True, "binaryHash": digest},
                    "offset": sites[0]["offset"], "capturedOffset": sites[0]["offset"],
                    "rawWord": 0xf7000000, "faultType": "INVALID_OP", "occurrence": "test-1"}
        evidence["capturedCodeWords"] = executed["code"]
        evidence["capturedOffset"] = executed["offset"]
        evidence["rawWord"] = executed["raw"]
        verified = client.post("/api/hardfault/verify", json=evidence)
        assert verified.status_code == 200, verified.json
        assert verified.json["site"] == sites[0]
        for key, value in (("capturedOffset", 0), ("rawWord", 0),
                           ("faultType", "BOUNDS"), ("capturedIdentity", {"secure": False})):
            altered = dict(evidence, **{key: value})
            assert client.post("/api/hardfault/verify", json=altered).json["site"] is None
        altered = copy.deepcopy(evidence)
        altered["artifactWords"][-1] ^= 1
        assert client.post("/api/hardfault/verify", json=altered).json["site"] is None
        # Editing an authenticated reason without re-signing must not relabel a fault.
        approval_path = isolated_lumps / app_module._LUMP_APPROVALS_FILENAME
        approvals = json.loads(approval_path.read_text())
        approvals["approvals"][digest]["compiler_record"]["hardfault_sites"][0]["explanation"] = "forged"
        approval_path.write_text(json.dumps(approvals))
        assert client.post("/api/hardfault/verify", json=evidence).json["site"] is None
