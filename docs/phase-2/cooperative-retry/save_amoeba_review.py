"""Save only a new portable ide.Amoeba review LUMP through ordinary IDE APIs."""
import hashlib
import json
from pathlib import Path
from save_review_designs import api, ROOT


def main():
    source = (ROOT / "simulator/examples/amoeba_loader.cloomc").read_text()
    protected = [ROOT / "server/lumps" / n for n in ("ns-state.json", "boot-image.bin")]
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    manifest = json.loads((ROOT / "server/lumps/manifest.json").read_text())
    if any(row.get("abstraction") == "ide.Amoeba" for row in manifest):
        raise ValueError("ide.Amoeba already exists; do not replace it or silently retry this save")
    result = api("/api/compile", dict(source=source, language="assembly", tier=2))
    if result.get("warnings"):
        raise ValueError(result["warnings"])
    record = result["compiler_record"]
    candidate = dict(binary=result["words"], metadata=dict(
        abstraction="ide.Amoeba", language="assembly", content_type="code",
        capabilities=result["capabilities"], submitted_source=source,
        trust_origin=result["trust_origin"], compiler_record=record,
        compiler_identity=record["compiler_identity"],
        compiler_version=record["compiler_version"], grants=["E"],
        description="Native fixed-allocation Amoeba review; requires local CLA1 runtime, not installed hardware"))
    plan = api("/api/lumps/save-plan", candidate)
    intent = api("/api/lumps/approval-intent", dict(
        digest=plan["digest"], action=plan["action"], plan_id=plan["plan_id"],
        confirmation=True, approval=dict(grants=["E"], capability_type="inform")))
    candidate["binary"] = plan["final_binary"]
    candidate["metadata"].update(save_plan_id=plan["plan_id"], approval_intent=intent["intent"])
    for key in ("portable_binding", "compiler_record"):
        if plan.get(key):
            candidate["metadata"][key] = plan[key]
    if plan.get("compiler_record"):
        record = plan["compiler_record"]
        candidate["metadata"].update(compiler_identity=record["compiler_identity"],
                                     compiler_version=record["compiler_version"])
    # Do not retry an ambiguous save outcome. Inspect operation status instead.
    saved = api("/api/lumps/save", candidate)
    assert before == {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in before}
    filename = saved["filename"]
    raw = (ROOT / "server/lumps" / filename).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == saved["binary_hash"]
    receipt = dict(filename=filename, token=saved["token"], revision=saved["lump_version"],
        binarySha256=saved["binary_hash"], sourceSha256=hashlib.sha256(source.encode()).hexdigest(),
        savedNamespaceUnchanged=True, savedBootImageUnchanged=True, physicalOperations=False)
    out = ROOT / "generated-artifacts/amoeba-review"
    out.mkdir(parents=True, exist_ok=True)
    (out / "save-receipt.json").write_text(json.dumps(receipt, indent=2)+"\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
