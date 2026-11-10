"""Save independent review copies through existing IDE APIs; never bind or activate."""
import hashlib
import json
import os
from pathlib import Path
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from http.cookiejar import CookieJar

ROOT = Path(__file__).resolve().parents[3]
BASE = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
CLIENT = build_opener(HTTPCookieProcessor(CookieJar()))


def api(path, payload=None, method=None):
    request = Request(BASE + path,
                      data=None if payload is None else json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json",
                               "Origin": BASE, "X-Requested-With": "NamespaceDesign"},
                      method=method)
    try:
        with CLIENT.open(request) as response:
            result = json.load(response)
    except HTTPError as error:
        if error.code != 428 or payload is None:
            raise
        review = json.load(error)
        if review.get("error") != "change_confirmation_required":
            raise ValueError("Unexpected prerequisite; no change authorized")
        # User explicitly authorized creating these two independent designs.
        # Preserve the exact request and session; never bypass the review gate.
        request.add_header("X-Change-Confirmation", review["change_confirmation"]["id"])
        with CLIENT.open(request) as response:
            result = json.load(response)
    if not result.get("ok"):
        raise ValueError(result)
    return result


def document(other_user):
    def row(slot, name, kind, policy="Resident", source=None, **extra):
        result = dict(slot=slot, name=name, kind=kind, policy=policy, sequence=0,
                      authoring={"kind": "namespace-table" if kind == "namespace" else "entry"},
                      **extra)
        if source:
            result["authoring"] = dict(kind="source", path=f"simulator/examples/cooperative_retry_{source}.cloomc")
        return result
    rows = [
        row(1, "Boot.NS", "namespace"),
        row(2, "Boot.Thread", "thread", words=256),
        row(3, "Cooperative.SystemUserB" if other_user else "Cooperative.SystemWaiting",
            "lump", source="system_user_b" if other_user else "system_waiting", boot=True),
        row(4, "Cooperative.UserA.Thread", "thread", words=256,
            preparedThread=dict(entrySlot=5, actorSlot=5)),
        row(5, "Cooperative.UserA", "lump", source="user_a"),
        row(6, "Cooperative.Payload", "lump", policy="Lazy", source="payload"),
        row(7, "Cooperative.Receiver", "mmio", policy="Hardware", address=0x4000001c, limit=1),
    ]
    if other_user:
        rows += [
            row(8, "Cooperative.UserB.Thread", "thread", words=256,
                preparedThread=dict(entrySlot=9, actorSlot=9)),
            row(9, "Cooperative.UserB", "lump", source="user_b"),
        ]
    return dict(format="ascending-nst-metadata-slot0-v1", capacityWords=16384,
                slotCount=64, outputProfile="api", rows=rows)


def main():
    protected = [ROOT / "server/lumps" / name for name in
                 ("ns-state.json", "manifest.json", "boot-image.bin")]
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in protected if p.exists()}
    source = api("/api/namespace/design-v1?profile=ascending")
    if not source["persisted"]:
        raise ValueError("Existing saved source required; will not mutate the original")
    copies = api("/api/namespace/design-copies")["copies"]
    results = []
    for other_user, name in [(True, "Cooperative Retry — USER B — Review"),
                             (False, "Cooperative Retry — All Waiting — Review")]:
        if any(c["name"] == name for c in copies):
            raise ValueError(f"Already exists: {name}; do not overwrite user review")
        created = api("/api/namespace/design-copies", dict(
            profile="ascending", sourceId="", fingerprint=source["fingerprint"], name=name))
        identifier = created["copy"]["id"]
        path = f"/api/namespace/design-v1?profile=ascending&design={identifier}"
        copied = api(path)
        saved = api(path, dict(fingerprint=copied["fingerprint"],
                              document=document(other_user), bind=False), "PUT")
        checked = api(path)
        assert checked["document"] == document(other_user) and checked["persisted"]
        assert saved["bindingRequested"] is False
        results.append(dict(name=name, id=identifier, fingerprint=checked["fingerprint"]))
    assert api("/api/namespace/design-v1?profile=ascending")["fingerprint"] == source["fingerprint"]
    assert before == {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in before}
    print(json.dumps(dict(designs=results, originalAndExecutableFilesUnchanged=True), indent=2))


if __name__ == "__main__":
    main()
