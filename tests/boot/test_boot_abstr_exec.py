"""End-to-end simulator test: step through all 3 Boot.Abstr instructions.

`test_boot_image_loads_and_boots.py` (Task #224) verifies that
loadBootImage() + _bootStep() complete cleanly and land in the expected
architectural state (CR12/CR14/CR15/CR6 wired to the right NS slots,
sentinel call frame on stack, PC=0, M-elevation dropped).  That test
stops at bootComplete=true and does NOT exercise the 3-instruction
Boot.Abstr program that the simulator's step/run engine executes next.

This test (Task #656) drives the harness further: after the boot state
machine finishes, it calls sim.step() for each of the three Boot.Abstr
instructions and asserts on the resulting simulator state:

  [0] CHANGE AL, CR12, CR12, #1
        The simulator's isFirstActivation bypass handles the S-perm gate
        for this self-referential pattern (crSrc=crDst=12, no prior thread
        context saved) — no harness state manipulation is needed.  CHANGE
        then performs RESTORE_CALL: it loads CR0–CR11 from the Boot.Thread
        caps zone (thread[+244..+255]).  The test asserts:
          - no new fault
          - CR0.word0 is non-null and carries the boot-entry E-GT
            (GT index == bootEntrySlot, E-permission set)
          - the CHANGE step description mentions RESTORE_CALL

  [1] TPERM AL, CR0, #E
        TPERM restricts CR0 to E-permission only.  The test asserts:
          - no new fault
          - CR0.word0 is non-null
          - only the E bit is set in the permission field (E-only)

  [2] CALL AL, CR0, CR0
        With E-only CR0, CALL enters the configured boot-entry abstraction
        (default: NS Slot 3, Boot.Abstr itself, or whichever slot
        bootEntrySlot points to).  The test asserts:
          - no new fault
          - the call stack grew by exactly 1 (a new frame was pushed)
          - PC reset to 0 (callee's first instruction)

Any regression in CHANGE CR12 semantics (RESTORE_CALL path), TPERM's
E-masking, or CALL's entry path will be caught here before the existing
boot test suite has a chance to flag anything.
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
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_abstr_runner.js")


# ── configs ──────────────────────────────────────────────────────────────────

def _cfg_default():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _cfg_custom_step1():
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":     64,
            "threadLumpWords":       512,
        },
    }


CONFIGS = [
    pytest.param(_cfg_default(),      id="default"),
    pytest.param(_cfg_custom_step1(), id="custom_step1"),
]


# ── harness helper ────────────────────────────────────────────────────────────

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
            f"sim_abstr_runner.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"sim_abstr_runner.js produced non-JSON output: {e}\n"
            f"stdout:\n{out}"
        )


# ── GT helpers ────────────────────────────────────────────────────────────────

def _gt_perms(word0):
    """Return {B,E,S,L,X,W,R} permission dict from a GT word0."""
    p = (word0 >> 25) & 0x7F
    return {
        "B": (p >> 6) & 1,
        "E": (p >> 5) & 1,
        "S": (p >> 4) & 1,
        "L": (p >> 3) & 1,
        "X": (p >> 2) & 1,
        "W": (p >> 1) & 1,
        "R": (p >> 0) & 1,
    }


def _gt_ns_index(word0):
    return word0 & 0xFFFF


def _word0_hex(snap):
    """Return hex string for a CR snapshot's word0, safe for format."""
    if snap is None:
        return "0x00000000"
    return f"0x{snap['word0']:08X}"


