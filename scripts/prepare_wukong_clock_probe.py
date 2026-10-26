"""Export the actual 25 MHz clock module for offline Vivado primitive simulation.

No network, synthesis, FPGA connection, or changes to the runtime image.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.back import rtlil
from hardware.wukong_top import WukongClock25


def prepare(output):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    clock = WukongClock25()
    (output / "clock25.il").write_text(rtlil.convert(
        clock, name="clock25", ports=[clock.clk_in, clock.clk_out, clock.locked]))
    subprocess.run(["yosys", "-Q", "-T", "-p",
                    "read_rtlil clock25.il; write_verilog -noattr clock25.v"],
                   cwd=output, check=True)
    shutil.copyfile(ROOT / "tests/hardware/wukong_clock25_tb.v", output / "clock25_tb.v")
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
sha256sum -c inputs.sha256
if [ -e xsim.dir ]; then
  echo "STOP: simulation output exists; extract into a fresh directory."
  exit 1
fi
xvlog clock25.v clock25_tb.v "$XILINX_VIVADO/data/verilog/src/glbl.v"
xelab -L unisims_ver -L secureip clock25_tb glbl -s clock25_probe
xsim clock25_probe -runall | tee simulation.txt
grep -qx 'CLOCK25_PASS: 200 stable cycles at 25 MHz after lock' simulation.txt
echo 'Clock primitive simulation passed; NOT programming or full-design approval.'
""")
    files = ["clock25.v", "clock25_tb.v", "clock25.il", "run.sh"]
    hashes = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
              for name in files}
    (output / "inputs.sha256").write_text("".join(
        f"{digest}  {name}\n" for name, digest in hashes.items()))
    (output / "manifest.json").write_text(json.dumps({
        "purpose": "Offline clock primitive simulation only",
        "sourceSha256": hashlib.sha256((ROOT / "hardware/wukong_top.py").read_bytes()).hexdigest(),
        "inputClockHz": 50000000, "outputClockHz": 25000000,
        "files": hashes, "physicalBoardTested": False,
    }, indent=2) + "\n")
    archive = output.with_suffix(".tar.gz")
    with tarfile.open(archive, "x:gz") as tar:
        tar.add(output, arcname=output.name)
    print(hashlib.sha256(archive.read_bytes()).hexdigest(), archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    prepare(parser.parse_args().output)
