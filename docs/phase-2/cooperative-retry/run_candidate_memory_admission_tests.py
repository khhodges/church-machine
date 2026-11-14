"""Run the isolated first-stage suite without replacing inherited package paths."""
from pathlib import Path
import sys

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

if __name__ == "__main__":
    # fixed_watchdog is a standalone import in the historical lifecycle tests.
    # Keep inherited site-packages: replacing PYTHONPATH can hide installed pytest.
    sys.path[:0] = [str(HERE), str(ROOT / "hardware")]
    tests = [
        "test_candidate_memory.py",
        "test_candidate_admission.py",
        "test_starter_lifecycle.py",
        "test_starter_sha256.py",
    ]
    raise SystemExit(pytest.main([str(HERE / name) for name in tests] + sys.argv[1:]))
