"""Complete qualified profile acceptance, without starting the web application."""
import json
from pathlib import Path
import subprocess
import sys


def test_complete_protected_qualified_namespace():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run([sys.executable, "scripts/run_protected_phase1.py"],
                            cwd=root, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
    directory = next(line for line in result.stdout.splitlines()
                     if line.startswith("generated-artifacts/phase1-linked-"))
    report = json.loads((root / directory / "protected-report.json").read_text())
    assert report["protectedFilesUnchanged"]
    assert report["negativeAndBoundaryTestsPassed"]
    assert report["full17EntryBehaviorCoverage"] and report["unexpectedFaults"] == 0
    assert report["normalOperationalEntries"] == 16 and report["expectedRejectionEntries"] == [17]
    assert len(report["coverage"]) == 17
    assert not report["installed"] and not report["hardwareTouched"]
