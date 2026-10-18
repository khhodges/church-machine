#!/usr/bin/env python3
"""Reproduce qualified linking, then sealed full-profile acceptance, offline."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.run_phase1_candidates import inventory


def run():
    before = inventory()
    try:
        result = subprocess.run(
            [sys.executable, "scripts/run_phase1_candidates.py", "--correct-runtime-source"],
            cwd=ROOT, capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        directory = next(line for line in result.stdout.splitlines()
                         if line.startswith("generated-artifacts/phase1-linked-"))
        linked = ROOT / directory
        result = subprocess.run(
            ["node", "scripts/replay_protected_phase1.js", str(linked)],
            cwd=ROOT, capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        print(result.stdout.strip())
        tests = subprocess.run(
            ["node", "--test", "tests/mint_phase1/qualified_runtime.test.js"],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
            env={**os.environ, "PHASE1_LINKED_DIR": str(linked)})
        if tests.returncode:
            raise RuntimeError(tests.stdout + tests.stderr)
        report = json.loads((linked / "protected-report.json").read_text())
        report["protectedFilesUnchanged"] = before == inventory()
        report["negativeAndBoundaryTestsPassed"] = True
        (linked / "protected-report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(directory)
        return directory
    finally:
        if before != inventory():
            raise RuntimeError("Protected live project inputs changed")


if __name__ == "__main__":
    run()
