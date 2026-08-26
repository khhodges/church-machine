"""Simulator regressions for strict TPERM permission checks."""

import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "gates", "sim_tperm_xlse.js")


def _run_harness():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=60,
    )
    assert proc.returncode == 0, (
        f"TPERM X⊕LSE harness exited {proc.returncode}: {proc.stderr.decode()}")
    return {r["name"]: r for r in json.loads(proc.stdout.decode())}


@pytest.fixture(scope="module")
def results():
    return _run_harness()


class TestTpermStrict:
    """Same-domain checks are exact; cross-domain checks hard-fault."""

    def test_exact_R_passes(self, results):
        r = results["T_STRICT1_exact_R_passes"]
        assert not r["faulted"] and r["flags"] == {"Z": True, "N": False, "C": False, "V": False}
        assert r["unchanged"]

    @pytest.mark.parametrize("name", [
        "T_STRICT2_extra_RW_for_R_fails",
        "T_STRICT3_missing_W_for_RW_fails",
        "T_STRICT6_missing_LS_for_E_fails",
    ])
    def test_same_domain_mismatch_is_flag_failure_without_write(self, results, name):
        r = results[name]
        assert not r["faulted"], f"same-domain mismatch faulted: {r}"
        assert r["flags"] == {"Z": False, "N": True, "C": False, "V": False}
        assert r["unchanged"], f"mismatch changed capability: {r}"

    def test_exact_RW_and_E_pass(self, results):
        for name in ("T_STRICT4_exact_RW_passes", "T_STRICT5_exact_E_passes"):
            r = results[name]
            assert not r["faulted"] and r["flags"]["Z"] and not r["flags"]["N"], r
            assert r["unchanged"], r

    @pytest.mark.parametrize("name", ["T_STRICT7_cross_domain_faults", "T_STRICT8_mixed_request_faults"])
    def test_cross_domain_is_hard_fault(self, results, name):
        r = results[name]
        assert r["faulted"] and r["faultCode"] == "DOMAIN_PURITY", r
        assert r["unchanged"], r
