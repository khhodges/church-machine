"""End-to-end check: a Python-generated boot image actually boots the simulator.

`tests/test_boot_image_matches_simulator.py` (Task #223) only verifies that
the bytes `server.boot_image.generate_boot_image()` produces are byte-for-byte
identical to what the simulator's `_initNamespaceTable()` would have written.
That guards against drift between the two NS-table producers, but it does NOT
exercise the actual loader path used by the IDE:

    sim = ChurchSimulator()        # no bootConfig at construction
    sim.loadBootImage(binary)      # overlay the Python-generated image
    while !bootComplete:           # then run the boot ROM state machine
        sim._bootStep()

This test (Task #224) drives that full loader-plus-boot path through a Node
harness (`tests/sim_boot_loader.js`) for each representative configuration
and asserts:

  * `loadBootImage()` reports success.
  * The boot state machine reaches `bootComplete = true` without faulting.
  * `nsCount` matches what the config asks for (named slots + Step-3 reserves).
  * Capability registers landed on the expected NS slots:
      - CR15 -> NS Slot 0 (Boot.NS, the namespace root)
      - CR12 -> NS Slot 1 (Boot.Thread, the thread identity)
      - CR14 -> NS Slot 6 (Boot.Abstr/SelfTest, code; R+X)  [direct — no director hop since Task #247]
      - CR6  -> NULL (cc=0 CLOOMC design: no c-list at HALT; Task #651)
  * A sentinel CALL frame was pushed (so a stray RETURN reboots cleanly).
  * PC=0 and M-elevation has been dropped after boot completes.

Any regression in `loadBootImage()` (truncation, NS-count miscalculation,
step-3 reservation handling, ...) or in the boot ROM mirror in
`_bootStep()` will be caught here, including drift in fields the per-word
check intentionally ignores (resident lump bodies, etc.).
"""
import base64
import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")


# ---- configs (mirror test_boot_image_matches_simulator.py) ----------------

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


def _cfg_step2_resident():
    cfg = _cfg_default()
    cfg["step2"] = {
        "lumps": [
            {"nsSlot": 18, "resident": True,
             "physAddr": 4096, "lumpSize": 64},
        ],
    }
    return cfg


def _cfg_step3_reservation():
    cfg = _cfg_default()
    cfg["step3"] = {"emptySlotCount": 8, "baseNamedNsCount": 51}
    return cfg


