"""Simulator-level tests for M-window writeback on CALL/RETURN (GAP-03 fix).

Exercises the JavaScript simulator directly via Node.js to verify:
  1. Pass   — valid DR11/DR14/gt_seq causes CR15 words to be updated, M cleared.
  2. NULL   — DR11 bits[24:23]=0b00 faults INVALID_OP, M cleared.
  3. Integrity — corrupted DR14 faults INVALID_OP, M cleared.
  4. Bypass — CR15.m=0, gate skipped entirely, no fault, no writeback.
  5. integrity32 spot-checks against hardware/integrity32.py vectors, including
     the G-bit (bit 28) masking rule.
"""

import os
import subprocess

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HARNESS = os.path.join(ROOT, "tests", "sim_mwin_writeback.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


import pytest

@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_mwin_writeback_harness():
    """Run the JS harness; fail if it exits non-zero or writes to stderr."""
    result = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=30,
    )
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    if result.returncode != 0 or stderr:
        lines = []
        if stdout:
            lines.append("stdout:\n" + stdout)
        if stderr:
            lines.append("stderr:\n" + stderr)
        pytest.fail(
            f"sim_mwin_writeback.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
    pass_count = stdout.count("[PASS]")
    assert pass_count >= 7, f"Expected at least 7 PASS markers, got {pass_count}:\n{stdout}"
