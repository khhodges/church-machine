"""Script-only isolated RTL acceptance suite; never runs vendor/board tools."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from prepare_starter import HERE, prepare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True,
                        help="Fresh generated-artifacts child; existing paths are refused")
    args = parser.parse_args()
    output = prepare(args.output)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(output) + os.pathsep + env.get("PYTHONPATH", "")
    tests = ["test_starter_derivation.py", "test_starter_sha256.py", "test_starter_lifecycle.py"]
    quick = subprocess.run(
        [sys.executable, "-m", "pytest", *(str(HERE / name) for name in tests),
         "-q", f"--junitxml={output / 'starter-units.xml'}"],
        cwd=output, env=env, check=False).returncode
    if quick:
        return quick
    # Each process has private simulator RAM and monkeypatch state. Long wire
    # transfers are CPU-heavy; concurrent cases avoid a two-hour serial suite.
    groups = ("same_top", "non_yielding", "received_image_rejection", "partial")
    def run(group):
        return subprocess.run(
            [sys.executable, "-m", "pytest", str(HERE / "test_starter_top.py"),
             "-q", "-k", group, f"--junitxml={output / ('starter-' + group + '.xml')}"],
            cwd=output, env=env, check=False).returncode
    with ThreadPoolExecutor(max_workers=4) as pool:
        return int(any(list(pool.map(run, groups))))


if __name__ == "__main__":
    raise SystemExit(main())
