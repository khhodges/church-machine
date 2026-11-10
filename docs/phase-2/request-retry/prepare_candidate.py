"""Reconstruct ONLY an isolated local candidate from the verified parent export."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PARENT = ROOT / "generated-artifacts/uart-retry-build-only"
PARENT_MANIFEST = "17ffc39b0e1954fabb55e0e0c3dcc70be0464b7e81945e4124b63a5e9397c824"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_map(root):
    return {p.relative_to(root).as_posix(): sha(p) for p in sorted(root.rglob("*"))
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"}


def expected_sources():
    if sha(PARENT / "manifest.json") != PARENT_MANIFEST:
        raise ValueError("Wrong parent manifest")
    manifest = json.loads((PARENT / "manifest.json").read_text())
    for name, digest in manifest["files"].items():
        path = (PARENT / name).resolve()
        if not path.is_relative_to(PARENT.resolve()) or sha(path) != digest:
            raise ValueError(f"Parent input changed: {name}")
    patched = subprocess.run([
        "patch", "--silent", "--output=-",
        str(PARENT / "source-snapshot/hardware/wukong_top.py"),
        str(HERE / "top-integration.patch")
    ], capture_output=True, check=True).stdout
    expected = dict(manifest["sourceFiles"])
    expected["hardware/wukong_top.py"] = hashlib.sha256(patched).hexdigest()
    expected["hardware/request_diagnostic.py"] = sha(HERE / "diagnostic.py")
    expected["hardware/request_protocol.py"] = sha(HERE / "protocol.py")
    return expected, patched


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "generated-artifacts/request-retry-candidate")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    expected, patched = expected_sources()
    if not args.verify:
        if args.output.exists():
            raise ValueError("Preserve existing candidate; choose a fresh output")
        shutil.copytree(PARENT / "source-snapshot", args.output,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        (args.output / "hardware/wukong_top.py").write_bytes(patched)
        shutil.copyfile(HERE / "diagnostic.py", args.output / "hardware/request_diagnostic.py")
        shutil.copyfile(HERE / "protocol.py", args.output / "hardware/request_protocol.py")
    if source_map(args.output) != expected:
        raise ValueError("Candidate differs from verified parent plus retained delta")
    print("REQUEST_RETRY_LOCAL_SOURCES_VERIFIED",
          hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(",", ":")).encode()).hexdigest())


if __name__ == "__main__":
    main()
