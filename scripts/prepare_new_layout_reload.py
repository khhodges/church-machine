#!/usr/bin/env python3
"""Retain New Layout using its simulator preparation; never contact hardware."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from server.design_simulation import configuration, stage
    from server.boot_image import build_wukong_upload_image
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = ROOT / "server/lumps"
    document_bytes = (source / "design-drafts/ascending-v1.json").read_bytes()
    document = json.loads(document_bytes)
    entry = next(row["slot"] for row in document["rows"] if row.get("boot"))
    raw, rows, bindings = stage(configuration(document), document, str(source), entry)
    rejection = None
    try:
        build_wukong_upload_image(raw)
    except ValueError as exc:
        rejection = str(exc)
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "design.json").write_bytes(document_bytes)
    (args.output / "simulator-image-le.bin").write_bytes(raw)
    artifacts = args.output / "artifacts"
    artifacts.mkdir()
    for binding in bindings:
        name = binding["filename"]
        assert Path(name).name == name
        body = (source / name).read_bytes()
        assert hashlib.sha256(body).hexdigest() == binding["binaryHash"]
        (artifacts / name).write_bytes(body)
    report = {
        "name": "New Layout",
        "status": "blocked by existing hardware loader; physical trial pending",
        "format": document["format"],
        "slots": document["slotCount"],
        "size": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "entrySlot": entry,
        "preparedRows": rows,
        "artifactBindings": bindings,
        "existingLoaderRejection": rejection,
        "scope": "Simulator preparation only; execution not rerun; no hardware commands.",
        "hardwareCompatibleImageEstablished": False,
    }
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("preparedRows", "artifactBindings")}, indent=2))
    return 2 if rejection else 0


if __name__ == "__main__":
    sys.exit(main())
