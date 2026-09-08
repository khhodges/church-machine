"""Regression tests for MVN pseudo-instruction expansion (Task #1033).

Verifies that ChurchAssembler expands MVN correctly in both assembler copies:
  - simulator/assembler.js   (IDE / web path)
  - church_sim/assembler.js  (hardware-sim path)

Same-register case (MVN DRx, DRx):
  Expands to 4 instructions via a scratch register, so the source register
  value is read before any write occurs.

Different-register case (MVN DRd, DRs, DRd != DRs):
  Expands to the standard 3-instruction sequence.

Conditional forms:
  Preserve the requested condition on every instruction in either expansion,
  and produce identical words in both assembler copies.

All assertions live in the JS harness (tests/simulator/sim_mvn_expansion.js).
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_mvn_expansion.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason='Node.js not available')
def test_mvn_expansion_harness():
    """Run the MVN expansion JS harness and assert all checks pass."""
    result = subprocess.run(
        ['node', HARNESS],
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
            lines.append('stdout:\n' + stdout)
        if stderr:
            lines.append('stderr:\n' + stderr)
        pytest.fail(
            f'sim_mvn_expansion.js exited with code {result.returncode}\n'
            + '\n'.join(lines)
        )

    assert '[PASS]' in stdout, f'No [PASS] markers in harness output:\n{stdout}'

    pass_count = stdout.count('[PASS]')
    assert pass_count == 18, (
        f'Expected 18 [PASS] markers (6 cases × 2 assemblers + 6 parity checks), '
        f'got {pass_count}:\n{stdout}'
    )
