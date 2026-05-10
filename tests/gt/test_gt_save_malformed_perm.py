"""Tests for defence-in-depth DOMAIN_PURITY fault when saving malformed GTs.

Task #957: Validate permission bits when saving GTs from a CR into a C-List
slot, not just when loading GTs from memory.

Verifies that a malformed GT word placed directly into a CR (bypassing
createGT(), as a boot-sequence bug or future vulnerability could do) triggers
a DOMAIN_PURITY fault when a SAVE instruction reads that CR and tries to
write the GT into a C-List slot.

Two malformed cases are tested:
  1. Mixed Turing+Church permissions (X+E) — caught by isDomainPure.
  2. Multi-Church permissions (L+E) — caught by isSinglePerm.

In both cases parseGT() sets 'malformed=true' on the decoded result and
_execSave() surfaces it as a DOMAIN_PURITY fault before the GT reaches
any C-List slot in memory, extending the defence chain that createGT()
begins at construction time and that _execLoad() enforces on the LOAD path.
"""
import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'gt', 'sim_gt_save_malformed.js')


def _run_harness():
    proc = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'sim_gt_save_malformed.js exited {proc.returncode}\n'
            f'stderr:\n{proc.stderr.decode("utf-8", errors="replace")}'
        )
    out = proc.stdout.decode('utf-8', errors='replace').strip()
    try:
        return {r['name']: r for r in json.loads(out)}
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'sim_gt_save_malformed.js produced non-JSON output: {e}\n'
            f'stdout:\n{out}'
        )


@pytest.fixture(scope='module')
def results():
    return _run_harness()


def test_xe_gt_in_cr_save_faults_domain_purity(results):
    """SAVE from a CR holding a mixed X+E GT must raise DOMAIN_PURITY.

    X is a Turing permission; E is a Church permission.  Mixing them in a
    single GT word violates domain purity and must be caught at SAVE time even
    when the GT was written directly into a CR rather than through createGT(),
    preventing the malformed GT from propagating into any C-List slot.
    """
    r = results['malformed_xe_gt_save_faults_domain_purity']
    assert r.get('faulted'), (
        f'Expected a fault for X+E GT in CR, but none was raised. '
        f'Full result: {r}'
    )
    got = r.get('faultCode')
    assert got == 'DOMAIN_PURITY', (
        f"Expected faultCode='DOMAIN_PURITY', got '{got}'. Full result: {r}"
    )
    assert not r.get('slotWritten'), (
        f'Malformed GT must not be written to the C-List slot. Full result: {r}'
    )


def test_le_gt_in_cr_save_faults_domain_purity(results):
    """SAVE from a CR holding a multi-Church L+E GT must raise DOMAIN_PURITY.

    L and E are both Church permissions.  A GT may carry at most one Church
    permission bit (isSinglePerm rule).  A GT word with both L and E set is
    malformed and must be caught at SAVE time, preventing it from reaching
    any C-List slot in memory.
    """
    r = results['malformed_le_gt_save_faults_domain_purity']
    assert r.get('faulted'), (
        f'Expected a fault for L+E GT in CR, but none was raised. '
        f'Full result: {r}'
    )
    got2 = r.get('faultCode')
    assert got2 == 'DOMAIN_PURITY', (
        f"Expected faultCode='DOMAIN_PURITY', got '{got2}'. Full result: {r}"
    )
    assert not r.get('slotWritten'), (
        f'Malformed GT must not be written to the C-List slot. Full result: {r}'
    )
