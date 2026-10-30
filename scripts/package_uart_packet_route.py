"""Package a build-only continuation of the validated UART correction."""
import hashlib
from pathlib import Path
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import uart_packet_route as gate


def package(output):
    output.mkdir(parents=True, exist_ok=False)
    for name, source in {
        "uart_packet_route.py": "scripts/uart_packet_route.py",
        "combined_route.py": "scripts/combined_route.py",
        "initializer_route_verify.py": "scripts/initializer_route_verify.py",
        "clock-guard.tcl": "hardware/guarded_25mhz_clock_checks.tcl",
        "model-result.json": "generated-artifacts/uart-packet-atomic-validation/model-results/result.json",
        "model.log": "generated-artifacts/uart-packet-atomic-validation/model.log",
    }.items():
        shutil.copyfile(ROOT / source, output / name)
    gate.check_model(output)
    tcl = (ROOT / "hardware/initializer_route.tcl").read_text()
    tcl = tcl.replace("initializer_route_verify.py", "uart_packet_route.py")
    (output / "route.tcl").write_text(tcl)
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
exec 9>"$HOME/wukong-vivado-build.lock"
flock -n 9 || { echo "Another vendor build holds the lock."; exit 1; }
python3 uart_packet_route.py
test ! -e implementation.log
timeout 240m vivado -mode batch -nolog -nojournal -source route.tcl 2>&1 | tee implementation.log
grep -qx COMBINED_EXPERIMENTAL_BITSTREAM_READY implementation.log
test -s build-receipt.json
python3 uart_packet_route.py
echo UART_PACKET_IMPLEMENTATION_PASS
""")
    (output / "README.txt").write_text(
        "UART packet-atomic experimental build only. NO BOARD ACCESS.\n"
        "python3 uart_packet_route.py --prepare VALIDATION_DIR NEW_BUILD_DIR\n"
        "Then source Vivado settings64.sh in NEW_BUILD_DIR and bash run.sh.\n"
        "Uses the exact vendor-tested checkpoint and unchanged approved image.\n"
        "Local model evidence is included and hash-pinned to the same validation inputs.\n"
        "No repeat synthesis, image generation, validation-directory edits or programming.\n"
        "The established clock, board-pin, DRC, setup/hold/pulse gates remain intact.\n"
        "A single build lock prevents overlap; timeout is 240m, not an estimate.\n"
        "Success: UART_PACKET_IMPLEMENTATION_PASS and exit 0. Preserve the receipt.\n")
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
