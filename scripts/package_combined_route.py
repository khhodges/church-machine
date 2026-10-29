"""Package build-only tools, never start Vivado or access hardware."""
import hashlib
from pathlib import Path
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(output):
    output.mkdir(parents=True, exist_ok=False)
    for name, source in {
        "combined_route.py": "scripts/combined_route.py",
        "initializer_route_verify.py": "scripts/initializer_route_verify.py",
        "clock-guard.tcl": "hardware/guarded_25mhz_clock_checks.tcl",
    }.items():
        shutil.copyfile(ROOT / source, output / name)
    tcl = (ROOT / "hardware/initializer_route.tcl").read_text()
    tcl = tcl.replace("initializer_route_verify.py", "combined_route.py")
    tcl = tcl.replace("No device programmed. Full-program and runtime-reload verification remain pending.",
                      "No device programmed. Combined physical startup and recovery remain pending.")
    (output / "route.tcl").write_text(tcl)
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
exec 9>"$HOME/wukong-vivado-build.lock"
flock -n 9 || { echo "Another vendor build holds the lock."; exit 1; }
python3 combined_route.py
test ! -e implementation.log
timeout 240m vivado -mode batch -nolog -nojournal -source route.tcl 2>&1 | tee implementation.log
grep -qx COMBINED_EXPERIMENTAL_BITSTREAM_READY implementation.log
test -s build-receipt.json
python3 combined_route.py
echo COMBINED_IMPLEMENTATION_PASS
""")
    (output / "README.txt").write_text(
        "Combined initializer + continuation experimental build-only package.\n"
        "Prepare using python3 combined_route.py --prepare SOURCE NEW_TARGET.\n"
        "Preparation checks both completed tests, freezes evidence, copies the DCP.\n"
        "It never starts Vivado. Keep the original validation directory unchanged.\n"
        "In NEW_TARGET source Vivado settings64.sh, then bash run.sh.\n"
        "Single build lock, two threads; 240-minute timeout (not an estimate).\n"
        "Reuses the vendor-tested checkpoint. No synthesis or image regeneration.\n"
        "Board pins, 25MHz clock topology, DRC, setup/hold/pulse timing are gated.\n"
        "The inherited board XDC exempts async inputs; internal timing does not\n"
        "certify external UART electrical timing. No constraints are relaxed.\n"
        "initializer_route_verify.py supplies only the established timing parser;\n"
        "its historical checkpoint pins are not used by this combined runner.\n"
        "No board, bridge, flash, programming, or production-source operations.\n"
        "Success: COMBINED_IMPLEMENTATION_PASS plus shell exit code 0.\n"
        "Preserve reports, receipt, routed checkpoint, and BIT for review.\n"
        "A partial BIT after failure is not accepted. No physical pass claimed.\n")
    (output / "checksums.sha256").write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
        for p in sorted(output.iterdir())))
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.iterdir()):
            z.write(path, f"{output.name}/{path.name}")
    print(archive)
    print(hashlib.sha256(archive.read_bytes()).hexdigest())


if __name__ == "__main__":
    package(Path(sys.argv[1]))
