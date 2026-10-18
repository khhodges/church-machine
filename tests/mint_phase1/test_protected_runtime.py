"""Discover the operational isolated Mint path without starting any services."""
from pathlib import Path
import subprocess


def test_protected_mint_path():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["node", "--test", "tests/mint_phase1/protected_runtime.test.js"],
        cwd=root, text=True, capture_output=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
