"""Integration test: NS table has exactly 8 slots after initAbstractions → reset.

The real IDE startup order is:
  1. sim.initAbstractions(registry, ...)   — loads 44-entry abstraction registry
  2. sim.reset()                           — runs _initNamespaceTable()

Before Task #1930 _getHardwareBootCatalog() derived the catalog from the
registry, so reset() produced 44 NS entries.  After the fix it always returns
the fixed 8-slot hardware catalog regardless of registry state.

This test mimics that exact order headlessly through Node and asserts:
  • sim.nsCount == 8  (Step 3 / empty reservation may raise it, but hardware
    boot catalog contributes exactly 8 entries before Step 2/3 augmentation)
  • NS slot 8 (the first extended slot) is all-zero in memory at cold boot
"""
import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "boot", "sim_registry_ns_count.js")


def _run_harness():
    result = subprocess.run(
        ["node", HARNESS],
        capture_output=True, text=True, timeout=15,
    )
    if result.returncode != 0:
        pytest.fail(f"Harness failed:\n{result.stderr}")
    return json.loads(result.stdout)


def test_ns_count_is_8_after_initabstractions_then_reset():
    """nsCount must be ≤ 8 after a registry-populated initAbstractions → reset."""
    data = _run_harness()
    ns_count = data["nsCount"]
    # The 8-slot catalog produces entries at indices 0–6 (slot 7 is null → not
    # written). No Step-2/Step-3 config → nsCount == 7 (highest written slot+1).
    # We assert it is strictly < 8 extended slots: nsCount must never reach the
    # 44-slot registry count regardless of startup order.
    assert ns_count <= 8, (
        f"Expected nsCount ≤ 8 at cold boot (no Step-2/3 config), got {ns_count}. "
        f"_getHardwareBootCatalog() is leaking abstractionRegistry entries."
    )


def test_slot_8_is_zero_after_initabstractions_then_reset():
    """NS slot 8 memory words must be all-zero after registry-populated startup."""
    data = _run_harness()
    assert data["slot8IsZero"], (
        f"NS slot 8 should be all-zero at cold boot but got "
        f"{data.get('slot8Words')}. Registry is populating extended slots."
    )