# ── the test ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("cfg", CONFIGS)
def test_boot_abstr_exec(cfg):
    image  = generate_boot_image(cfg, LUMPS_DIR)
    status = _run_harness(cfg, image)

    # ── boot phase must complete cleanly ──────────────────────────────────────
    assert status["loaded"] is True, (
        f"loadBootImage() returned false; status={status}"
    )
    assert status["bootComplete"] is True, (
        f"bootComplete is False after _bootStep(); status={status}"
    )
    assert status["bootFaults"] == [], (
        "boot raised fault(s): " +
        ", ".join(f"[{f['type']}] {f['message']}" for f in status["bootFaults"])
    )

    boot_entry_slot = status["bootEntrySlot"]

    # ── B:05 INIT_ABSTR must have auto-installed the E-GT at thread[+244] ─────
    # This is what CHANGE's RESTORE_CALL loads into CR0.
    assert status["threadCaps0"] != 0, (
        "thread[+244] (CR0 home slot) is NULL after boot; "
        "B:05 INIT_ABSTR auto-install failed"
    )
    assert status["threadCaps0HasEPerm"] is True, (
        f"thread[+244] word0={status['threadCaps0']:#010x} lacks E-permission; "
        "expected the boot-entry E-GT auto-installed by B:05 INIT_ABSTR"
    )
    assert _gt_ns_index(status["threadCaps0"]) == boot_entry_slot, (
        f"thread[+244] NS index={_gt_ns_index(status['threadCaps0'])} "
        f"!= bootEntrySlot={boot_entry_slot}"
    )

    # ── [0] CHANGE AL, CR12, CR12, #1 ────────────────────────────────────────
    # The isFirstActivation bypass handles the S-perm gate naturally.
    # CHANGE must succeed and RESTORE_CALL must load the boot-entry E-GT into CR0.
    change = status["changeStep"]
    assert not change["faulted"], (
        "CHANGE AL, CR12, CR12, #1 raised unexpected fault(s): " +
        ", ".join(
            f"[{f['type']}] {f['message']}" for f in change["newFaults"]
        )
    )
    cr0_after_change = change["cr0After"]
    cr0_w0 = cr0_after_change["word0"] if cr0_after_change else 0
    assert cr0_w0 != 0, (
        "CR0 is NULL after CHANGE — RESTORE_CALL did not load the "
        "boot-entry E-GT from thread[+244]"
    )
    assert _gt_perms(cr0_w0).get("E") == 1, (
        f"CR0 after CHANGE lacks E-permission; CR0.word0={cr0_w0:#010x}; "
        f"perms={_gt_perms(cr0_w0)}"
    )
    assert _gt_ns_index(cr0_w0) == boot_entry_slot, (
        f"CR0 after CHANGE points to NS index={_gt_ns_index(cr0_w0)}, "
        f"expected bootEntrySlot={boot_entry_slot}"
    )
    assert change.get("descContainsRestoreCall") is True, (
        "CHANGE step description does not mention RESTORE_CALL; "
        "simulator may not be performing the caps-zone restore"
    )

    # ── [1] TPERM AL, CR0, #E ────────────────────────────────────────────────
    tperm = status["tpermStep"]
    assert tperm["newFaults"] == [], (
        "TPERM AL, CR0, #E raised unexpected fault(s): " +
        ", ".join(f"[{f['type']}] {f['message']}" for f in tperm["newFaults"])
    )
    cr0_tperm = tperm["cr0After"]
    cr0_tperm_w0 = cr0_tperm["word0"] if cr0_tperm else 0
    assert tperm["hasEPerm"] is True, (
        f"CR0 after TPERM #E lacks E-permission; "
        f"CR0.word0={cr0_tperm_w0:#010x}"
    )
    assert tperm["eOnly"] is True, (
        f"TPERM #E did not restrict CR0 to E-only; "
        f"CR0.word0={cr0_tperm_w0:#010x}; "
        f"perms={_gt_perms(cr0_tperm_w0)}"
    )

    # ── [2] CALL AL, CR0, CR0 ────────────────────────────────────────────────
    call = status["callStep"]
    assert call["newFaults"] == [], (
        "CALL AL, CR0, CR0 raised unexpected fault(s): " +
        ", ".join(f"[{f['type']}] {f['message']}" for f in call["newFaults"])
    )
    assert call["callEnteredClean"] is True, (
        f"CALL did not enter the boot-entry abstraction cleanly: "
        f"callDepthDelta={call['callDepthDelta']}, "
        f"pcAfterCall={call['pcAfterCall']}; "
        "expected callDepthDelta=1 and pcAfterCall=1"
    )
    assert call["callDepthDelta"] == 1, (
        f"CALL should push exactly one new call frame; "
        f"callDepthDelta={call['callDepthDelta']}"
    )
    assert call["pcAfterCall"] == 1, (
        f"PC after CALL should be 1 (callee's first instruction, word 1 of the lump); "
        f"got pcAfterCall={call['pcAfterCall']}"
    )


if __name__ == "__main__":
    failures = 0
    for p in CONFIGS:
        cfg = p.values[0]
        name = p.id
        try:
            test_boot_abstr_exec(cfg)
            print(f"PASS: {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {name}\n{e}")
    sys.exit(1 if failures else 0)
