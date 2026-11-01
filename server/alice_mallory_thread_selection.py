"""Carry the user's reviewed initialization across environment-local config.

Only empty or already-identical target designs can receive this one-time
selection. A later edit is never overwritten. No image is generated here.
"""
import json
from pathlib import Path


def apply_reviewed_designs(client, receipt):
    state = client.get("/api/boot-image/ns-state")
    config = client.get("/api/boot-config")
    if state.status_code != 200 or config.status_code != 200:
        raise ValueError("Cannot read Namespace and Thread configuration")
    if state.json["namespaceFingerprint"] != receipt["namespaceFingerprint"]:
        return {"changed": False, "reason": "Namespace differs from the reviewed selection"}
    cfg = config.json["config"]
    designs = receipt["designs"]
    for design in designs:
        slot = design["target"]["slot"]
        for key in ("threadInitialDesigns", "threadTupleDesign"):
            expected = design if key == "threadInitialDesigns" else {
                k: v for k, v in design.items() if k != "initialization"}
            current = [d for d in cfg.get(key, []) if d["target"]["slot"] == slot]
            if current and current != [expected]:
                return {"changed": False, "reason": f"NS[{slot}] has a newer reviewed design"}
        if (cfg["step1"]["threadLumpWords"] != design["sizeWords"]
                or cfg["step1"]["threadStackWords"] != design["stackWords"]):
            return {"changed": False, "reason": "Thread geometry differs from the review"}
    changed = False
    for design in designs:
        if design in cfg.get("threadInitialDesigns", []):
            continue
        response = client.post("/api/boot-config/thread-designs", json=design)
        if response.status_code == 428:
            response = client.post("/api/boot-config/thread-designs", json=design,
                headers={"X-Change-Confirmation": response.json["change_confirmation"]["id"]})
        if response.status_code != 200 or response.json.get("imageChanged") is not False:
            raise ValueError(f"Reviewed Thread initialization was not saved: {response.status_code}")
        changed = True
    return {"changed": changed, "imageChanged": False, "hardwareChanged": False}


if __name__ == "__main__":
    import server.app as service
    receipt = json.loads((Path(__file__).parent / "alice-mallory-thread-selection.json").read_text())
    with service.app.test_client() as client:
        print(json.dumps(apply_reviewed_designs(client, receipt)))
