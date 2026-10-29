"""Freeze the two approved experimental corrections; no live writes or BIT build."""
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_initializer_full_boot import candidate_module
from scripts.verify_continuation_build import verify, IMAGE


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(output, *, uart_packet_atomic=False):
    frozen = ROOT / "generated-artifacts/factory-continuation-bitstream/factory-continuation-build"
    original = verify(frozen)
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    snapshot = output / "source-snapshot"
    # Supplementary imports and shared contracts are explicitly recorded, not
    # misrepresented as members of the earlier frozen archive.
    supplements = {}
    for directory in ("hardware", "shared"):
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and path.suffix in (".py", ".json") and "__pycache__" not in path.parts:
                rel = path.relative_to(ROOT)
                dest = snapshot / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)
                supplements[str(rel)] = sha(path)
    for rel, digest in original["files"].items():
        if rel.startswith("sources/"):
            name = Path(rel).relative_to("sources")
            target = snapshot / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(frozen / rel, target)
            supplements.pop(str(name), None)
    # Explicit image supersedes factory context, but imports still validate it.
    from hardware.boot_rom import _lumps_dir
    context = snapshot / "server/lumps"
    context.mkdir(parents=True)
    # boot_rom imports approval verification even for explicit-image models.
    # Include the real helper and its deferred validator, never approval stubs.
    for name in ("__init__.py", "lump_approvals.py", "idx1_profile.py"):
        source = ROOT / "server" / name
        shutil.copyfile(source, snapshot / "server" / name)
        supplements[f"server/{name}"] = sha(source)
    state = json.loads((_lumps_dir / "ns-state.json").read_text())
    names = {"ns-state.json", "approvals.json"}
    for row in state.get("abstractions", []):
        if row.get("name") in ("SelfTest", "CapabilityTest"):
            name = row.get("filename")
            if not isinstance(name, str) or Path(name).name != name:
                raise ValueError("Unsafe import-context filename")
            names.add(name)
    for name in sorted(names):
        shutil.copyfile(_lumps_dir / name, context / name)
    image = snapshot / "generated-artifacts/data-access-validation/admitted.bin"
    image.parent.mkdir(parents=True)
    shutil.copyfile(frozen / "candidate-le.bin", image)
    words = struct.unpack("<16384I", image.read_bytes())
    # Image-bound startup authority, distinct from CapabilityTest's recovery PC.
    if words[256 + 242] & 65535 != 21 or (words[84] + words[words[84] + 1]) * 4 != 0x4610:
        raise ValueError("Unexpected frozen startup entry")
    pairs = [(i, w) for i, w in enumerate(words) if w]
    (output / "pairs.hex").write_text("".join(f"{a:04x}{w:08x}\n" for a, w in pairs))
    base = snapshot / "hardware/sparse_memory_init.py"
    candidate = snapshot / "hardware/sparse_memory_init_candidate.py"
    base.write_text(candidate_module(base.read_text(), candidate.read_text()) + """

# Diagnostic-only preservation of existing output signals, no new ports,
# memory preload, authority changes or clock/reset changes.
class ObservedInitializer(SparseMemoryInitializer):
    def __init__(self, pairs):
        super().__init__(pairs)
        for signal in (self.write_en, self.write_addr, self.write_data, self.done):
            signal.attrs["keep"] = "true"
SparseMemoryInitializer = ObservedInitializer
""")
    differences = []
    for rel, digest in original["files"].items():
        if rel.startswith("sources/") and sha(snapshot / Path(rel).relative_to("sources")) != digest:
            differences.append(str(Path(rel).relative_to("sources")))
    if differences != ["hardware/sparse_memory_init.py"]:
        raise ValueError(f"Unexpected frozen-source delta: {differences}")
    # Optional isolated follow-on candidate. Never edit the earlier frozen
    # package or substitute its approved image.
    uart_sources = {}
    if uart_packet_atomic:
        for name in ("hardware/wukong_top.py", "hardware/uart_packet_arbiter.py"):
            src = ROOT / name
            shutil.copyfile(src, snapshot / name)
            uart_sources[name] = sha(snapshot / name)
        differences.append("hardware/wukong_top.py")
        supplements["hardware/uart_packet_arbiter.py"] = uart_sources["hardware/uart_packet_arbiter.py"]
    (output / "provenance.json").write_text(json.dumps({
        "imageSha256": IMAGE, "baselineManifestSha256": sha(frozen / "manifest.json"),
        "baselineSources": {k: v for k, v in original["files"].items() if k.startswith("sources/")},
        "sourceDelta": differences, "supplementalSources": supplements,
        "uartPacketAtomicSources": uart_sources,
        "candidateSourceSha256": sha(candidate),
        "overlaySha256": sha(base),
        "observationAttributes": "keep on initializer outputs only",
        "factoryContext": {name: sha(context / name) for name in names},
        "factoryContextAuthority": "import validation only, never runtime selection",
        "vendorStatus": "not run", "boardStatus": "not run",
    }, indent=2) + "\n")
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(
        [str(snapshot), *[p for p in sys.path if p]]), CHURCH_LUMPS_DIR=str(context))
    command = ("from hardware.gen_rtlil import generate_rtlil_wukong;"
               "from hardware.guarded_build_profile import CONTINUATION_NAME;"
               f"generate_rtlil_wukong({str(output / 'rtl')!r},profile=CONTINUATION_NAME)")
    with (output / "generation.log").open("w") as log:
        subprocess.run([sys.executable, "-u", "-c", command], cwd=snapshot, env=env,
                       stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1200)
    shutil.copyfile(ROOT / "scripts/combined_continuation_observer.py", output / "observer.py")
    shutil.copyfile(ROOT / "scripts/prepare_initializer_full_boot_observer.py", output / "boot_observer.py")
    shutil.copyfile(ROOT / "scripts/probe_factory_recovery_rtl.py", output / "recovery.py")
    shutil.copyfile(ROOT / "scripts/combined_continuation_model.py", output / "model.py")
    (output / "requirements-model.txt").write_text(
        f"amaranth=={version('amaranth')}\npytest=={version('pytest')}\n")
    shutil.copyfile(ROOT / "hardware/wukong_xc7a100t.xdc", output / "board.xdc")
    # Reuse the established synthesis-only flow, never implementation/bitgen.
    (output / "synth.tcl").write_text("""set_param general.maxThreads 2
create_project combined_validation work -part xc7a100tfgg676-2
add_files -norecurse rtl/church_wukong_xc7a100t.v
add_files -fileset constrs_1 -norecurse board.xdc
set_property top church_wukong_xc7a100t [current_fileset]
update_compile_order -fileset sources_1
launch_runs synth_1 -jobs 2
wait_on_run synth_1
if {[get_property PROGRESS [get_runs synth_1]] ne "100%"} {error "Synthesis incomplete"}
open_run synth_1
write_checkpoint synthesized.dcp
write_verilog -mode funcsim mapped.v
puts "COMBINED_SYNTH_EXPORT_COMPLETE"
""")
    (output / "run-vendor.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
exec 9>"$HOME/wukong-vivado-build.lock"
flock -n 9 || { echo "Another Wukong vendor build holds the lock." >&2; exit 1; }
sha256sum -c inputs.sha256
test ! -e work && test ! -e simulation-work
timeout 120m vivado -mode batch -nolog -nojournal -source synth.tcl 2>&1 | tee synthesis.log
grep -qx COMBINED_SYNTH_EXPORT_COMPLETE synthesis.log
python3 observer.py mapped.v mapped-boot-tb.v
sha256sum mapped.v mapped-boot-tb.v synthesized.dcp > synthesized-inputs.sha256
mkdir simulation-work
cp pairs.hex simulation-work/
cd simulation-work
timeout 30m xvlog ../mapped.v ../mapped-boot-tb.v "$XILINX_VIVADO/data/verilog/src/glbl.v"
timeout 45m xelab -L unisims_ver -L secureip full_boot_tb glbl -s combined_probe
timeout 120m xsim combined_probe -runall 2>&1 | tee simulation.txt
grep -q '^COMBINED_VENDOR_BOOT_PASS:' simulation.txt
cd ..
sha256sum -c inputs.sha256
sha256sum -c synthesized-inputs.sha256
echo COMBINED_VENDOR_VALIDATION_PASS
""")
    (output / "run-model.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sha256sum -c inputs.sha256
test ! -e model-results
export PYTHONPATH="$PWD/source-snapshot${PYTHONPATH:+:$PYTHONPATH}"
export CHURCH_LUMPS_DIR="$PWD/source-snapshot/server/lumps"
timeout 45m python3 model.py 2>&1 | tee model.log
grep -qx COMBINED_MODEL_RECOVERY_PASS model.log
sha256sum -c inputs.sha256
""")
    (output / "README.txt").write_text(
        "ISOLATED COMBINED VALIDATION — NO BIT GENERATION OR BOARD ACCESS\n"
        "Image: " + IMAGE + "\n" +
        ("Frozen hardware changes: initializer overlay plus UART packet ownership and buffered console TX.\n"
         if uart_packet_atomic else
         "Only frozen hardware logic change: tested initializer overlay.\n") +
        "Initializer output keep attributes preserve diagnostic observation.\n"
        "1. Source Vivado settings64.sh; bash run-vendor.sh in a fresh extraction.\n"
        "   Checks every initializer write, first/last, then boot entry 0x4610 at 25MHz.\n"
        "   Missing optimized observer signals fail closed; never substitute zeros.\n"
        "2. With Python/Amaranth available: bash run-model.sh.\n"
        "   Python model dependencies are pinned in requirements-model.txt.\n"
        "   Exact-image simulated UART fault/recovery, 100 post-recovery retirements.\n"
        "   This is model evidence, NOT vendor-synthesized continuation evidence.\n"
        "Run these separately and preserve both outputs. No combined PASS until both pass.\n"
        "No route_design, write_bitstream, serial, bridge, SSH or device commands.\n"
        "Prior passes are not new passes. Synthesis and physical validation remain pending.\n")
    for cache in snapshot.rglob("__pycache__"):
        shutil.rmtree(cache)
    verify(frozen)
    files = sorted(p for p in output.rglob("*") if p.is_file())
    (output / "inputs.sha256").write_text("".join(
        f"{sha(p)}  {p.relative_to(output)}\n" for p in files))
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.rglob("*")):
            if path.is_file():
                z.write(path, str(Path(output.name) / path.relative_to(output)))
    print(json.dumps({"archive": str(archive.relative_to(ROOT)), "sha256": sha(archive),
                      "bytes": archive.stat().st_size}, indent=2))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--uart-packet-atomic", action="store_true")
    args = parser.parse_args()
    prepare(args.output, uart_packet_atomic=args.uart_packet_atomic)
