"""Simulator regression test: stepping into a compiled lump.

Exercises the JavaScript simulator via Node.js to verify two properties
added / required by Task #829's lump-resident guard in _execCall (line ~3078):

  Test 1 — PC = 0 after CALL on a resident lump
    After a CALL instruction dispatches to a slot whose compiled lump is
    present in memory (lumpIsResident=true), the simulator's PC must be set
    to 0, not pc+1.  This means the next step() will fetch the first code
    word of the loaded lump, not the instruction after the CALL site.

  Test 2 — Step-by-step execution inside the lump
    Calling step() twice on the two NV (never-execute) placeholder
    instructions placed at lump words 1 and 2 advances PC exactly:
      0 → 1 → 2
    This confirms the dispatcher did not jump atomically and that the
    simulator preserves instruction-level granularity inside the lump.

Harness: tests/gates/sim_lump_step.js
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_lump_step.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_lump_step():
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
            f"sim_lump_step.js exited with code {result.returncode}\n"
            + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
