"""Freeze a build-only derivative of the tested UART RTL and retry image."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OLD = "e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102"
NEW = "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d"

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def prepare(out):
    frozen = ROOT / "generated-artifacts/uart-packet-atomic-validation"
    trial = ROOT / "generated-artifacts/amoeba-retry-image"
    subprocess.run(["sha256sum", "-c", "inputs.sha256"], cwd=frozen, check=True,
                   stdout=subprocess.DEVNULL)
    assert sha(trial / "candidate-le.bin") == NEW
    result = json.loads((trial / "results/result.json").read_text())
    assert result["imageSha256"] == NEW and result["outcome"] == "second-fault"
    assert [(f["code"], f["fetchAddress"], f["threadGT"] & 65535)
            for f in result["faults"]] == [(8, 0x3a08, 12)] * 2
    assert any(x[0] == 0x4638 and x[1] == 0xbf040001 for x in result["recoveryRetirements"])
    assert {x[2] & 65535 for x in result["recoveryRetirements"]} == {2,11,12}
    out.mkdir(parents=True, exist_ok=False)
    snapshot = out / "source-snapshot"
    shutil.copytree(frozen / "source-snapshot", snapshot,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    image_rel = "generated-artifacts/data-access-validation/admitted.bin"
    profile_rel = "hardware/guarded_build_profile.py"
    shutil.copyfile(trial / "candidate-le.bin", snapshot / image_rel)
    profile = snapshot / profile_rel
    text = profile.read_text()
    assert text.count(OLD) == 1
    # Explicit build-input authorization for this derivative, not a bypass of
    # the exact hash/layout gate and not an edit to the frozen baseline.
    profile.write_text(text.replace(OLD, NEW))
    deltas = [str(p.relative_to(snapshot)) for p in snapshot.rglob("*")
              if p.is_file() and sha(p) != sha(frozen / "source-snapshot" / p.relative_to(snapshot))]
    assert sorted(deltas) == sorted([image_rel, profile_rel]), deltas
    for src, dest in (
        (trial / "candidate-le.bin", "candidate-le.bin"),
        (trial / "evidence.json", "binding-evidence.json"),
        (trial / "results/result.json", "replay-result.json"),
        (trial / "source.cloomc", "amoeba-retry.cloomc"),
        (frozen / "board.xdc", "board.xdc"),
        (ROOT / "hardware/guarded_25mhz_clock_checks.tcl", "clock-guard.tcl"),
        (ROOT / "scripts/initializer_route_verify.py", "initializer_route_verify.py"),
        (ROOT / "scripts/verify_amoeba_retry_bitstream.py", "verify.py"),
    ):
        shutil.copyfile(src, out / dest)
    packages = [p for p in sys.path if "site-packages" in p]
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(snapshot), *packages]),
               CHURCH_LUMPS_DIR=str(snapshot / "server/lumps"))
    command = ("from hardware.gen_rtlil import generate_rtlil_wukong;"
               "from hardware.guarded_build_profile import CONTINUATION_NAME;"
               f"generate_rtlil_wukong({str(out / 'rtl')!r},profile=CONTINUATION_NAME)")
    with (out / "generation.log").open("w") as log:
        subprocess.run([sys.executable, "-u", "-c", command], cwd=snapshot,
                       env=env, stdout=log, stderr=subprocess.STDOUT,
                       timeout=1200, check=True)
    # Preserve all existing clock/pin/DRC and precise-slack gates.
    route = (ROOT / "hardware/initializer_route.tcl").read_text()
    assert route.count("open_checkpoint input.dcp") == 1
    route = route.replace("open_checkpoint input.dcp",
                          "open_checkpoint synthesized.dcp")
    route = route.replace("initializer_route_verify.py", "verify.py")
    (out / "route.tcl").write_text(route)
    (out / "synth.tcl").write_text((frozen / "synth.tcl").read_text())
    (out / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
exec 9>"$HOME/wukong-vivado-build.lock"
flock -n 9 || { echo "Another vendor build holds the lock"; exit 1; }
python3 verify.py
test ! -e synthesis.log
timeout 120m vivado -mode batch -nolog -nojournal -source synth.tcl 2>&1 | tee synthesis.log
grep -qx COMBINED_SYNTH_EXPORT_COMPLETE synthesis.log
sha256sum synthesized.dcp > synthesis.sha256
python3 verify.py
timeout 240m vivado -mode batch -nolog -nojournal -source route.tcl 2>&1 | tee implementation.log
test -s build-receipt.json
python3 verify.py
echo AMOEBA_RETRY_BITSTREAM_BUILD_PASS
""")
    (out / "README.txt").write_text(
        "Build only; no device access or live publication.\n"
        "Source Vivado 2026.1 settings64.sh, then bash run.sh.\n"
        "Exact frozen UART RTL; only selected image and its hash gate differ.\n"
        "Amaranth whole-workload evidence is included; this is not vendor-mapped replay.\n"
        "Success requires AMOEBA_RETRY_BITSTREAM_BUILD_PASS and exit 0.\n"
        "Preserve build-receipt.json, timing.txt, precise-slack.txt, logs and BIT.\n"
        "A resulting BIT is quarantined pending review; do not program it.\n")
    files = {str(p.relative_to(out)):sha(p) for p in sorted(out.rglob("*"))
             if p.is_file() and "__pycache__" not in p.parts}
    (out / "manifest.json").write_text(json.dumps(dict(
        schema="church.amoeba-retry-build/v1", imageSha256=NEW,
        baselineInputsSha256=sha(frozen / "inputs.sha256"),
        sourceDeltas=deltas, physicalBoardTested=False,
        releaseApproved=False, files=files), indent=2))
    subprocess.run([sys.executable, str(out / "verify.py")], cwd=out, check=True)
    subprocess.run(["sha256sum", "-c", "inputs.sha256"], cwd=frozen, check=True,
                   stdout=subprocess.DEVNULL)
    with zipfile.ZipFile(out.with_suffix(".zip"), "x", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out.rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts:
                z.write(p, str(Path(out.name) / p.relative_to(out)))
    print("BUILD_PACKAGE_READY", out.with_suffix(".zip"), sha(out.with_suffix(".zip")))

if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve())
