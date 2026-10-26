"""Prepare a fresh continuation directory on the droplet; never starts Vivado."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from initializer_route_verify import PINNED, sha


def prepare(source, bundle):
    source = source.resolve()
    expected = json.loads((bundle / "package.json").read_text())
    if sha(source / "inputs.sha256") != expected["sourceInputsSha256"]:
        raise ValueError("Not the approved full-design boot package")
    subprocess.run(["sha256sum", "-c", "inputs.sha256"], cwd=source,
                   check=True, stdout=subprocess.DEVNULL)
    for name, digest in PINNED.items():
        if sha(source / name) != digest:
            raise ValueError(f"Wrong tested file: {name}")
    log = (source / "simulation-work/simulation.txt").read_text()
    if "FULL_SYNTH_BOOT_PASS: entry=00003504 cycles=209644" not in log.splitlines():
        raise ValueError("Expected boot-test result is missing")
    for name, digest in expected["files"].items():
        if Path(name).name != name or sha(bundle / name) != digest:
            raise ValueError("Continuation package changed")
    target = Path(tempfile.mkdtemp(prefix="initializer-route-", dir=source.parent))
    for name in expected["files"]:
        shutil.copyfile(bundle / name, target / name)
    shutil.copyfile(source / "synthesized.dcp", target / "input.dcp")
    files = {p.name: sha(p) for p in target.iterdir() if p.is_file()}
    (target / "continuation.json").write_text(json.dumps({
        "sourceDirectory": str(source), "sourceInputsSha256": expected["sourceInputsSha256"],
        "files": files, "scope": "Experimental routing only; no hardware access",
    }, indent=2) + "\n")
    subprocess.run([sys.executable, str(target / "initializer_route_verify.py")], check=True)
    print("CONTINUATION PREPARED: " + str(target))
    print("No Vivado or hardware command started.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 prepare_initializer_route.py /path/to/verified/boot/package")
    prepare(Path(sys.argv[1]), Path(__file__).resolve().parent)
