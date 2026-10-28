"""Compile review-only candidates; never save, bind, approve or activate."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts/data-access-candidates"
NAMES = ("Alice", "AliceDriver", "MalloryDriver", "WukongCallHome",
         "CapabilityTest", "AmoebaStartup")


def main():
    base = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
    def request(path, body=None):
        req = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type":"application/json"})
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.load(response)
        if result.get("ok") is False or result.get("errors"):
            raise RuntimeError(str(result))
        return result
    before = request("/api/namespace/design-v1")
    OUT.mkdir(parents=True, exist_ok=True)
    review = {"published":False, "activated":False,
              "namespaceFingerprint":before["fingerprint"], "candidates":[]}
    old_review = json.loads((ROOT / "generated-artifacts/factory-build/review.json").read_text())
    for name in NAMES:
        full = "ide." + name
        source = (ROOT / f"simulator/examples/factory-build/{full}.cloomc").read_text()
        compiled = request("/api/compile", {"source":source, "language":"assembly", "tier":2})
        (OUT / f"{full}.json").write_text(json.dumps(compiled, indent=2))
        words = compiled["words"]
        code = words[1:1+((words[0]>>10)&8191)]
        previous = old_review["sources"][full]["codeWords"]
        if len(code) != len(previous):
            raise ValueError(f"{full}: unexpected code length change")
        changes = []
        for i, (old, new) in enumerate(zip(previous, code)):
            if old == new:
                continue
            if old >> 27 not in (16,17) or old & ~32767 != new & ~32767:
                raise ValueError(f"{full}: unexpected non-data instruction change at {i}")
            expected = ((old & 0x3fff) << 4) if old & 0x4000 else (old & 32767)
            if new & 32767 != expected:
                raise ValueError(f"{full}: unexpected operand at {i}")
            changes.append({"codeOffset":i,"old":f"{old:08x}","new":f"{new:08x}"})
        review["candidates"].append({"name":full,"sourceHash":hashlib.sha256(source.encode()).hexdigest(),
            "words":len(words),"changedInstructions":changes})
    after = request("/api/namespace/design-v1")
    if before["fingerprint"] != after["fingerprint"]:
        raise RuntimeError("Namespace changed during review; candidates not approved")
    review["namespaceUnchanged"] = True
    (OUT / "review.json").write_text(json.dumps(review,indent=2))
    print(json.dumps(review,indent=2))


if __name__ == "__main__":
    main()
