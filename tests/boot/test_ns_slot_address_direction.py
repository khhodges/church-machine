"""Regression test: NS slot addresses count DOWN from the top of the NS region.

cloomc-foundation.md §5 specifies:
  slot_word_address(N) = NS_TABLE_BASE + NS_TABLE_RESERVE − 4 − N × 4

On the A7 profile (totalNamespaceWords = 131,072 = 0x20000):
  slot 0 → word address 0x1FFFC  (= 131072 − 4)
  slot 1 → word address 0x1FFF8  (= 131072 − 8)

This test fails immediately if the formula is reverted to count-up
(NS_TABLE_BASE + idx × NS_ENTRY_WORDS), which would place slot 0 at 0x1FC00
and slot 1 at 0x1FC04 instead.
"""
import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "boot", "sim_ns_slot_direction.js")

TOTAL_WORDS    = 131_072           # A7 profile
SLOT0_EXPECTED = TOTAL_WORDS - 4   # 0x1FFFC
SLOT1_EXPECTED = TOTAL_WORDS - 8   # 0x1FFF8


def _run_harness():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_ns_slot_direction.js exited {proc.returncode}:\n"
            f"{proc.stderr.decode('utf-8', errors='replace')}"
        )
    return json.loads(proc.stdout.decode("utf-8").strip())


@pytest.fixture(scope="module")
def result():
    return _run_harness()


def test_slot0_resolves_to_count_down_address(result):
    """Slot 0 must resolve to word 0x1FFFC (top − 4) on A7 profile."""
    actual = result["slot0_base"]
    assert actual == SLOT0_EXPECTED, (
        f"NS slot 0 resolved to word address 0x{actual:05X}, "
        f"expected 0x{SLOT0_EXPECTED:05X} (count-down). "
        f"If this is 0x1FC00 the formula is count-up — see cloomc-foundation.md §5."
    )


def test_slot1_resolves_to_count_down_address(result):
    """Slot 1 must resolve to word 0x1FFF8 (top − 8) on A7 profile."""
    actual = result["slot1_base"]
    assert actual == SLOT1_EXPECTED, (
        f"NS slot 1 resolved to word address 0x{actual:05X}, "
        f"expected 0x{SLOT1_EXPECTED:05X} (count-down). "
        f"If this is 0x1FC04 the formula is count-up — see cloomc-foundation.md §5."
    )


def test_sentinel_written_at_slot0_count_down_address(result):
    """writeNSEntry(0, …) must place data at the count-down address 0x1FFFC."""
    found = result["sentinel0_found_at"]
    assert found == SLOT0_EXPECTED, (
        f"Sentinel written to slot 0 landed at word 0x{found:05X}, "
        f"expected 0x{SLOT0_EXPECTED:05X}. Formula is not count-down."
    )


def test_sentinel_written_at_slot1_count_down_address(result):
    """writeNSEntry(1, …) must place data at the count-down address 0x1FFF8."""
    found = result["sentinel1_found_at"]
    assert found == SLOT1_EXPECTED, (
        f"Sentinel written to slot 1 landed at word 0x{found:05X}, "
        f"expected 0x{SLOT1_EXPECTED:05X}. Formula is not count-down."
    )


def test_count_up_address_is_empty(result):
    """Count-up address (NS_TABLE_BASE = 0x1FC00) must NOT hold sentinel data.

    This assertion flips to a failure if the formula is reverted to count-up.
    """
    # With A7 profile, NS_TABLE_BASE = 0x1FC00 (count-up slot 0 address).
    count_up_slot0 = TOTAL_WORDS - 4096   # = 0x1FC00
    found0 = result["sentinel0_found_at"]
    assert found0 != count_up_slot0, (
        f"Sentinel was found at the count-UP address 0x{count_up_slot0:05X}. "
        f"The NS slot formula has been reverted to count-up — fix it."
    )
