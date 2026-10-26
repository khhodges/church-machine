#!/usr/bin/env python3
"""Offline only: retain the saved image and existing loader projection for review.

Never imports the web server, opens serial, or sends/queues hardware commands.
Refuses to overwrite an existing evidence directory.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    from server.boot_image import (
        build_wukong_upload_image, read_boot_entry_info,
        validate_resident_artifact_bindings,
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = ROOT / "server/lumps"
    raw = (source / "boot-image.bin").read_bytes()
    validate_resident_artifact_bindings(raw, str(source))
    projected, info = build_wukong_upload_image(raw)
    assert len(projected) == 65536
    words = struct.unpack("<16384I", projected)
    wire = struct.pack(">16384I", *words)
    assert struct.unpack(">16384I", wire) == words
    out = args.output
    out.mkdir(parents=True, exist_ok=False)
    (out / "source.bin").write_bytes(raw)
    (out / "projected-le.bin").write_bytes(projected)
    provenance = json.loads((source / "boot-image.provenance.json").read_text())
    for name in ("boot-image.provenance.json", "ns-state.json"):
        shutil.copyfile(source / name, out / name)
    shutil.copyfile(ROOT / "server/boot-config.json", out / "boot-config.json")
    artifacts = out / "artifacts"
    artifacts.mkdir()
    for row in provenance["resident_bindings"]:
        name = row["filename"]
        assert Path(name).name == name
        artifact = (source / name).read_bytes()
        assert digest(artifact) == row["artifact_sha256"]
        (artifacts / name).write_bytes(artifact)
    layout = []
    for slot in range(64):
        descriptor = list(words[slot * 4:slot * 4 + 4])
        if not any(descriptor):
            continue
        row = {"slot": slot, "descriptor": descriptor}
        base = descriptor[0] // 4
        if descriptor[0] % 4 == 0 and 0 < base < len(words):
            header = words[base]
            if header >> 27 == 31:
                size = 1 << (((header >> 23) & 15) + 6)
                row.update(base_word=base, allocation_words=size,
                           body_sha256=digest(projected[base*4:(base+size)*4]))
        layout.append(row)
    sim = subprocess.run(
        ["node", "tests/boot/sim_boot_loader.js"], cwd=ROOT,
        input=json.dumps({
            "config": json.loads((out / "boot-config.json").read_text()),
            "imageBase64": base64.b64encode(raw).decode(),
        }),
        capture_output=True, text=True, timeout=60,
    )
    (out / "simulator.stdout.txt").write_text(sim.stdout)
    (out / "simulator.stderr.txt").write_text(sim.stderr)
    sim_result = json.loads(sim.stdout) if sim.returncode == 0 else None
    boot_ok = bool(sim_result and sim_result.get("loaded")
                   and sim_result.get("bootComplete")
                   and not sim_result.get("faultLog"))
    report = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "status": ("REVIEW REQUIRED; physical trial pending" if boot_ok else
                   "BLOCKED: offline boot failed; do not upload"),
        "source": {"size": len(raw), "sha256": digest(raw),
                   "entry": read_boot_entry_info(raw)},
        "projection": {"size": len(projected), "sha256": digest(projected),
                       "entry": info, "layout": layout},
        "wire": {"payload_sha256": digest(wire), "frame_size": len(wire)+5,
                 "header_hex": "7500010000", "conversion": "LE words to BE words"},
        "simulator_exit_code": sim.returncode,
        "simulator_boot_passed": boot_ok,
        "simulator_result": sim_result,
        "simulator_scope": "generic source loader/boot only, not projected RTL execution",
        "physical_transport": "not attempted",
        "installed_byte_verification": "not available from upload ACK",
        "physical_execution": "not attempted",
        "projection_warning": "Non-entry dependencies use hardware.boot_rom factory bodies; not all saved resident artifacts are copied.",
        "implementation_sha256": {
            name: digest((ROOT / name).read_bytes()) for name in (
                "server/boot_image.py", "hardware/boot_rom.py",
                "hardware/wukong_bridge.py", "hardware/wukong_top.py",
                "shared/architecture_contracts.json",
            )
        },
    }
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if boot_ok else 2


if __name__ == "__main__":
    sys.exit(main())
