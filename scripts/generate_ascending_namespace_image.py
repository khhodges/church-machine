"""Generate a private ascending-v1 image from an already-migrated target state."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.namespace_ascending_image import FORMAT, generate_image


def _read_exact_inputs(state_path, config_path, lumps_dir):
    state_raw = state_path.read_bytes()
    config_raw = config_path.read_bytes()
    state, config = json.loads(state_raw), json.loads(config_raw)
    artifacts = {}
    input_hashes = {
        "namespace-state": hashlib.sha256(state_raw).hexdigest(),
        "boot-config": hashlib.sha256(config_raw).hexdigest(),
    }
    library = lumps_dir.resolve()
    for row in state.get("abstractions", []):
        if not isinstance(row, dict) or row.get("slot") in (1, 2) or row.get("backing") == "mmio":
            continue
        filename = row.get("filename")
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise ValueError(f"NS[{row.get('slot')}] requires an exact local LUMP filename")
        path = lumps_dir / filename
        if path.is_symlink() or not path.resolve().is_relative_to(library):
            raise ValueError(f"NS[{row.get('slot')}] LUMP must remain in the saved library")
        raw = path.read_bytes()
        artifacts[filename] = raw
        input_hashes[f"lumps/{filename}"] = hashlib.sha256(raw).hexdigest()
    return state, config, artifacts, input_hashes


def prepare(state_path, config_path, lumps_dir, output, *, image_format):
    if image_format != FORMAT:
        raise ValueError(f"Explicit format selection must be {FORMAT!r}")
    state_path, config_path, lumps_dir = map(Path, (state_path, config_path, lumps_dir))
    output = Path(output)
    generated_root = (ROOT / "generated-artifacts").resolve()
    resolved_output = output.resolve()
    if not resolved_output.is_relative_to(generated_root) or resolved_output == generated_root:
        raise ValueError("Candidate output must be a new directory under generated-artifacts")
    if resolved_output.is_relative_to(lumps_dir.resolve()):
        raise ValueError("Candidate output cannot be inside the saved LUMP library")
    if output.exists():
        raise ValueError("Refusing to replace an existing candidate directory")

    state, config, artifacts, frozen_inputs = _read_exact_inputs(
        state_path, config_path, lumps_dir)
    image, evidence = generate_image(
        state, config, lumps_dir, image_format=image_format, artifacts=artifacts)
    state_after, config_after, artifacts_after, inputs_after = _read_exact_inputs(
        state_path, config_path, lumps_dir)
    if (frozen_inputs != inputs_after or state_after != state
            or config_after != config or artifacts_after != artifacts):
        raise ValueError("An input changed during image generation; no candidate was written")

    record = {
        **evidence,
        "status": "private-candidate",
        "approvalEligible": False,
        "activationAllowed": False,
        "installationAllowed": False,
        "hardwareProgrammingAllowed": False,
        "inputSha256": frozen_inputs,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ascending-ns-", dir=output.parent))
    try:
        (stage / "candidate.bin").write_bytes(image)
        (stage / "candidate.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(stage, output)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", required=True, choices=[FORMAT],
                        help="Explicitly select the ascending Namespace ABI.")
    parser.add_argument("--namespace-state", type=Path, required=True,
                        help="Already-migrated target rows with namespaceFormat set.")
    parser.add_argument("--config", type=Path, default=ROOT / "server/boot-config.json")
    parser.add_argument("--lumps-dir", type=Path, default=ROOT / "server/lumps")
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "generated-artifacts" /
        ("ascending-namespace-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")))
    args = parser.parse_args()
    record = prepare(args.namespace_state, args.config, args.lumps_dir, args.output,
                     image_format=args.format)
    print(f"Private candidate: {args.output / 'candidate.bin'}")
    print(f"SHA-256: {record['imageSha256']}")
    print("Validated as ascending-v1 only; profile review is required. "
          "Not installed, activated, or hardware-programming eligible.")
