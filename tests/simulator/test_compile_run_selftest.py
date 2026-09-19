"""Post-Flash Self-Test Compile+Run regression test (Task #2028).

Distinct from tests/simulator/test_selftest_lump_runs.py, which loads a
pre-built .lump binary via ChurchSimulator.loadLumpBinary() (the real
boot-lump-install path). This test instead replicates the IDE's
Compile+Run button flow verbatim (simulator/app-run.js's assembleAndLoad() /
_applyPendingSimLoad() / _injectClistNow()): compile the .cloomc source
directly, assemble it, load it, and run it — with no pre-built lump involved.

Before the Task #2028 fix, Compile+Run's trailing RETURN hit a completely
empty call stack (loadProgram() resets callStack=[], and Compile+Run never
runs the real boot sequence's NUC_CLIST step that pushes a sentinel CALL
frame), producing a "stack is empty (no sentinel pushed)" fault — a
different, boot-install-incompatible code path from the one a real
boot-lump install takes. The fix pushes an equivalent sentinel frame in
_applyPendingSimLoad() so Compile+Run's termination exactly matches real-boot
semantics: the trailing RETURN unwinds through the sentinel frame
("RETURN through sentinel frame"), the same normal top-level-return
termination that tests/simulator/test_selftest_lump_runs.py already treats
as a passing, expected outcome (not a crash) for the boot-lump-install path.
"""

import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_compile_run_selftest.js')


def _node_available():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _run(force_failure=None):
    env = os.environ.copy()
    if force_failure is not None:
        env['SELFTEST_FORCE_FAILURE'] = str(force_failure)
    proc = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        timeout=60,
        cwd=ROOT,
        env=env,
    )
    raw = proc.stdout.decode('utf-8', errors='replace').strip()
    stderr = proc.stderr.decode('utf-8', errors='replace').strip()
    try:
        report = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'sim_compile_run_selftest.js produced non-JSON output: {e}\n'
            f'stdout:\n{raw}\n'
            f'stderr:\n{stderr}'
        )
    return report, proc.returncode, stderr


def test_compile_run_selftest_compiles_and_boots():
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    assert report.get('bootComplete') is True, (
        f'Simulator boot did not complete before Compile+Run. Report: {report}'
    )
    assert report.get('compiled') is True, (
        f'post_flash_selftest.cloomc failed to compile via CLOOMCCompiler. Report: {report}'
    )


def test_compile_run_selftest_terminates_via_sentinel_return():
    """Trailing RETURN must unwind through the Compile+Run sentinel frame,
    not fault on a genuinely empty call stack (the pre-Task-#2028 bug)."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    terminated_by = report.get('terminatedBy')
    assert terminated_by == 'RETURN_THROUGH_SENTINEL', (
        f'Compile+Run did not terminate via the sentinel-frame RETURN — got '
        f'terminatedBy={terminated_by!r}. faultMessage={report.get("faultMessage")!r}. '
        f'failMessage: {report.get("failMessage")}'
    )


def test_compile_run_selftest_status_is_dr1_and_dr0_remains_hardwired_zero():
    """Success is explicit in DR1 while writes cannot change hardwired DR0."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run()

    assert report.get('dr1') == 0 and report.get('dr0') == 0, (
        f'Compile+Run selftest FAILED: {report.get("failMessage")}. '
        f'DR1={report.get("dr1")} is status; DR0={report.get("dr0")} must remain zero. '
        f'terminatedBy={report.get("terminatedBy")!r}. steps={report.get("steps")}.'
    )


@pytest.mark.parametrize('test_number', [1, 42, 63, 81])
def test_compile_run_selftest_forced_failures_are_not_masked(test_number):
    """Representative early, middle, TPERM-63, and late failures report in DR1."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stderr = _run(test_number)
    assert report.get('terminatedBy') == 'RETURN_THROUGH_SENTINEL', report
    assert report.get('dr1') == test_number, report
    assert report.get('dr0') == 0, report
    assert report.get('pass') is True, report


if __name__ == '__main__':
    if not _node_available():
        print('SKIP: Node.js not available')
        sys.exit(0)
    try:
        report, returncode, stderr = _run()
        if report.get('pass'):
            print(f'PASS: Compile+Run selftest ran {report["steps"]} steps, DR1=0 and DR0 remained hardwired zero.')
            sys.exit(0)
        else:
            print(f'FAIL: {report.get("failMessage")}')
            print(f'  terminatedBy={report.get("terminatedBy")}')
            print(f'  steps={report.get("steps")}')
            print(f'  dr1={report.get("dr1")}, dr0={report.get("dr0")}')
            if stderr:
                print(f'stderr:\n{stderr}')
            sys.exit(1)
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(1)
