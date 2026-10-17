"""Read-only baseline probe. Prints JSON; never imports project Python services."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory():
    paths = list((ROOT / "server/lumps").rglob("*"))
    paths += list((ROOT / "build").glob("church_wukong_xc7a100t.*"))
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(paths) if p.is_file()}


before = inventory()
manifest = json.loads((ROOT / "server/lumps/manifest.json").read_text())
ns = json.loads((ROOT / "server/lumps/ns-state.json").read_text())
bindings = []
for row in ns.get("abstractions", []):
    if not row.get("filename") or not row.get("binary_hash"):
        continue
    filename, expected = row["filename"], row["binary_hash"]
    active = [r for r in manifest if r.get("filename") == filename
              and r.get("archived") is not True and r.get("binary_hash", expected) == expected]
    path = ROOT / "server/lumps" / filename
    bindings.append({"name": row.get("name"), "slot": row.get("slot"),
                     "filename": filename, "active_matches": len(active),
                     "selected_hash_matches": path.is_file() and digest(path) == expected})
provenance = json.loads((ROOT / "build/church_wukong_xc7a100t.provenance.json").read_text())
inputs = provenance["input_files_sha256"]
changed = [p for p, h in inputs.items() if not (ROOT / p).is_file() or digest(ROOT / p) != h]
probe = r"""
const Compiler = require('./simulator/cloomc_compiler.js');
const Assembler = require('./simulator/assembler.js');
const out = [];
for (const inject of [false, true]) {
  global.ChurchAssembler = inject ? Assembler : undefined;
  try {
    const result = new Compiler().compile('abstraction Audit { method Run() { RETURN } }', []);
    out.push({injectAssembler:inject, threw:false, errorCount:(result.errors||[]).length});
  } catch(e) {out.push({injectAssembler:inject, threw:true, error:e.name+': '+e.message});}
}
console.log(JSON.stringify(out));
"""
result = subprocess.run(["node", "-e", probe], cwd=ROOT, text=True, capture_output=True)
after = inventory()
report = {
    "date": "2026-10-17",
    "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "scope": "Read-only selected inputs and in-memory compiler probe; not full test, board or bitstream qualification.",
    "saved_and_build_inputs_sha256": before,
    "concurrent_changes_during_probe": sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p)),
    "namespace_bindings": bindings,
    "provenance_input_count": len(inputs), "changed_provenance_inputs": changed,
    "compiler_probe": {"exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr},
    "audit_sources_sha256": {
        p: digest(ROOT / p) for p in [
            "simulator/cloomc_compiler.js", "simulator/assembler.js",
            "simulator/assembler_test.js", "simulator/test_abs_saved_api.js",
            "server/boot_image.py", "tests/boot/test_boot_image_matches_simulator.py",
            "tests/lump/test_lump_consistency.py",
            "hardware/test_boot_rom_no_false_halt.py",
            "tests/hardware/test_wukong_boot_rom_guard.py",
            "scripts/check_selftest_lump_stale.js",
            "docs/phase-1/01-isa/instruction-set.md",
        ]
    },
}
print(json.dumps(report, indent=2))
