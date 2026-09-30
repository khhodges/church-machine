#!/usr/bin/env python3
"""Read-only publication/merge gate; never repair or regenerate runtime state."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.namespace_authority import validate_namespace_rows
from server.boot_image import validate_boot_image, validate_resident_artifact_bindings


def audit(lumps_dir, state_path=None, image_path=None):
    root = Path(lumps_dir)
    state_path = Path(state_path) if state_path else root / "ns-state.json"
    image_path = Path(image_path) if image_path else root / "boot-image.bin"
    errors = []
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        validate_namespace_rows(state.get("abstractions") if isinstance(state, dict) else None)
    except (OSError, ValueError, TypeError) as error:
        errors.append("Namespace state: " + str(error))
    try:
        image = image_path.read_bytes()
        validate_boot_image(image)
        validate_resident_artifact_bindings(image, str(root), ns_state_path=str(state_path))
    except (OSError, ValueError, TypeError) as error:
        errors.append("Derived image: " + str(error))
    return {"ok": not errors, "errors": errors, "readOnly": True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lumps-dir", default="server/lumps")
    parser.add_argument("--state")
    parser.add_argument("--image")
    args = parser.parse_args(argv)
    result = audit(args.lumps_dir, args.state, args.image)
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())