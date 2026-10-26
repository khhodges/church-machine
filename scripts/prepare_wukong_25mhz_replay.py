"""Export exact retained 25 MHz full-top RTL for offline Vivado boot replay."""
import base64
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.readiness import WUKONG_SOURCES, source_fingerprint
from hardware.guarded_build_profile import NAME_25, build_inputs


def prepare(output):
    retained = ROOT / "generated-artifacts/new-layout-25mhz-candidate/rtl"
    rtl = retained / "church_wukong_xc7a100t.v"
    generated = json.loads((retained / "guarded-profile.json").read_text())
    _, inputs = build_inputs(NAME_25)
    fingerprint = source_fingerprint(WUKONG_SOURCES)
    with rtl.open() as stream:
        header = stream.readline().strip()
        stamp = stream.readline().strip()
    if stamp != "// CM-HARDWARE-SOURCES-SHA256: " + fingerprint:
        raise ValueError("Retained RTL source fingerprint changed")
    for key, value in inputs.items():
        if generated[key] != value:
            raise ValueError(f"Retained profile mismatch: {key}")
    if json.loads(header.split(": ", 1)[1]) != inputs:
        raise ValueError("RTL header mismatch")
    if hashlib.sha256(rtl.read_bytes()).hexdigest() != generated["generatedFilesSha256"][rtl.name]:
        raise ValueError("Retained Verilog changed")
    output.mkdir(parents=True, exist_ok=False)
    for source, name in [
        (rtl, rtl.name),
        (retained / "guarded-profile.json", "guarded-profile.json"),
        (ROOT / "tests/hardware/wukong_25mhz_boot_tb.v", "boot_tb.v"),
        (ROOT / "hardware/profiles/new_layout_guarded_25mhz.json", "profile.json"),
    ]:
        shutil.copyfile(source, output / name)
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
sha256sum -c inputs.sha256
if [ -e xsim.dir ]; then
  echo "STOP: simulation already started; use fresh extraction."
  exit 1
fi
timeout 30m xvlog church_wukong_xc7a100t.v boot_tb.v "$XILINX_VIVADO/data/verilog/src/glbl.v"
timeout 45m xelab -L unisims_ver -L secureip wukong_25mhz_boot_tb glbl -s boot25_probe
timeout 120m xsim boot25_probe -runall | tee simulation.txt
grep -q '^BOOT25_PASS: entry=00003504 ' simulation.txt
sha256sum -c inputs.sha256
echo 'Boot replay passed; NOT full-program, upload, timing, or programming approval.'
""")
    hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(output.iterdir())}
    (output / "inputs.sha256").write_text("".join(
        f"{digest}  {name}\n" for name, digest in hashes.items()))
    (output / "manifest.json").write_text(json.dumps({
        "schema": "church.experimental-vendor-boot-replay/v1",
        "sourceFingerprint": fingerprint, "files": hashes,
        "profile": inputs, "physicalBoardTested": False,
        "scope": "Boot handoff only; UART RX idle; no synthesis or hardware commands",
    }, indent=2) + "\n")
    archive = output.with_suffix(".tar.gz")
    with tarfile.open(archive, "x:gz") as tar:
        tar.add(output, arcname=output.name)
    raw = archive.read_bytes()
    # Add download text only after creating the archive, never embed it recursively.
    (output / "DOWNLOAD-boot25-base64.txt").write_text(base64.b64encode(raw).decode())
    print(json.dumps({"archive": str(archive), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()}, indent=2))


if __name__ == "__main__":
    prepare(ROOT / "generated-artifacts/new-layout-boot25-validation")
