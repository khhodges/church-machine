"""Post-Flash Self-Test lump load-and-run test (Task #1285).

Verifies that d906a27f.lump can be loaded into a fresh simulator boot image
via ChurchSimulator.loadLumpBinary() and that the 81-test selftest suite runs
to completion with DR0 === 0 (all tests passed).

The selftest (simulator/examples/post_flash_selftest.cloomc) covers:
  SECTION A  Tests  1-15  Data register independence
  SECTION B  Tests 16-23  IADD arithmetic
  SECTION C  Tests 24-30  ISUB arithmetic
  SECTION D  Tests 31-36  SHL shift-left
  SECTION E  Tests 37-41  SHR logical right
  SECTION F  Tests 42-45  SHR arithmetic right
  SECTION G  Tests 46-57  Branch conditions
  SECTION H  Tests 58-62  BFEXT / BFINS bit-field operations
  SECTION I  Tests 63-73  TPERM presets + domain purity
  SECTION J  Tests 74-77  TPERM EXACT credential-pinning
  SECTION K  Tests 78-79  CHANGE (CR swap) + permission verify
  SECTION L  Tests 80-81  LOAD from multiple c-list slots

Result convention:
  DR0 = 0  — all 81 tests passed
  DR0 = N  — test N was the first to fail (fail-fast)
"""

import json
import os
import subprocess
import sys

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_selftest_lump_runs.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _run():
    proc = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        timeout=60,
        cwd=ROOT,
    )
    raw = proc.stdout.decode('utf-8', errors='replace').strip()
    stderr = proc.stderr.decode('utf-8', errors='replace').strip()
    try:
        report = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'sim_selftest_lump_runs.js produced non-JSON output: {e}\n'
            f'stdout:\n{raw}\n'
            f'stderr:\n{stderr}'
        )
    return report, proc.returncode, stderr


def test_selftest_lump_loads_and_boots():
    """Boot image initialises correctly before loading the selftest lump."""
    if not _node_available():
        import pytest
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    assert report.get('bootComplete') is True, (
        'Simulator boot did not complete before loading the selftest lump. '
        f'Report: {report}'
    )
    assert report.get('loaded') is True, (
        'loadLumpBinary() returned false — lump could not be installed in NS slot 3. '
        f'failMessage: {report.get("failMessage")}'
    )


def test_selftest_lump_runs_to_completion():
    """Selftest terminates via RETURN (not halt or fault), indicating normal exit."""
    if not _node_available():
        import pytest
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    terminated_by = report.get('terminatedBy')
    assert terminated_by == 'RETURN', (
        f'Selftest did not terminate via RETURN — got terminatedBy={terminated_by!r}. '
        f'failMessage: {report.get("failMessage")}. '
        f'steps={report.get("steps")}. '
        f'First unexpected fault: '
        + (str(report.get("faultLog", [{}])[0]) if report.get("faultLog") else "none")
    )


def test_selftest_lump_dr0_is_zero():
    """DR0 === 0 after running the selftest lump: all 81 hardware tests passed.

    If this assertion fails, DR0 contains the number of the first failing test
    (the selftest uses a fail-fast strategy: IADD DR0, #N then RETURN).
    """
    if not _node_available():
        import pytest
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    dr0 = report.get('dr0')
    fail_msg = report.get('failMessage')
    fail_section = report.get('failSection')

    section_hint = f' ({fail_section})' if fail_section else ''

    assert dr0 == 0, (
        f'Selftest lump FAILED: {fail_msg}. '
        f'DR0={dr0} means test {dr0}{section_hint} was the first to fail. '
        f'terminatedBy={report.get("terminatedBy")!r}. '
        f'steps={report.get("steps")}.'
    )


if __name__ == '__main__':
    if not _node_available():
        print('SKIP: Node.js not available')
        sys.exit(0)
    try:
        report, returncode, stderr = _run()
        if report.get('pass'):
            print(f'PASS: selftest lump ran {report["steps"]} steps, DR0=0 (all 81 tests passed).')
            sys.exit(0)
        else:
            print(f'FAIL: {report.get("failMessage")}')
            print(f'  terminatedBy={report.get("terminatedBy")}')
            print(f'  steps={report.get("steps")}')
            print(f'  dr0={report.get("dr0")}')
            if stderr:
                print(f'stderr:\n{stderr}')
            sys.exit(1)
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(1)
