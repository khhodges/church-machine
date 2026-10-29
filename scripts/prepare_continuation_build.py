"""Package current corrected RTL and exact replay evidence without live changes."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.readiness import WUKONG_SOURCES, source_fingerprint
from scripts.verify_continuation_build import verify


def prepare():
    base = ROOT / "generated-artifacts/factory-continuation-bitstream"
    output = base / "factory-continuation-build"
    output.mkdir(exist_ok=False)
    inputs = {
        "church_wukong_xc7a100t.v": base / "rtl/church_wukong_xc7a100t.v",
        "guarded-profile.json": base / "rtl/guarded-profile.json",
        "candidate-le.bin": ROOT / "generated-artifacts/data-access-validation/admitted.bin",
        "rtl-recovery-corrected.json": ROOT / "generated-artifacts/data-access-validation/rtl-recovery-corrected.json",
        "wukong_xc7a100t.xdc": ROOT / "hardware/wukong_xc7a100t.xdc",
        "build.tcl": ROOT / "hardware/guarded_candidate_build.tcl",
        "guarded_25mhz_clock_checks.tcl": ROOT / "hardware/guarded_25mhz_clock_checks.tcl",
        "verify.py": ROOT / "scripts/verify_continuation_build.py",
    }
    for name, source in inputs.items():
        shutil.copyfile(source, output / name)
    generated = json.loads((output / "guarded-profile.json").read_text())
    profile = {k: v for k, v in generated.items()
               if k not in ("schema", "synthesized", "generatedFilesSha256")}
    (output / "profile.json").write_text(json.dumps(profile, indent=2))
    for name in WUKONG_SOURCES:
        source = ROOT / name
        dest = output / "sources" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
    manifest = dict(schema="church.continuation-build/v1",
                    sourceFingerprint=source_fingerprint(WUKONG_SOURCES),
                    physicalBoardTested=False, releaseApproved=False,
                    simulationEvidence="Amaranth full-top; not a generated-Verilog or vendor simulation",
                    files={str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in sorted(output.rglob("*")) if p.is_file()})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    verify(output)
    archive = base / "factory-continuation-build.tar.gz"
    with tarfile.open(archive, "x:gz") as tar:
        tar.add(output, arcname=output.name)
    print(json.dumps(dict(archive=str(archive.relative_to(ROOT)),
                         sha256=hashlib.sha256(archive.read_bytes()).hexdigest()), indent=2))


if __name__ == "__main__":
    prepare()
