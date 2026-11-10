"""Publish actual compiler LUMPs into the two saved copies; no boot/activation."""
import copy
import hashlib
import json
from pathlib import Path
from save_review_designs import api, ROOT

RENAMES = {'Cooperative.UserA.Thread': 'ide.CooperativeUserAThread', 'Cooperative.UserB.Thread': 'ide.CooperativeUserBThread', 'Cooperative.SystemUserB': 'ide.CooperativeSystemUserB', 'Cooperative.SystemWaiting': 'ide.CooperativeSystemWaiting', 'Cooperative.Payload': 'ide.CooperativePayload', 'Cooperative.Receiver': 'ide.CooperativeReceiver', 'Cooperative.UserA': 'ide.CooperativeUserA', 'Cooperative.UserB': 'ide.CooperativeUserB'}

NAMES = {
    "ide.CooperativePayload": "payload",
    "ide.CooperativeUserA": "user_a",
    "ide.CooperativeUserB": "user_b",
    "ide.CooperativeSystemWaiting": "system_waiting",
    "ide.CooperativeSystemUserB": "system_user_b",
}


def main():
    protected = [ROOT / "server/lumps" / n for n in ("ns-state.json", "boot-image.bin")]
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    original = api("/api/namespace/design-v1?profile=ascending")["fingerprint"]
    copies = [c for c in api("/api/namespace/design-copies")["copies"]
              if c["name"] in ("Cooperative Retry — USER B — Review",
                               "Cooperative Retry — All Waiting — Review")]
    if len(copies) != 2:
        raise ValueError("Expected the two existing independent review designs")
    for item in copies:
        existing = api(f"/api/namespace/design-v1?profile=ascending&design={item['id']}")
        if any(r.get("selection") for r in existing["document"]["rows"] if r["kind"] == "lump"):
            raise ValueError("Review design already has assignments; do not republish or replace them implicitly")
    compiled = {}
    for name, stem in NAMES.items():
        source = (ROOT / f"simulator/examples/cooperative_retry_{stem}.cloomc").read_text()
        result = api("/api/compile", dict(source=source, language="assembly", tier=2))
        compiled[name] = (source, result)
        print("Compiled", name, len(result["words"]), flush=True)
    selections = {}
    for name, (source, result) in compiled.items():
        record = result["compiler_record"]
        candidate = dict(binary=result["words"], metadata=dict(
            abstraction=name, language="assembly", content_type="code",
            capabilities=result["capabilities"], submitted_source=source,
            trust_origin=result["trust_origin"], compiler_record=record,
            compiler_identity=record["compiler_identity"],
            compiler_version=record["compiler_version"], grants=["E"]))
        from urllib.error import HTTPError
        import time
        for attempt in range(2):
            try:
                plan = api("/api/lumps/save-plan", candidate)
                break
            except HTTPError as exc:
                detail = json.load(exc)
                if attempt or exc.code != 423 or detail.get("committed") is not False or not detail.get("lease_busy"):
                    raise RuntimeError(detail.get("error", "Save planning failed")) from None
                time.sleep(max(1, min(125, detail["lease"]["expires_at"] - time.time() + 1)))
        intent = api("/api/lumps/approval-intent", dict(
            digest=plan["digest"], action=plan["action"], plan_id=plan["plan_id"],
            confirmation=True, approval=dict(grants=["E"], capability_type="inform")))
        candidate["binary"] = plan["final_binary"]
        candidate["metadata"].update(save_plan_id=plan["plan_id"], approval_intent=intent["intent"])
        if plan.get("portable_binding"):
            candidate["metadata"]["portable_binding"] = plan["portable_binding"]
        if plan.get("compiler_record"):
            record = plan["compiler_record"]
            candidate["metadata"].update(compiler_record=record,
                compiler_identity=record["compiler_identity"], compiler_version=record["compiler_version"])
        saved = api("/api/lumps/save", candidate)
        selections[name] = dict(filename=saved["filename"], binaryHash=saved["binary_hash"],
                                token=saved["token"], revision=saved["lump_version"])
        print("Saved", name, selections[name], flush=True)
        assert before == {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in before}
    for item in copies:
        path = f"/api/namespace/design-v1?profile=ascending&design={item['id']}"
        current = api(path)
        document = copy.deepcopy(current["document"])
        for row in document["rows"]:
            row["name"] = RENAMES.get(row["name"], row["name"])
            if row["kind"] == "lump":
                row["selection"] = selections[row["name"]]
        saved = api(path, dict(document=document, fingerprint=current["fingerprint"],
                               bind=False), "PUT")
        checked = api(path)
        assert checked["document"] == document
        for row in checked["projection"]["rows"]:
            if row["kind"] == "lump" and row["policy"] == "Resident":
                assert not row.get("unresolved") and row["allocationWords"] > 0
        print("Assigned and verified", item["name"], flush=True)
    assert api("/api/namespace/design-v1?profile=ascending")["fingerprint"] == original
    assert before == {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in before}
    print("PASS: original Namespace and executable image unchanged")


if __name__ == "__main__":
    main()
