"""Create the small offline continuation bundle; no hardware operations."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package(output):
    output.mkdir(parents=True, exist_ok=False)
    for name, source in {
        "prepare_initializer_route.py": "scripts/prepare_initializer_route.py",
        "initializer_route_verify.py": "scripts/initializer_route_verify.py",
        "route.tcl": "hardware/initializer_route.tcl",
        "clock-guard.tcl": "hardware/guarded_25mhz_clock_checks.tcl",
    }.items():
        shutil.copyfile(ROOT / source, output / name)
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
python3 initializer_route_verify.py
timeout 180m vivado -mode batch -nolog -nojournal -source route.tcl 2>&1 | tee implementation.log
grep -qx EXPERIMENTAL_BITSTREAM_READY implementation.log
test -s build-receipt.json
echo 'GUARDED_IMPLEMENTATION_PASS'
""")
    (output / "README.txt").write_text(
        "Experimental initializer-corrected 25MHz continuation.\n"
        "Verify bundle checksums, then run prepare_initializer_route.py with the\n"
        "verified full-boot package path. It creates a NEW continuation directory.\n"
        "No Vivado process starts during preparation. Original files are unchanged.\n"
        "In the prepared directory, source Vivado settings and run bash run.sh.\n"
        "Only the exact boot-tested synthesized checkpoint is accepted.\n"
        "No synthesis rerun, relaxed constraints, programming, or flash commands.\n"
        "Routing, clock tree, board pins, DRC and timing must pass before bitstream output.\n"
        "Internal timing checks do not certify external UART electrical timing.\n"
        "A PASS is experimental build evidence, not program/physical/reload acceptance.\n")
    (output / "package.json").write_text(json.dumps({
        "sourceInputsSha256": sha(ROOT / "generated-artifacts/initializer-full-boot-test-20261026/inputs.sha256"),
        "files": {p.name: sha(p) for p in sorted(output.iterdir())},
    }, indent=2) + "\n")
    (output / "checksums.sha256").write_text("".join(
        f"{sha(p)}  {p.name}\n" for p in sorted(output.iterdir())))
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.iterdir()):
            z.write(path, f"{output.name}/{path.name}")
    print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size,
                      "sha256": sha(archive)}, indent=2))


if __name__ == "__main__":
    package(Path(sys.argv[1]))
