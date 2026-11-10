"""Offline integrity/claim check for a completed local combined-top sequence."""
import argparse
import hashlib
import json
from pathlib import Path
from prepare_combined import APPROVED, APPROVED_LUMPS


def check(root):
    root = Path(root).resolve()
    manifest = json.loads((root / "combined-source-manifest.json").read_text())
    if manifest["applications"] != APPROVED:
        raise ValueError("evidence does not name the approved application images")
    if manifest["vendorBuild"] or manifest["physicalOperations"] or manifest["bitstreamSha256"] is not None:
        raise ValueError("local evidence must not assert vendor or physical acceptance")
    files = manifest["files"]
    expected_identity = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if expected_identity != manifest["sourceConfigurationSha256"]:
        raise ValueError("source/configuration identity mismatch")
    for name, expected in files.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"changed candidate input: {name}")
    for name, expected in APPROVED.items():
        if hashlib.sha256((root / "applications" / f"{name}.bin").read_bytes()).hexdigest() != expected:
            raise ValueError("application bytes differ from approved image")
    evidence = json.loads((root / "combined-evidence.json").read_text())
    if [row["proof"] for row in evidence] != [
            "lazy-delivery", "revision-adoption", "image-replacement"]:
        raise ValueError("missing or reordered proof")
    if any(row["sourceConfigurationSha256"] != expected_identity for row in evidence):
        raise ValueError("proofs came from different configurations")
    lazy, adoption, replacement = evidence
    inputs = json.loads((root / "combined-inputs.json").read_text())
    old, _, new, _ = inputs["records"]
    if any(r["localizedSha256LE"] != APPROVED_LUMPS[r["name"]] for r in (old, new)):
        raise ValueError("revision differs from approved exact candidate")
    if not (lazy["wrongContentRejected"] and adoption["results"][0] == 17 and
            lazy["userBProgress"] > 0 and
            lazy["digest"] == old["localizedSha256LE"]):
        raise ValueError("lazy-delivery evidence incomplete")
    if not (adoption["sizesWords"] == [old["sizeWords"], new["sizeWords"]] == [64, 256] and
            adoption["results"] == [17, 29, 17] and adoption["newDigest"] == new["localizedSha256LE"] and
            adoption["newFirstRejected"] and adoption["repeatedOldRejected"]):
        raise ValueError("adoption evidence incomplete")
    if not (lazy["epoch"] == adoption["epoch"] and replacement["epoch"] == lazy["epoch"] + 1 and
            replacement["userBProgressUnchanged"] and replacement["staleDeliveryRejected"] and
            replacement["imageSha256"] == manifest["applications"]["all-waiting"]):
        raise ValueError("replacement evidence incomplete")
    return expected_identity


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print("Local combined evidence verified:", check(parser.parse_args().directory))
