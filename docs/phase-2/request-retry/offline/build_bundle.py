"""Package only pinned, reviewed historical evidence; never run a hardware tool."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
INPUTS = {
    "attached_assets/capture_1794317160962.bin": "29042a6d710caff70688db0f6276a616937b4fc96d5b1503b8e18529776e8051",
    "attached_assets/events_1794317160963.jsonl": "210933e519861a252cc2aab7556353ade08416fe0bb1add2284c4bf86dfd79d3",
    "attached_assets/result_1794317160963.json": "12c08c52accf6231150fcbd84d45090fcdd5b26d92489c81d1f023438ec695c3",
    "docs/phase-2/request-retry/responder.py": "64b3d3b96f4553ad96657fb321a182ef447bde81f6febc55a95aee424e03d173",
    "docs/phase-2/request-retry/protocol.py": "b1d1d5361bdb239a22a7a9553d30c66807bd4d24ceb746e468e52d8477bfa4cf",
    "docs/phase-2/request-retry/physical-result.md": "baf7091fa1d538f5de692511c2aa275b903b9b39c31388477781cee25bcd6070",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(output):
    output = output.resolve()
    output.relative_to((ROOT / "generated-artifacts").resolve())
    if output.exists():
        raise ValueError("Output already exists; historical bundles are never overwritten")
    inputs = {}
    for name, expected in INPUTS.items():
        data = (ROOT / name).read_bytes()
        if digest(data) != expected:
            raise ValueError(f"Historical input hash mismatch: {name}")
        inputs[Path(name).name] = data
    events = [json.loads(line) for line in inputs["events_1794317160963.jsonl"].splitlines()]
    # Only the machine-local COM label is removed; timing, boundaries and bytes stay intact.
    events[0]["port"] = "[REDACTED]"
    responder = inputs["responder.py"].decode()
    node = next(n for n in ast.parse(responder).body if isinstance(n, ast.ClassDef) and n.name == "Session")
    session = '"""Verbatim retained Session class; serial driver deliberately excluded."""\n'
    session += "import struct\nfrom protocol import (REQUEST, RESPONSE, REPORT_SIZE, challenge, crc,\n"
    session += "                      decode_report, verify_baseline, verify_reports)\n\n"
    session += "\n".join(responder.splitlines()[node.lineno - 1:node.end_lineno]) + "\n"
    files = {
        "capture.bin": inputs["capture_1794317160962.bin"],
        "events.jsonl": ("".join(json.dumps(e, sort_keys=True) + "\n" for e in events)).encode(),
        "result.json": inputs["result_1794317160963.json"],
        "protocol.py": inputs["protocol.py"],
        "physical-result.md": inputs["physical-result.md"],
        "session.py": session.encode(),
        "replay.py": (HERE / "replay.py").read_bytes(),
        "README.md": (HERE / "README.md").read_bytes(),
        "REDISTRIBUTION.md": (HERE / "REDISTRIBUTION.md").read_bytes(),
    }
    manifest = dict(schema="request-retry-offline-v1", original_inputs=INPUTS,
                    transformations={
                        "events.jsonl": "Replace opening port with [REDACTED]; canonical JSON key ordering only",
                        "session.py": "Verbatim Session class extracted from pinned responder; offline imports only",
                    },
                    files={name: dict(bytes=len(data), sha256=digest(data))
                           for name, data in sorted(files.items())})
    files["manifest.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        staging = Path(temp)
        for name, data in files.items():
            (staging / name).write_bytes(data)
        subprocess.run([sys.executable, "-B", str(staging / "replay.py")], check=True)
        output.mkdir()
        bundle = output / "request-retry-offline.zip"
        with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo("request-retry-offline/" + name, (2026, 11, 10, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        shutil.copyfile(staging / "manifest.json", output / "manifest.json")
        (output / "SHA256SUMS").write_text(f"{digest(bundle.read_bytes())}  {bundle.name}\n")
    return bundle


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "generated-artifacts/request-retry-offline")
    args = parser.parse_args()
    print(build(args.out))
