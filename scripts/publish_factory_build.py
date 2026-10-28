"""Explicit normal-API publication of the reviewed simulator Factory Build.

The default mode compiles and records the proposed change without publishing.
--apply requires the reviewed fingerprint and uses normal protected save flows.
Never uploads a private simulator candidate or touches hardware.
"""
import argparse
import copy
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import struct
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts/factory-build"
SLOTS = {"ide.Alice":16, "ide.AliceDriver":18, "ide.MalloryDriver":19,
         "ide.WukongCallHome":7, "ide.CapabilityTest":10, "ide.AmoebaStartup":21}


def admit(request, saved, published, entries):
    residents = {r["name"] for r in saved["document"]["rows"]
                 if r["kind"] == "lump" and r["policy"] == "Resident"}
    reports = saved.get("bindingReport", {}).get("lists", [])
    bound = {r["name"] for r in reports if r.get("status") == "bound"}
    if residents - bound:
        raise RuntimeError(f"Resident bindings incomplete: {sorted(residents-bound)}")
    prepared = request("/api/simulation/design/ascending/prepare",
                       dict(namespaceFingerprint=saved["fingerprint"]))
    ids = {k:prepared[k] for k in ("preparationId","configurationHash")}
    approved = request("/api/simulation/design/ascending/approve",ids)
    active = request("/api/simulation/design/ascending/activate",ids)
    (OUT / "admitted.bin").write_bytes(struct.pack(f"<{len(active['words'])}I",*active["words"]))
    evidence = dict(imageHash=active["imageHash"],namespaceFingerprint=saved["fingerprint"],
        approvedRevisionId=approved["approvedRevisionId"], preparedRows=prepared["preparedRows"],
        published=published,entries=entries,faultHandlerSlot=21)
    (OUT / "admission.json").write_text(json.dumps(evidence,indent=2))
    print("Admitted Factory Build",active["imageHash"],flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--fingerprint")
    parser.add_argument("--admit-existing", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    base = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, payload=None, method=None, confirmation=None):
        headers = {"Content-Type":"application/json", "X-Requested-With":"NamespaceDesign"}
        if confirmation:
            headers["X-Change-Confirmation"] = confirmation
        req = urllib.request.Request(base + path, method=method, headers=headers,
            data=json.dumps(payload).encode() if payload is not None else None)
        try:
            response = opener.open(req, timeout=120)
        except urllib.error.HTTPError as exc:
            data = json.load(exc)
            if exc.code == 428 and args.apply and not confirmation:
                return request(path, payload, method, data["change_confirmation"]["id"])
            raise RuntimeError(f"{path}: {exc.code}: {data}") from None
        data = json.load(response)
        if data.get("ok") is False or data.get("errors"):
            raise RuntimeError(f"{path}: {data}")
        return data

    current = request("/api/namespace/design-v1")
    if args.admit_existing:
        saved = json.loads((OUT / "after.json").read_text())
        if current["fingerprint"] != saved["fingerprint"]:
            raise RuntimeError("Saved Factory Build changed; no admission attempted")
        admit(request, saved, json.loads((OUT / "published.json").read_text()),
              json.loads((OUT / "review.json").read_text())["entries"])
        return
    if args.apply and current["fingerprint"] != args.fingerprint:
        raise RuntimeError("Namespace changed since review; no publication attempted")
    draft = copy.deepcopy(current["document"])
    before = {r["slot"]:copy.deepcopy(r) for r in draft["rows"]}
    if [r["slot"] for r in draft["rows"] if r.get("boot")] != [21]:
        raise RuntimeError("Reviewed AmoebaStartup boot selection changed")
    if sorted(r["slot"] for r in draft["rows"] if r["kind"] == "thread") != [2,11,12]:
        raise RuntimeError("Reviewed three-Thread membership changed")
    for name, slot in SLOTS.items():
        if before.get(slot, {}).get("name") != name:
            raise RuntimeError(f"NS[{slot}] no longer holds {name}")

    compiled_sources = {}
    for name in SLOTS:
        path = f"simulator/examples/factory-build/{name}.cloomc"
        source = (ROOT / path).read_text()
        compiled = request("/api/compile", dict(source=source, language="assembly", tier=2))
        compiled_sources[name] = (source, path, compiled)
    startup = compiled_sources["ide.AmoebaStartup"][2]["words"]
    # Public method dispatch words encode entry word offsets, while NIA is
    # relative to code after the header. Take entries from the actual compiler.
    entries = {11:startup[2]-1, 12:startup[3]-1}
    if any(type(n) is not int or not 0 <= n < ((startup[0] >> 10) & 8191)
           for n in entries.values()):
        raise RuntimeError("Compiler did not emit the reviewed startup method table")
    review = {"before":current, "sources":{
        name:{"path":path, "sourceHash":hashlib.sha256(source.encode()).hexdigest(),
              "slot":SLOTS[name], "codeWords":c["words"][1:1+((c["words"][0]>>10)&8191)]}
        for name,(source,path,c) in compiled_sources.items()},
        "entries":entries, "faultHandlerSlot":21,
        "preservedSlots":sorted(set(before)-set(SLOTS.values())-{11,12})}
    if not args.apply:
        (OUT / "review.json").write_text(json.dumps(review,indent=2))
        print(json.dumps({"fingerprint":current["fingerprint"],"entries":entries,
                         "changes":list(SLOTS),"review":str(OUT/"review.json")},indent=2))
        return
    previous = json.loads((OUT / "review.json").read_text())
    if previous != json.loads(json.dumps(review)):
        raise RuntimeError("Source/Namespace diff differs from review; review again")
    (OUT / "before.json").write_text(json.dumps(current,indent=2))
    published = {}
    for name,(source,path,compiled) in compiled_sources.items():
        record = compiled["compiler_record"]
        candidate = dict(binary=compiled["words"], metadata=dict(
            abstraction=name, language="assembly", content_type="code",
            capabilities=compiled["capabilities"], submitted_source=source,
            trust_origin=compiled["trust_origin"], compiler_record=record,
            compiler_identity=record["compiler_identity"],
            compiler_version=record["compiler_version"], grants=["E"]))
        plan = request("/api/lumps/save-plan", candidate)
        intent = request("/api/lumps/approval-intent", dict(digest=plan["digest"],
            action=plan["action"], plan_id=plan["plan_id"], confirmation=True,
            approval=dict(grants=["E"], capability_type="inform")))
        candidate["binary"] = plan["final_binary"]
        candidate["metadata"].update(save_plan_id=plan["plan_id"], approval_intent=intent["intent"])
        if plan.get("portable_binding"):
            candidate["metadata"]["portable_binding"] = plan["portable_binding"]
        if plan.get("compiler_record"):
            record = plan["compiler_record"]
            candidate["metadata"].update(compiler_record=record,
                compiler_identity=record["compiler_identity"], compiler_version=record["compiler_version"])
        saved = request("/api/lumps/save", candidate)
        published[name] = {k:saved[k] for k in ("filename","binary_hash","token","lump_version")}
        row = next(r for r in draft["rows"] if r["slot"] == SLOTS[name])
        row["authoring"] = dict(kind="source",path=path)
        row["selection"] = dict(filename=saved["filename"],binaryHash=saved["binary_hash"],
                               token=saved["token"],revision=saved["lump_version"])
        print("Published",name,saved["filename"],flush=True)
        (OUT / "published.json").write_text(json.dumps(published,indent=2))
    for row in draft["rows"]:
        if row["slot"] in entries:
            row["preparedThread"] = {**row["preparedThread"], "entrySlot":21,
                "entryNia":entries[row["slot"]]}
    draft["faultHandlerSlot"] = 21
    for slot in review["preservedSlots"]:
        assert next(r for r in draft["rows"] if r["slot"] == slot) == before[slot]
    saved = request("/api/namespace/design-v1",
        dict(fingerprint=current["fingerprint"],document=draft,bind=True),"PUT")
    (OUT / "after.json").write_text(json.dumps(saved,indent=2))
    admit(request, saved, published, entries)


if __name__ == "__main__":
    main()
