"""Tests that a malformed GT load produces the correct audit trail.

Task #960: Verify that _execLoad() pushes a malformedGT entry to auditLog
and that faultLog[0].malformedReason is set correctly when a GT with mixed
R+L permission bits is written directly into a C-List slot.

R is a Turing permission (bit 0 of permBits).
L is a Church permission (bit 3 of permBits).
Mixing them violates isDomainPure — malformedReason = 'domain-impure permissions (RL)'.

Defence-in-depth chain (Tasks #953 / #958):
  1. parseGT()   — sets malformed=true and malformedReason on decode.
  2. _execLoad() — pushes { gate:'malformedGT', ... } to auditLog.
  3. fault()     — appends { type:'DOMAIN_PURITY', malformedReason, ... }
                   to faultLog via meta spread.

This test covers step 2 and 3, which were not exercised by the earlier
test_gt_load_malformed_perm.py (that file only checked faulted/faultCode).
"""
import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HARNESS = os.path.join(ROOT, 'tests', 'gt', 'sim_gt_load_malformed_audit.js')

EXPECTED_MALFORMED_REASON = 'domain-impure permissions (RL)'


def _run_harness():
    proc = subprocess.run(
        ['node', HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'sim_gt_load_malformed_audit.js exited {proc.returncode}\n'
            f'stderr:\n{proc.stderr.decode("utf-8", errors="replace")}'
        )
    out = proc.stdout.decode('utf-8', errors='replace').strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'sim_gt_load_malformed_audit.js produced non-JSON output: {e}\n'
            f'stdout:\n{out}'
        )


@pytest.fixture(scope='module')
def result():
    r = _run_harness()
    if 'error' in r:
        pytest.fail(f'Harness reported an error: {r["error"]}')
    return r


def test_malformed_rl_gt_raises_domain_purity_fault(result):
    """LOAD from a C-List slot with R+L GT must raise a DOMAIN_PURITY fault.

    Prerequisite for the audit-trail assertions: confirms that the fault
    mechanism itself fired.
    """
    assert result.get('faulted'), (
        f'Expected a DOMAIN_PURITY fault for R+L GT, but none was raised. '
        f'Full result: {result}'
    )
    assert result.get('faultCode') == 'DOMAIN_PURITY', (
        f"Expected faultCode='DOMAIN_PURITY', got '{result.get('faultCode')}'. "
        f'Full result: {result}'
    )


def test_audit_log_contains_malformed_gt_entry(result):
    """auditLog must contain a gate='malformedGT' entry for the R+L GT.

    _execLoad() is required to push a malformedGT record to auditLog before
    calling fault() so that the audit pipeline (Task #958) can surface the
    event in the fault modal and the audit trail view.
    """
    assert result.get('malformedGTEntryFound'), (
        f'Expected auditLog to contain a malformedGT entry, but none was found. '
        f'newAuditCount={result.get("newAuditCount")}, '
        f'Full result: {result}'
    )
    assert result.get('auditGate') == 'malformedGT', (
        f"Expected auditLog entry gate='malformedGT', "
        f"got '{result.get('auditGate')}'. Full result: {result}"
    )


def test_audit_log_entry_has_correct_reason(result):
    """The malformedGT audit entry must carry the correct reason string.

    The reason field must identify R+L as 'domain-impure permissions (RL)',
    matching the string produced by isDomainPure() in simulator.js.
    """
    got = result.get('auditReason')
    assert got == EXPECTED_MALFORMED_REASON, (
        f"Expected auditLog entry reason='{EXPECTED_MALFORMED_REASON}', "
        f"got '{got}'. Full result: {result}"
    )


def test_audit_log_entry_result_is_fault(result):
    """The malformedGT audit entry must record result='fault'.

    This marks the gate as a blocking (non-pass) event in the audit trail,
    consistent with all other gate entries that block instruction execution.
    """
    got = result.get('auditResult')
    assert got == 'fault', (
        f"Expected auditLog entry result='fault', got '{got}'. "
        f'Full result: {result}'
    )


def test_fault_log_entry_has_malformed_reason_field(result):
    """faultLog[0].malformedReason must be set and match the expected string.

    fault() spreads the meta dict into the fault entry, so callers (app-run.js,
    fault modal) can read faultLog[n].malformedReason directly without parsing
    the message string.  This field was introduced by Task #958.
    """
    got = result.get('faultMalformedReason')
    assert got is not None, (
        f'Expected faultLog[0].malformedReason to be set, but it is None/missing. '
        f'Full result: {result}'
    )
    assert got == EXPECTED_MALFORMED_REASON, (
        f"Expected faultLog[0].malformedReason='{EXPECTED_MALFORMED_REASON}', "
        f"got '{got}'. Full result: {result}"
    )


def test_audit_log_entry_malformed_check_failed(result):
    """The malformedGT audit entry checks.malformed.pass must be False.

    The checks dict in the audit entry mirrors the gate-level check result.
    pass=False confirms the check blocked the instruction.
    """
    checks = result.get('auditChecks')
    assert checks is not None, (
        f'Expected auditLog entry to have a checks field, but got None. '
        f'Full result: {result}'
    )
    malformed_check = checks.get('malformed', {})
    assert malformed_check.get('pass') is False, (
        f"Expected checks.malformed.pass=False, "
        f"got '{malformed_check.get('pass')}'. Full result: {result}"
    )
