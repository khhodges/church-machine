"""Tests for _installBootEntryGTIntoCR0() log output (Task #662).

Verifies that when the function is called with a valid sim.bootEntrySlot and a
live NS slot 1 thread entry the function:
  * Returns True (wrote=true)
  * Appends the expected '[IDE] CR0 ←' line to sim.output
  * Includes the correct slot number in the log line
  * Includes the correctly-formatted hex GT word in the log line
  * Also appends the same message to the editorConsole element
"""
import json
import os
import subprocess

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "simulator", "sim_install_boot_entry_cr0.js")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_harness():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_install_boot_entry_cr0.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    return json.loads(proc.stdout.decode("utf-8").strip())


_HARNESS = None


def _h():
    global _HARNESS
    if _HARNESS is None:
        _HARNESS = _run_harness()
    return _HARNESS


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_function_returns_true():
    """_installBootEntryGTIntoCR0() returns True when the write succeeds."""
    assert _h()["returned"] is True


def test_sim_output_contains_ide_cr0_prefix():
    """sim.output contains a line starting with '[IDE] CR0 \u2190'."""
    line = _h()["simOutputLine"]
    assert line.startswith("[IDE] CR0 \u2190"), (
        f"Expected line starting with '[IDE] CR0 \u2190', got: {line!r}"
    )


def test_sim_output_line_contains_correct_slot():
    """The log line encodes the correct boot-entry slot number."""
    data = _h()
    assert data["slot"] == data["bootSlot"], (
        f"Slot in log line ({data['slot']}) does not match bootEntrySlot ({data['bootSlot']})"
    )


def test_sim_output_line_contains_correct_gt_hex():
    """The log line hex GT word matches the independently-computed expected value."""
    data = _h()
    assert data["gtHexInLog"].upper() == data["gtHexExpected"].upper(), (
        f"GT hex in log ({data['gtHexInLog']!r}) != expected ({data['gtHexExpected']!r})"
    )


def test_sim_output_line_contains_boot_entry_description():
    """The log line ends with the human-readable description."""
    line = _h()["simOutputLine"]
    assert "boot-entry first-LUMP installed" in line, (
        f"Expected 'boot-entry first-LUMP installed' in log line, got: {line!r}"
    )


def test_editor_console_contains_log_line():
    """The editorConsole element's textContent includes the log line."""
    data = _h()
    assert data["simOutputLine"] in data["consoleText"], (
        f"editorConsole text does not contain the log line.\n"
        f"consoleText: {data['consoleText']!r}\n"
        f"logLine:     {data['simOutputLine']!r}"
    )


def test_function_originates_from_production_file():
    """The tested function was loaded from simulator/app-memory.js, not redefined locally.

    The harness exposes the first 60 characters of the function source; we
    verify the declaration matches the production function name so a local
    redefinition would be detected without being fragile to internal refactors.
    """
    src = _h()["fnSource"]
    assert "function _installBootEntryGTIntoCR0" in src, (
        f"fnSource does not match the production function declaration: {src!r}"
    )


def test_primary_boot_thread_cr0_receives_boot_entry_gt():
    """The canonical zero-based boot thread receives the expected E-GT."""
    data = _h()
    assert data["primaryCr0Value"] == data["gtWordExpected"], (
        f"Primary Thread CR0 value ({data['primaryCr0Value']!r}) does not match "
        f"expected boot-entry E-GT ({data['gtWordExpected']!r})"
    )
