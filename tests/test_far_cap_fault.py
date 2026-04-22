"""Simulator-level tests for the Far-capability (F_BIT) fault path.

Exercises the JavaScript simulator via Node.js to verify:

  1. The LOAD_NUC boot step fires an F_BIT fault (type string 'F_BIT') when
     the boot-entry NS slot has its F-bit set (word1 bit 30).  The CRC seal
     is computed from (location, limit17) only, so flipping bit 30 leaves
     the seal intact and allows the explicit F-bit check to be reached.
     (Task #361)

  2. _FAULT_CODES['F_BIT'] in simulator/app.js resolves to 0x0F (not null),
     confirming that the hardware code is wired correctly end-to-end.
     (Task #361)

  3. The CALL instruction's runtime F_BIT check (simulator.js ~line 2372)
     fires when a fully-booted simulator executes CALL CR6 and the target
     NS entry has its F-bit set.  This covers the path that Task #361 did
     not exercise: mLoad succeeds but the post-mLoad F-bit check in
     _execCall halts with F_BIT.  (Task #362)

A regression in any of these paths would be caught here without requiring
a full IDE boot.
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HARNESS = os.path.join(ROOT, "tests", "sim_far_cap_fault.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_far_cap_fault_f_bit():
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
            f"sim_far_cap_fault.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
