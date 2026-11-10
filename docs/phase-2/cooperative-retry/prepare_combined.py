"""Freeze the user-approved local combined candidate; no vendor/physical actions."""
import hashlib
import json
from pathlib import Path
from prepare_starter import prepare as prepare_parent, IMAGE_HASHES, digest
from prepare_combined_review import build

APPROVED = {
    "all-waiting": "bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7",
    "user-b": "1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb",
}
APPROVED_LUMPS = {
    "old": "9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b",
    "new": "01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9",
}


def prepare(output):
    inputs, images = build()
    if {name: item["sha256"] for name, item in images.items()} != APPROVED:
        raise ValueError("application bytes changed; new exact-image approval required")
    for record in inputs["records"]:
        if record["name"] in APPROVED_LUMPS and record["localizedSha256LE"] != APPROVED_LUMPS[record["name"]]:
            raise ValueError("received revision bytes changed; exact candidate review required")
    output = prepare_parent(output)
    source = output / "hardware/starter_top.py"
    text = source.read_text()
    for name, old in IMAGE_HASHES.items():
        if text.count(old) != 1:
            raise ValueError("unexpected historical allowlist source")
        text = text.replace(old, APPROVED[name])
        (output / "applications" / f"{name}.bin").write_bytes(images[name]["bytes"])
    source.write_text(text)
    (output / "combined-inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    # The historical manifest describes its parent only; keep it as such, not as
    # a claim that the subsequently specialized source still matches that receipt.
    (output / "starter-source-manifest.json").rename(output / "parent-source-manifest.json")
    files = {p.relative_to(output).as_posix(): digest(p)
             for p in output.rglob("*") if p.is_file() and "__pycache__" not in p.parts}
    identity = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    (output / "combined-source-manifest.json").write_text(json.dumps({
        "schema": "church.combined-source/v1", "sourceConfigurationSha256": identity,
        "files": files, "applications": APPROVED,
        "approval": "user approved exact candidate images for local combined-top qualification",
        "vendorBuild": False, "physicalOperations": False, "bitstreamSha256": None,
    }, indent=2) + "\n")
    return output


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(prepare(parser.parse_args().output))
