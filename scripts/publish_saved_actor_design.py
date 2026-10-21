"""Explicit local IDE operation: publish actors, save NewLayout, admit and check.

Uses ordinary HTTP compiler/save review endpoints; never edits saved LUMP bytes,
approval records, installed boot images or hardware.
"""
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import struct
import subprocess
import urllib.error
import urllib.request


def main():
    base = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, payload=None, method=None, confirmation=None):
        headers = {"Content-Type": "application/json", "X-Requested-With": "NamespaceDesign"}
        if confirmation:
            headers["X-Change-Confirmation"] = confirmation
        req = urllib.request.Request(base + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers=headers, method=method)
        try:
            response = opener.open(req, timeout=120)
        except urllib.error.HTTPError as exc:
            body = json.load(exc)
            if exc.code == 428 and not confirmation:
                return request(path, payload, method, body["change_confirmation"]["id"])
            raise RuntimeError(f"{path}: {exc.code}: {body}") from None
        body = json.load(response)
        if body.get("ok") is False:
            raise RuntimeError(f"{path}: {body}")
        return body

    current = request("/api/namespace/design-v1")
    draft = copy.deepcopy(current["document"])
    for stem, name, slot in [
        ("alice", "ide.Alice", 16), ("mallory", "ide.Mallory", 17),
        ("alice_driver", "ide.AliceDriver", 18), ("mallory_driver", "ide.MalloryDriver", 19),
        ("actor_manager", "ide.ActorManager", 20),
    ]:
        occupants = [r for r in draft["rows"] if r["slot"] == slot]
        if occupants and occupants[0]["name"] != name:
            raise RuntimeError(f"NS[{slot}] is occupied; no implicit identity rename allowed")
        source = Path(f"simulator/examples/{stem}.cloomc").read_text()
        compiled = request("/api/compile", dict(source=source, language="assembly", tier=2))
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
        row = dict(slot=slot, name=name, kind="lump", policy="Resident", sequence=0,
            authoring=dict(kind="source", path=f"simulator/examples/{stem}.cloomc"),
            selection=dict(filename=saved["filename"], binaryHash=saved["binary_hash"],
                           token=saved["token"], revision=saved["lump_version"]))
        draft["rows"] = [r for r in draft["rows"] if r["slot"] != slot] + [row]
        print("Published", saved["filename"])
    for row in draft["rows"]:
        if row["kind"] == "lump":
            row["boot"] = row["slot"] == 20
        if row["slot"] in (11, 12):
            row["preparedThread"] = dict(entrySlot=18 if row["slot"] == 11 else 19,
                                        actorSlot=16 if row["slot"] == 11 else 17)
    saved = request("/api/namespace/design-v1",
                    dict(fingerprint=current["fingerprint"], document=draft), "PUT")
    prepared = request("/api/simulation/design/ascending/prepare",
                       dict(namespaceFingerprint=saved["fingerprint"]))
    ids = {k: prepared[k] for k in ("preparationId", "configurationHash")}
    request("/api/simulation/design/ascending/approve", ids)
    active = request("/api/simulation/design/ascending/activate", ids)
    out = Path("generated-artifacts/saved-actors")
    out.mkdir(parents=True, exist_ok=True)
    image = out / "admitted.bin"
    image.write_bytes(struct.pack(f"<{len(active['words'])}I", *active["words"]))
    subprocess.run(["node", "simulator/check_saved_actor_image.js", str(image)], check=True)
    (out / "evidence.json").write_text(json.dumps(dict(imageHash=active["imageHash"],
        namespaceFingerprint=saved["fingerprint"], preparedRows=prepared["preparedRows"]), indent=2))
    print("Verified selected NewLayout", active["imageHash"])


if __name__ == "__main__":
    main()
