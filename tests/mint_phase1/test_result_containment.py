"""Discover the isolated M3 JS probes; no runtime files or services are changed."""
from pathlib import Path
import subprocess


def test_result_containment_components():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["node", "--test", "tests/mint_phase1/result_containment_probe.js"],
        cwd=root, text=True, capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
