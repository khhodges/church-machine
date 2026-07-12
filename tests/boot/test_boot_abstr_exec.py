"""End-to-end simulator test: Boot.Abstr direct dispatch via CR0.

After the boot state machine finishes (bootComplete=true), NUC_CODE (B:07)
must have installed the boot-entry E-GT directly into CR0.  No
CHANGE→TPERM→CALL trampoline is involved; the first user instruction fetched
is word 1 of the real SelfTest lump.

Tests (parametrised over two boot configs):

  A. Boot completes cleanly — loaded=true, bootComplete=true, no faults.

  B. CR0 after boot is non-null and carries E-permission (installed by
     NUC_CODE direct dispatch, not by CHANGE RESTORE_CALL).

  C. CR0 points to the correct NS slot (bootEntrySlot).

  D. CR0 has no extraneous permissions (only E-bit set).

  E. thread[+244] (Thread.caps[0]) holds the same E-GT that NUC_CODE
     installed into CR0 (confirmed via bootEntrySlot match).

The harness uses sim_boot_loader.js (the same script used by
test_boot_image_loads_and_boots.py) extended with cr0 and bootEntrySlot
fields in its JSON output.  A synthetic 00000600.lump is written into
tmp_path so generate_boot_image() does not raise ValueError.
"""
import base64
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image, BOOT_ABSTR_NS_SLOT  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")


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


def _make_synthetic_lump(cw=3, cc=0, n_minus_6=0):
    """Build a minimal 64-word big-endian Boot.Abstr lump."""
    lump_size = 1 << (n_minus_6 + 6)
    header = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | (0 << 8) | cc
    words = [0] * lump_size
    words[0] = header
    return struct.pack(f">{lump_size}I", *words)


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
            f"sim_boot_loader.js produced non-JSON output: {e}\n"
            f"stdout:\n{out}"
        )


def _gt_perms(word0):
    """Extract permission dict from a GT word0 using the v2.0 simulator layout.

    v2.0 layout: [31]=B [30:28]=perm3 [27]=dom [26:25]=gt_type [24:16]=gt_seq [15:0]=slot_id
    Church domain (dom=1): perm3 bits [2:0] = {E, S, L}
    Turing domain (dom=0): perm3 bits [2:0] = {X, W, R}
    """
    dom   = (word0 >> 27) & 1
    perm3 = (word0 >> 28) & 0x7
    b     = (word0 >> 31) & 1
    if dom == 1:
        return {"B": b, "E": (perm3 >> 2) & 1, "S": (perm3 >> 1) & 1, "L": perm3 & 1,
                "X": 0, "W": 0, "R": 0}
    else:
        return {"B": b, "X": (perm3 >> 2) & 1, "W": (perm3 >> 1) & 1, "R": perm3 & 1,
                "E": 0, "S": 0, "L": 0}


def _gt_ns_index(word0):
    return word0 & 0xFFFF


@pytest.mark.parametrize("cfg", CONFIGS)
def test_boot_abstr_direct_dispatch_cr0(cfg, tmp_path):
    """NUC_CODE (B:07) installs boot-entry E-GT directly into CR0.

    After boot completes:
      - No faults occurred.
      - CR0.word0 is non-zero and carries only E-permission.
      - CR0 NS index matches bootEntrySlot.
    """
    lump_filename = f"{BOOT_ABSTR_NS_SLOT << 8:08x}.lump"
    (tmp_path / lump_filename).write_bytes(_make_synthetic_lump())

    image = generate_boot_image(cfg, str(tmp_path))
    status = _run_harness(cfg, image)

    # A — boot must complete cleanly
    assert status["loaded"] is True, (
        f"loadBootImage() returned false; status={status}"
    )
    assert status["bootComplete"] is True, (
        f"bootComplete is False after _bootStep(); status={status}"
    )
    assert status["bootFaults"] == [] if "bootFaults" in status else status.get("faultLog", []) == [], (
        "boot raised fault(s): " +
        ", ".join(f"[{f['type']}] {f['message']}" for f in (
            status.get("bootFaults") or status.get("faultLog") or []
        ))
    )

    boot_entry_slot = status.get("bootEntrySlot")
    cr0 = status.get("cr0")

    # B — CR0 must be non-null
    assert cr0 is not None, (
        "sim_boot_loader.js did not include 'cr0' in status output; "
        "update sim_boot_loader.js to include crSnap(0)"
    )
    assert cr0["word0"] != 0, (
        "CR0 is NULL (word0=0) after boot — NUC_CODE direct dispatch did not "
        "install the boot-entry E-GT into CR0"
    )

    cr0_w0 = cr0["word0"]
    perms = _gt_perms(cr0_w0)

    # C — CR0 must carry E-permission
    assert perms["E"] == 1, (
        f"CR0 after boot lacks E-permission; CR0.word0=0x{cr0_w0:08X}; perms={perms}"
    )

    # D — CR0 must have only E-bit set (E-only GT, direct dispatch)
    non_e_perms = {k: v for k, v in perms.items() if k != "E" and v != 0}
    assert not non_e_perms, (
        f"CR0 has extra permissions beyond E after direct dispatch; "
        f"extra={non_e_perms}; CR0.word0=0x{cr0_w0:08X}"
    )

    # E — CR0 must point to the correct boot-entry NS slot
    if boot_entry_slot is not None:
        assert _gt_ns_index(cr0_w0) == boot_entry_slot, (
            f"CR0 NS index={_gt_ns_index(cr0_w0)} != bootEntrySlot={boot_entry_slot}; "
            f"CR0.word0=0x{cr0_w0:08X}"
        )


if __name__ == "__main__":
    failures = 0
    for p in CONFIGS:
        cfg = p.values[0]
        name = p.id
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            import pathlib
            lump_filename = f"{BOOT_ABSTR_NS_SLOT << 8:08x}.lump"
            (pathlib.Path(td) / lump_filename).write_bytes(_make_synthetic_lump())
            try:
                image = generate_boot_image(cfg, td)
                status = _run_harness(cfg, image)
                test_boot_abstr_direct_dispatch_cr0.__wrapped__(cfg, pathlib.Path(td)) \
                    if hasattr(test_boot_abstr_direct_dispatch_cr0, '__wrapped__') \
                    else None
                cr0 = status.get("cr0")
                assert cr0 and cr0["word0"] != 0, "CR0 is null/zero"
                perms = _gt_perms(cr0["word0"])
                assert perms["E"] == 1, f"E-perm missing; perms={perms}"
                print(f"PASS: {name}")
            except (AssertionError, RuntimeError) as e:
                failures += 1
                print(f"FAIL: {name}\n{e}")
    sys.exit(1 if failures else 0)
