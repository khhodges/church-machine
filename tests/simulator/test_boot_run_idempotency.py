"""Boot-to-run transition idempotency regression tests.

Verifies that the boot-to-run transition cannot accidentally restart a running
simulation.  Covers three scenarios:

1. runSimGo() is a no-op while sim.running=true (mid-batch guard).
2. runSimGo() is a no-op while _simRunActive=true (between-batch guard).
3. instantBoot() is idempotent when bootComplete is already true.

The JS harness (sim_boot_run_idempotency.js) loads app-run.js into a vm+jsdom
context with a real booted ChurchSimulator injected as `sim`, then calls the
REAL runSimGo() and instantBoot() functions via vm snippets.  Source-code
audits verify all flag set/clear sites in the production source.
"""

import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'simulator', 'sim_boot_run_idempotency.js')


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
    raw    = proc.stdout.decode('utf-8', errors='replace').strip()
    stderr = proc.stderr.decode('utf-8', errors='replace').strip()
    # The harness prints PASS/FAIL lines then a JSON summary on the last line.
    lines = raw.splitlines()
    json_line = next(
        (l for l in reversed(lines) if l.startswith('{')),
        None,
    )
    if json_line is None:
        raise RuntimeError(
            f'sim_boot_run_idempotency.js produced no JSON summary.\n'
            f'stdout:\n{raw}\n'
            f'stderr:\n{stderr}'
        )
    try:
        report = json.loads(json_line)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'sim_boot_run_idempotency.js JSON parse error: {e}\n'
            f'line: {json_line!r}\nstdout:\n{raw}'
        )
    return report, proc.returncode, raw, stderr


# ── Tests ─────────────────────────────────────────────────────────────────

def test_boot_run_idempotency_all_pass():
    """All 14 idempotency checks pass (behavioral + source audit)."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stdout, stderr = _run()

    assert report.get('pass') is True, (
        f'sim_boot_run_idempotency: {report.get("failures")} / {report.get("total")} '
        f'check(s) FAILED.\n'
        f'stdout:\n{stdout}\n'
        f'stderr:\n{stderr}'
    )
    assert returncode == 0, (
        f'sim_boot_run_idempotency.js exited with code {returncode}.\n'
        f'stdout:\n{stdout}'
    )


def test_runsimgo_blocked_by_sim_running():
    """runSimGo() must not invoke runSim() when sim.running=true."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stdout, stderr = _run()

    # The harness exits non-zero if any check fails, so this is a targeted
    # confirmation: if the overall suite passed, T1 and T2 passed.
    assert report.get('pass') is True, (
        f'runSimGo() mid-batch guard check failed — see stdout:\n{stdout}'
    )


def test_runsimgo_blocked_by_simrunactive():
    """runSimGo() must not invoke runSim() when _simRunActive=true."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stdout, stderr = _run()

    assert report.get('pass') is True, (
        f'runSimGo() between-batch guard check failed — see stdout:\n{stdout}'
    )


def test_instantboot_idempotent_on_booted_sim():
    """instantBoot() on an already-booted sim returns true with zero side effects."""
    if not _node_available():
        pytest.skip('Node.js not available')

    report, returncode, stdout, stderr = _run()

    assert report.get('pass') is True, (
        f'instantBoot() idempotency check failed — see stdout:\n{stdout}'
    )


if __name__ == '__main__':
    if not _node_available():
        print('SKIP: Node.js not available')
        sys.exit(0)
    try:
        report, returncode, stdout, stderr = _run()
        if report.get('pass'):
            total = report.get('total', '?')
            print(f'PASS: all {total} boot-run idempotency checks passed.')
            sys.exit(0)
        else:
            print(f'FAIL: {report.get("failures")} / {report.get("total")} check(s) failed.')
            print(stdout)
            if stderr:
                print(f'stderr:\n{stderr}')
            sys.exit(1)
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(1)
