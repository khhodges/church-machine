"""Tests for the B:05 CR0 auto-install guard (Tasks #661, #663).

Task #657 added a guard in the B:05 (INIT_ABSTR) boot step that writes the
boot-entry E-GT into the thread lump's CR0 home slot (memory[threadLoc + 244])
whenever that word is zero.  The existing boot tests all pass through
resetMemory() / _initNamespaceTable(), which pre-fills the slot — so the
conditional branch never fires in CI.

Two branches of the guard are tested here:

  test_cr0_auto_installed_by_b05_when_slot_is_zero  (Task #661)
    1. Generate a normal boot image and load it into the simulator.
    2. Run boot steps until the machine is sitting at the start of B:05
       (bootStep == 5, i.e. B:04 has just finished).
    3. Zero memory[threadLoc + 244]  —  simulates a board that booted without
       a prior manual CR0 install.
    4. Run B:05.
    5. Assert that memory[threadLoc + 244] is non-zero and equals
       createGT(0, bootEntrySlot, {E:1}, 1).

  test_cr0_not_overwritten_by_b05_when_slot_is_populated  (Task #663)
    Same setup, but a known non-zero sentinel value is written into
    memory[threadLoc + 244] before B:05 runs.  After B:05 the sentinel must
    be unchanged — the guard's "already populated" skip path must NOT
    overwrite a pre-existing value.

The Node.js harness (sim_cr0_autoinstall_harness.js) performs the simulator
work and returns a JSON report; this module drives the harness and checks the
results.
"""

import base64
import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_cr0_autoinstall_harness.js")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _run_harness(cfg, image_bytes, *, sentinel_value=0):
    """Invoke sim_cr0_autoinstall_harness.js and return the parsed JSON dict.

    sentinel_value — when non-zero the harness writes this value into
    memory[threadLoc + 244] before B:05 instead of zeroing it (sentinel mode).
    """
    payload = json.dumps({
        "config":        cfg,
        "imageBase64":   base64.b64encode(image_bytes).decode("ascii"),
        "skipWindow":    False,
        "sentinelValue": sentinel_value,
    })
    proc = subprocess.run(
        ["node", HARNESS],
        input=payload.encode("utf-8"),
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_cr0_autoinstall_harness.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"sim_cr0_autoinstall_harness.js produced non-JSON output: {e}\n"
            f"stdout:\n{out}"
        )


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

def test_cr0_auto_installed_by_b05_when_slot_is_zero():
    """B:05 writes the boot-entry E-GT into CR0 when the home slot is zero.

    Specifically:
    - The harness zeroes memory[threadLoc + 244] before B:05 runs.
    - After B:05 the slot must be non-zero.
    - The value must equal createGT(0, bootEntrySlot, {E:1}, 1) as computed
      by the same simulator instance (returned by the harness as expectedGT).
    - No fault must have been raised.
    - The simulator's console output for B:05 must contain the auto-install
      log line ("CR0 home … auto-installed").
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image)

    # Harness must have loaded the image and reached B:05 cleanly.
    assert status["loaded"] is True, (
        f"loadBootImage() failed; status={status}"
    )
    assert status["bootStepBeforeB05"] == 5, (
        f"Expected harness to pause at bootStep=5 (start of B:05) but "
        f"got bootStepBeforeB05={status['bootStepBeforeB05']}"
    )
    assert status["zeroed"] is True, (
        "Harness could not zero CR0 home slot (threadEntry not found?); "
        f"status={status}"
    )

    # B:05 must not have faulted.
    assert status["faultLog"] == [], (
        "B:05 raised unexpected fault(s): " +
        "; ".join(f"[{f['type']}] {f['message']}" for f in status["faultLog"])
    )
    assert status["halted"] is False, (
        f"Simulator halted unexpectedly during B:05; status={status}"
    )

    # The step counter must have advanced from 5 to 6 (B:05 → B:06).
    assert status["bootStepAfterB05"] == 6, (
        f"bootStep should be 6 after B:05 but got {status['bootStepAfterB05']}"
    )

    # CR0 home must now be non-zero.
    cr0_value = status["cr0HomeValue"]
    assert cr0_value is not None and cr0_value != 0, (
        f"memory[threadLoc + 244] is still zero after B:05 ran — "
        f"auto-install guard did not fire; status={status}"
    )

    # The written value must match createGT(0, bootEntrySlot, {E:1}, 1).
    expected_gt = status["expectedGT"]
    assert cr0_value == expected_gt, (
        f"CR0 home value 0x{cr0_value:08x} does not match "
        f"expected GT 0x{expected_gt:08x} "
        f"(bootEntrySlot={status['bootEntrySlot']})"
    )

    # The simulator's log output must contain the auto-install message.
    assert status["autoInstallLogged"] is True, (
        "Expected '[BOOT] INIT_ABSTR — CR0 home … auto-installed' in B:05 "
        f"output but got: {status['b05OutputDelta']!r}"
    )


# ---------------------------------------------------------------------------
# Task #663 — skip path: CR0 must NOT be overwritten when already populated
# ---------------------------------------------------------------------------

_SENTINEL = 0xCAFEBABE  # arbitrary non-zero value that is not a valid E-GT


def test_cr0_not_overwritten_by_b05_when_slot_is_populated():
    """B:05 must leave CR0 unchanged when the home slot is already non-zero.

    The guard in B:05 (simulator.js around line 1416) only writes the
    boot-entry E-GT when memory[threadLoc + 244] is zero.  When the slot
    already holds a value (e.g. a GT installed by the user via the IDE) B:05
    must skip the write entirely.

    Specifically:
    - The harness writes a known sentinel (0xCAFEBABE) into
      memory[threadLoc + 244] before B:05 runs.
    - After B:05 the slot must still contain exactly that sentinel.
    - No fault must have been raised.
    - The simulator's console output for B:05 must NOT contain the
      auto-install log line.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image, sentinel_value=_SENTINEL)

    # Harness must have loaded the image and reached B:05 cleanly.
    assert status["loaded"] is True, (
        f"loadBootImage() failed; status={status}"
    )
    assert status["bootStepBeforeB05"] == 5, (
        f"Expected harness to pause at bootStep=5 (start of B:05) but "
        f"got bootStepBeforeB05={status['bootStepBeforeB05']}"
    )
    assert status["sentinelWritten"] is True, (
        "Harness could not write sentinel into CR0 home slot "
        f"(threadEntry not found?); status={status}"
    )

    # B:05 must not have faulted.
    assert status["faultLog"] == [], (
        "B:05 raised unexpected fault(s): " +
        "; ".join(f"[{f['type']}] {f['message']}" for f in status["faultLog"])
    )
    assert status["halted"] is False, (
        f"Simulator halted unexpectedly during B:05; status={status}"
    )

    # The step counter must have advanced from 5 to 6 (B:05 → B:06).
    assert status["bootStepAfterB05"] == 6, (
        f"bootStep should be 6 after B:05 but got {status['bootStepAfterB05']}"
    )

    # CR0 home must still hold the original sentinel — NOT the boot-entry E-GT.
    cr0_value = status["cr0HomeValue"]
    assert cr0_value == _SENTINEL, (
        f"B:05 overwrote CR0 home slot: expected sentinel 0x{_SENTINEL:08x} "
        f"but got 0x{cr0_value:08x} — the zero-check guard is missing or broken; "
        f"status={status}"
    )

    # The auto-install log line must NOT appear (guard was skipped).
    assert status["autoInstallLogged"] is False, (
        "B:05 logged an auto-install message even though CR0 was already "
        f"populated; b05OutputDelta={status['b05OutputDelta']!r}"
    )
