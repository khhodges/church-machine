"""Reproduce isolated combined qualification; never vendor tools or hardware."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
from prepare_combined import prepare
from prepare_starter import HERE
from check_combined_evidence import check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    output = prepare(parser.parse_args().output)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(output) + os.pathsep + env.get("PYTHONPATH", "")
    for script in ("test_revision_adoption.js", "test_combined_inputs.js"):
        subprocess.run(["node", str(HERE / script)], check=True)
    tests = [
        "test_combined_review.py", "test_combined_approval.py", "test_combined_compiler_rtl.py",
        "test_combined_receiver.py", "test_combined_application.py",
        "test_starter_sha256.py", "test_starter_lifecycle.py",
        "test_combined_top.py",
    ]
    result = subprocess.run(
        [sys.executable, "-m", "pytest", *(str(HERE / name) for name in tests),
         "-q", f"--junitxml={output / 'combined-tests.xml'}"],
        cwd=output, env=env, check=False).returncode
    if result == 0:
        check(output)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
