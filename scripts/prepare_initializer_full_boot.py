"""Freeze a separate source-tree candidate, never replace production wiring."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin"
IMAGE_SHA = "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidate_module(base, candidate):
    import_line = "from .sparse_memory_init import SparseMemoryInitializer"
    if candidate.count(import_line) != 1:
        raise ValueError("Unexpected candidate import")
    return (base + "\n\n# Experimental source-tree overlay; not production wiring.\n"
            + candidate.replace(import_line, "")
            + "\nSparseMemoryInitializer = AddressedSparseMemoryInitializer\n")


def prepare(output):
    output = output.resolve()
    if digest(ROOT / IMAGE) != IMAGE_SHA:
        raise ValueError("Frozen image changed")
    output.mkdir(parents=True, exist_ok=False)
    snapshot = output / "source-snapshot"
    source_hashes = {}
    for directory in ("hardware", "shared"):
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and path.suffix in (".py", ".json") and "__pycache__" not in path.parts:
                relative = path.relative_to(ROOT)
                target = snapshot / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
                source_hashes[str(relative)] = digest(path)
    target = snapshot / IMAGE
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / IMAGE, target)
    # boot_rom validates its factory import context even when the explicit
    # runtime image supersedes that factory image. Freeze those read-only
    # inputs too; never fabricate a Namespace or bypass admission.
    sys.path.insert(0, str(ROOT))
    from hardware.boot_rom import _lumps_dir
    context = snapshot / "server/lumps"
    context.mkdir(parents=True, exist_ok=False)
    state = json.loads((_lumps_dir / "ns-state.json").read_text())
    names = {"ns-state.json", "approvals.json"}
    for row in state.get("abstractions", []):
        if row.get("name") in ("SelfTest", "CapabilityTest"):
            filename = row.get("filename")
            if not isinstance(filename, str) or Path(filename).name != filename:
                raise ValueError("Invalid factory-context filename")
            names.add(filename)
    context_hashes = {}
    for name in sorted(names):
        shutil.copyfile(_lumps_dir / name, context / name)
        context_hashes[name] = digest(context / name)
    (output / "factory-context.json").write_text(json.dumps({
        "purpose": "Unchanged import-time validation inputs; NOT runtime image selection",
        "files": context_hashes,
    }, indent=2) + "\n")
    base = snapshot / "hardware/sparse_memory_init.py"
    candidate = snapshot / "hardware/sparse_memory_init_candidate.py"
    base.write_text(candidate_module(base.read_text(), candidate.read_text()))
    (output / "source-overlay.json").write_text(json.dumps({
        "originalSourcesSha256": source_hashes,
        "onlyReplacedModule": "hardware/sparse_memory_init.py",
        "replacementSha256": digest(base),
        "candidateSourceSha256": digest(candidate),
        "imageSha256": IMAGE_SHA,
    }, indent=2) + "\n")
    # Keep the active interpreter's package paths (including workspace-installed
    # Amaranth) while preferring the isolated hardware/shared source packages.
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(
        [str(snapshot), str(ROOT), *[p for p in sys.path if p]]))
    env["CHURCH_LUMPS_DIR"] = str(context)
    command = (
        "from hardware.boot_rom import _lumps_dir;"
        f"assert str(_lumps_dir)=={str(context)!r}, 'Unexpected factory context';"
        "from hardware.gen_rtlil import generate_rtlil_wukong;"
        "from hardware.guarded_build_profile import NAME_25;"
        f"generate_rtlil_wukong({str(output / 'rtl')!r},profile=NAME_25)"
    )
    with (output / "generation.log").open("w") as log:
        subprocess.run([sys.executable, "-u", "-c", command], cwd=snapshot,
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1200)
    for relative, original in source_hashes.items():
        if digest(ROOT / relative) != original:
            raise ValueError(f"Source changed during export: {relative}")
    if digest(ROOT / IMAGE) != IMAGE_SHA:
        raise ValueError("Image changed during export")
    shutil.copyfile(ROOT / "scripts/prepare_initializer_full_boot_observer.py", output / "observer.py")
    shutil.copyfile(ROOT / "hardware/wukong_xc7a100t.xdc", output / "board.xdc")
    (output / "synth.tcl").write_text("""set_param general.maxThreads 2