def _cfg_no_window():
    # Image sized to the simulator's *historical default* memory window
    # (65536 words). Used together with skip_window=True so the harness
    # never defines `global.window`, exercising the IDE's "no project
    # bootConfig has been saved yet" startup path through loadBootImage().
    return {
        "step1": {
            "totalNamespaceWords": 65536,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


# (config, skip_window, expected_ns_count)
# expected_ns_count is the exact nsCount loadBootImage() should report:
#   * The default abstraction catalog defines 44 named slots (slots 0..43),
#     so any default+catalog image yields 44.
#     (Task #1918 Minimal Boot Namespace: 8 boot slots 0-7, extended 8-43)
#   * Step-3 emptySlotCount adds reserved-but-empty entries on top of the
#     catalog count; its baseNamedNsCount=51 is explicitly set in the config
#     (not derived from catalog size), so step3_reservation total remains 51+8=59.
CONFIGS = [
    pytest.param(_cfg_default(),           False, 44, id="default"),
    pytest.param(_cfg_custom_step1(),      False, 44, id="custom_step1"),
    pytest.param(_cfg_step2_resident(),    False, 44, id="step2_resident"),
    pytest.param(_cfg_step3_reservation(), False, 59, id="step3_reservation"),
    pytest.param(_cfg_no_window(),         True,  44, id="no_window_bootconfig"),
]


# ---- helpers --------------------------------------------------------------

def _run_harness(cfg, image_bytes, skip_window=False):
    payload = json.dumps({
        "config": cfg,
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
        "skipWindow": bool(skip_window),
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


def _gt_index(word0):
    """Decode the NS-slot index field from a Golden Token word0."""
    # Layout (see simulator.createGT / parseGT): bits[8:0] = nsIndex
    return word0 & 0x1FF


# ---- the test -------------------------------------------------------------

@pytest.mark.parametrize("cfg,skip_window,expected_ns_count", CONFIGS)
def test_boot_image_loads_and_boots(cfg, skip_window, expected_ns_count):
    image = generate_boot_image(cfg, LUMPS_DIR)
    status = _run_harness(cfg, image, skip_window=skip_window)

    # --- loader sanity ------------------------------------------------------
    assert status["loaded"] is True, (
        f"loadBootImage() returned false; status={status}"
    )
    # When the harness suppresses window.bootConfig the simulator falls
    # back to its 65536-word default; the image was generated to match.
    expected_mem = (65536 if skip_window
                    else cfg["step1"]["totalNamespaceWords"])
    assert status["memoryWords"] == expected_mem, (
        f"simulator memory size {status['memoryWords']} != "
        f"expected {expected_mem} (skip_window={skip_window})"
    )

    # --- boot completed cleanly --------------------------------------------
    assert status["faultLog"] == [], (
        f"boot raised fault(s):\n  " +
        "\n  ".join(f"[{f['type']}] {f['message']} (pc={f['pc']}, step={f['step']})"
                    for f in status["faultLog"])
    )
    assert status["halted"] is False, f"simulator halted during boot; status={status}"
    assert status["bootComplete"] is True, (
        f"bootComplete is False after driving _bootStep(); "
        f"reached bootStep={status['bootStep']}, iterations={status['iterations']}, "
        f"status={status}"
    )

    # --- post-boot architectural state -------------------------------------
    assert status["pc"] == 0, f"PC should be 0 at boot entry, got {status['pc']}"
    assert status["mElevation"] is False, (
        "M-elevation must be dropped before bootComplete; still ON"
    )
    assert status["sentinelOnTop"] is True, (
        f"sentinel CALL frame missing from call stack; "
        f"depth={status['callStackDepth']}"
    )

    # --- nsCount lands on the *exact* expected value -----------------------
    assert status["nsCount"] == expected_ns_count, (
        f"nsCount={status['nsCount']} != expected {expected_ns_count}"
    )

    # --- capability registers point at the right NS slots ------------------
    assert _gt_index(status["cr15"]["word0"]) == 0, (
        f"CR15 should hold a GT for NS Slot 0 (Boot.NS); got "
        f"index={_gt_index(status['cr15']['word0'])}"
    )
    assert _gt_index(status["cr12"]["word0"]) == 1, (
        f"CR12 should hold a GT for NS Slot 1 (Boot.Thread); got "
        f"index={_gt_index(status['cr12']['word0'])}"
    )
    assert _gt_index(status["cr14"]["word0"]) == 6, (
        f"CR14 should hold a GT for NS Slot 6 (Boot.Abstr/SelfTest code); got "
        f"index={_gt_index(status['cr14']['word0'])}"
    )
    # CR6 at HALT depends on the embedded Boot.Abstr lump's cc field:
    #   cc=0 (default / pre-LAZY placeholder): B:06 NUC_CLIST leaves CR6 NULL.
    #   cc>0 (POLA-finalized lump): B:06 NUC_CLIST installs the compacted c-list;
    #         CR6 holds a valid E-GT for NS Slot 6 (Boot.Abstr/SelfTest).
    # Both are correct — the distinction is whether POLA compression has been
    # applied and saved to 00000600.lump (Task #651 applies to the cc=0 path).
    cr6_idx = _gt_index(status["cr6"]["word0"])
    assert cr6_idx == 0 or cr6_idx == 6, (
        f"CR6 at HALT must be NULL (cc=0, index=0) or Boot.Abstr GT (cc>0, index=6); "
        f"got index={cr6_idx}"
    )


if __name__ == "__main__":
    failures = 0
    for p in CONFIGS:
        cfg, skip_window, expected_ns = p.values
        name = p.id
        try:
            test_boot_image_loads_and_boots(cfg, skip_window, expected_ns)
            print(f"PASS: {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {name}\n{e}")
    sys.exit(1 if failures else 0)
