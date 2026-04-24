"""Headless test: CALL_HOME (B:02½) is offline-safe.

Drives the simulator through all 7 boot steps with no abstraction registry
(and no uartRegs) present and asserts that:

  1. CALL_HOME runs as its own atomic step (bootStepBefore=3, bootStepAfter=4).
  2. bootStep advances from 3 to 4 during that iteration.
  3. The console output for that step contains the expected log line:
       [BOOT] CALL_HOME — ... ACK=0 (offline)
  4. The simulator does NOT halt: bootComplete == True and bootStep == 6 after
     exactly 7 _bootStep() calls (case 6 / B:05 COMPLETE sets bootComplete=True
     without incrementing bootStep).
"""
import base64
import json
import os
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HARNESS = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

sys.path.insert(0, ROOT)
from server.boot_image import generate_boot_image  # noqa: E402


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
            "abstractionLumpWords":  256,
        },
    }


def _run_harness(cfg, image_bytes):
    payload = json.dumps({
        "config":      cfg,
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
        "skipWindow":  False,
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
            f"sim_boot_loader.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"sim_boot_loader.js produced non-JSON output: {e}\nstdout:\n{out}"
        )


# ---------------------------------------------------------------------------
# the test
# ---------------------------------------------------------------------------

def test_call_home_offline_safe():
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    status = _run_harness(cfg, image)

    # ---- (4) must not halt; must complete all 7 phases --------------------
    assert status["halted"] is False, (
        f"simulator halted during boot — CALL_HOME may have blocked; "
        f"status={status}"
    )
    assert status["bootComplete"] is True, (
        f"bootComplete is False after driving _bootStep(); "
        f"reached bootStep={status['bootStep']}, iterations={status['iterations']}"
    )
    assert status["bootStep"] == 6, (
        f"expected bootStep=6 after full boot (case 6 / B:05 COMPLETE does not "
        f"increment bootStep, it sets bootComplete=true instead), "
        f"got {status['bootStep']}"
    )
    assert status["iterations"] == 7, (
        f"expected exactly 7 _bootStep() calls, got {status['iterations']}"
    )

    # ---- (1) & (2) CALL_HOME is its own atomic step -----------------------
    # Iteration 4 (1-indexed) drives bootStep from 3 → 4 (case 3 = CALL_HOME).
    snapshots = status["stepSnapshots"]
    assert len(snapshots) == 7, (
        f"expected 7 step snapshots, got {len(snapshots)}"
    )
    call_home_snap = snapshots[3]   # 0-indexed: the 4th call
    assert call_home_snap["bootStepBefore"] == 3, (
        f"CALL_HOME snapshot: expected bootStepBefore=3, "
        f"got {call_home_snap['bootStepBefore']}"
    )
    assert call_home_snap["bootStepAfter"] == 4, (
        f"CALL_HOME snapshot: expected bootStepAfter=4, "
        f"got {call_home_snap['bootStepAfter']}"
    )

    # ---- (3) expected log line emitted with ACK=0 (offline) ---------------
    call_home_output = call_home_snap["outputDelta"]
    assert "[BOOT] CALL_HOME" in call_home_output, (
        f"CALL_HOME step did not emit '[BOOT] CALL_HOME' in its output delta.\n"
        f"outputDelta={call_home_output!r}"
    )
    assert "ACK=0 (offline)" in call_home_output, (
        f"CALL_HOME step output does not contain 'ACK=0 (offline)'; "
        f"got: {call_home_output!r}\n"
        f"(No abstractionRegistry present — should always fall back to offline)"
    )

    # Belt-and-suspenders: the full console output must also contain the line.
    full_output = status["consoleOutput"]
    assert "[BOOT] CALL_HOME" in full_output, (
        f"'[BOOT] CALL_HOME' not found anywhere in console output:\n{full_output}"
    )
    assert "ACK=0 (offline)" in full_output, (
        f"'ACK=0 (offline)' not found anywhere in console output:\n{full_output}"
    )


if __name__ == "__main__":
    try:
        test_call_home_offline_safe()
        print("PASS: test_call_home_offline_safe")
    except AssertionError as e:
        print(f"FAIL: test_call_home_offline_safe\n{e}")
        sys.exit(1)
