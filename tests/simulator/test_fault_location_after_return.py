"""Simulator regression test for Task #653 — fault location after RETURN.

Exercises the JavaScript simulator via Node.js to verify that, after a RETURN
instruction crosses a lump boundary back to the caller's (boot-entry) lump, any
subsequent fault inside the boot-entry lump is correctly attributed to that lump
— not to the lump (SlideRule, NS slot 16) that was executing before the RETURN.

The test uses the raw crSnapshot[14] path (crSnapshot[14].word0 & 0xFFFF for
the NS index, crSnapshot[14].word1 for the lump base) because that is exactly
the path app-run.js uses to populate _nsSnapshot.label and _nsSnapshot.offset
in the fault log.

Without the crSnapshot[14] writeback at RETURN time being correct, the fault
location could incorrectly name SlideRule (NS[16]) even though the RETURN has
already restored the boot-entry lump's CR14 — the analogue of the "Boot.NS +NNN"
regression fixed for CALL in Task #649.
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "simulator",
                       "sim_fault_location_after_return.js")


def _node_available():
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason="Node.js not available")
def test_fault_location_after_return():
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
            f"sim_fault_location_after_return.js exited with code "
            f"{result.returncode}\n" + "\n".join(lines)
        )

    assert "[PASS]" in stdout, f"No PASS markers in output:\n{stdout}"
