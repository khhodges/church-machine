"""CI wrapper for the indirect c-list slot dataflow tests (Task #545).

The analysis function `_computeReferencedCListSlots()` determines which
c-list slots are live so that unreferenced capabilities can be safely zeroed.
Incorrect results either silently remove a live capability (safety bug) or
fail to remove a dead one (authority leak).

All assertions live in the JS harness
  tests/simulator/sim_indirect_clist_slots.js
which extracts the function live from simulator/app-memory.js and exits 0
when every case passes.  This Python wrapper runs it under pytest so it
integrates with the project CI pipeline.

Covered edge cases (8 tests):
  T1  Direct references via all four opcodes (LOAD/SAVE/ELOADCALL/XLOADLAMBDA)
  T2  Simple one-hop alias
  T3  Clobbered alias — NOT counted as indirect, clobberWarning emitted
  T4  Chained alias (two hops)
  T5  Source-order sensitivity (alias after use must not back-propagate)
  T6  Conditional alias — conservative forward pass (documented behaviour)
  T7  Clobber then re-alias — one warning; re-aliased access is indirect
  T8  Multiple aliases, one clobbered, one still active
"""

import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_indirect_clist_slots.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


@pytest.mark.skipif(not _node_available(), reason='Node.js not available')
def test_indirect_clist_slots_harness():
    """Run the JS harness and assert all indirect c-list slot checks pass."""
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
            'sim_indirect_clist_slots.js exited with code {}\n'.format(result.returncode)
            + '\n'.join(lines)
        )

    assert '[PASS]' in stdout, 'No [PASS] markers in harness output:\n' + stdout

    pass_count = stdout.count('[PASS]')
    assert pass_count >= 8, (
        'Expected at least 8 [PASS] markers, got {}:\n{}'.format(pass_count, stdout)
    )