create_project initializer_boot work -part xc7a100tfgg676-2
add_files -norecurse rtl/church_wukong_xc7a100t.v
add_files -fileset constrs_1 -norecurse board.xdc
set_property top church_wukong_xc7a100t [current_fileset]
update_compile_order -fileset sources_1
launch_runs synth_1 -jobs 2
wait_on_run synth_1
if {[get_property PROGRESS [get_runs synth_1]] ne "100%"} {
 error "Synthesis did not complete"
}
open_run synth_1
report_utilization -file utilization.txt
write_checkpoint synthesized.dcp
write_verilog -mode funcsim mapped.v
puts "FULL_SYNTH_EXPORT_COMPLETE"
""")
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
sha256sum -c inputs.sha256
test ! -e work && test ! -e simulation-work
timeout 120m vivado -mode batch -nolog -nojournal -source synth.tcl 2>&1 | tee synthesis.log
grep -qx FULL_SYNTH_EXPORT_COMPLETE synthesis.log
python3 observer.py mapped.v mapped-boot-tb.v
sha256sum mapped.v mapped-boot-tb.v synthesized.dcp > synthesized-inputs.sha256
mkdir simulation-work
cd simulation-work
timeout 30m xvlog ../mapped.v ../mapped-boot-tb.v "$XILINX_VIVADO/data/verilog/src/glbl.v"
timeout 45m xelab -L unisims_ver -L secureip full_boot_tb glbl -s full_boot_probe
timeout 120m xsim full_boot_probe -runall 2>&1 | tee simulation.txt
grep -q '^FULL_SYNTH_BOOT_PASS: entry=00003504 ' simulation.txt
cd ..
sha256sum -c inputs.sha256
sha256sum -c synthesized-inputs.sha256
echo 'FULL_DESIGN_BOOT_COMPARISON_PASS'
echo 'Not routing/timing, full-program/Mallory, programming or runtime-upload approval.'
""")
    (output / "README.txt").write_text(
        "EXPERIMENTAL full-design 25MHz initializer correction.\n"
        "Source snapshot changes only the initializer implementation; saved image is unchanged.\n"
        "Source Vivado settings64.sh, then bash run.sh from a fresh extraction.\n"
        "Bounded synthesis and UNISIM boot-entry test only. No routing or bitstream commands.\n"
        "No FPGA, bridge, serial or network access. UART RX is idle.\n"
        "Observer requires all 32 live NIA register outputs; missing mappings fail closed.\n"
        "PASS requires boot completion without fault at ActorManager entry 0x3504.\n"
        "It stops at boot entry, before the full program or expected Mallory denial.\n")
    (output / "manifest.json").write_text(json.dumps({
        "schema": "church.experimental-initializer-full-boot/v1",
        "imageSha256": IMAGE_SHA, "imageBytes": 65536,
        "clockHz": 25000000, "entry": "00003504",
        "vendorTestStatus": "pending", "physicalTestStatus": "pending",
        "productionInitializerChanged": False,
        "generatedProfile": json.loads((output / "rtl/guarded-profile.json").read_text()),
    }, indent=2) + "\n")
    # Python's import caches are not part of the retained source.
    for cache in snapshot.rglob("__pycache__"):
        shutil.rmtree(cache)
    files = sorted(p for p in output.rglob("*") if p.is_file())
    (output / "inputs.sha256").write_text("".join(
        f"{digest(p)}  {p.relative_to(output)}\n" for p in files))
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.rglob("*")):
            if path.is_file():
                z.write(path, str(Path(output.name) / path.relative_to(output)))
    print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size,
                      "sha256": digest(archive)}, indent=2))


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
