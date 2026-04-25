"""Test that a zeroed boot-entry NS slot (word0 == word1 == 0) produces a BOOT fault.

Task #373: The path where isNSEntryValid returns false — before _auditNSType is
ever reached — was not covered by any automated test.  This module covers it.

When the boot entry NS slot is all-zero:
  - simulator.isNSEntryValid returns false
  - mLoad returns !ok
  - B:04 (LOAD_NUC) records a BOOT fault via this.fault('BOOT', ...)
  - _auditNSType is never called, so no NS.Type entry appears in auditLog
  - bootComplete is False

NS entry layout (4 words per slot in the NS table):
    word0  – low 32 bits of the token/descriptor
    word1  – high 32 bits (gtType, F-bit, clistCount, limit17, …)
    word2/3 – lump-address words

isNSEntryValid(idx) returns true iff (word0 != 0 || word1 != 0).
Zeroing both word0 and word1 makes the entry look absent.
"""
import base64
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    generate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")


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


def _run_harness(cfg, image_bytes):
    """Run sim_boot_loader.js and return the parsed JSON status dict."""
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


def _zero_ns_slot_word0_word1(image_bytes, cfg, slot):
    """Return a copy of image_bytes with word0 and word1 of NS slot `slot` zeroed.

    NS table layout (words):
        ns_table_base  = totalNamespaceWords - NS_TABLE_RESERVE
        slot_base      = ns_table_base + slot * NS_ENTRY_WORDS
        word0          = memory[slot_base]
        word1          = memory[slot_base + 1]

    Zeroing both makes isNSEntryValid return false, so mLoad fails before
    _auditNSType is reached and B:04 records a BOOT fault.
    """
    total          = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base  = total - NS_TABLE_RESERVE
    slot_base      = ns_table_base + slot * NS_ENTRY_WORDS

    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[slot_base]     = 0
    words[slot_base + 1] = 0
    return struct.pack(f"<{total}I", *words)


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

def test_zeroed_boot_entry_ns_slot_produces_boot_fault():
    """Zeroing word0 and word1 of the boot-entry NS slot triggers a BOOT fault.

    Specifically:
    - isNSEntryValid(bootEntrySlot) returns false
    - mLoad returns !ok, so _auditNSType is never called
    - faultLog must contain a fault with type='BOOT'
    - auditLog must contain NO NS.Type entries
    - bootComplete must be False
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    null_image = _zero_ns_slot_word0_word1(image, cfg, BOOT_ABSTR_NS_SLOT)

    status = _run_harness(cfg, null_image)

    fault_log = status.get("faultLog", [])
    audit_log = status.get("auditLog", [])

    # Must have a BOOT fault — not a TYPE fault.
    fault_types = [f["type"] for f in fault_log]
    assert "BOOT" in fault_types, (
        "Expected a BOOT fault when boot entry NS slot is all-zero, "
        f"but faultLog was: {fault_log}"
    )

    # No TYPE fault: mLoad failed before the type check was reached.
    assert "TYPE" not in fault_types, (
        "Expected no TYPE fault (mLoad fails before _auditNSType) but got: "
        f"{fault_log}"
    )

    # No NS.Type entry: _auditNSType must not have been called.
    ns_type_entries = [e for e in audit_log if e.get("gate") == "NS.Type"]
    assert not ns_type_entries, (
        "Expected no NS.Type audit entry (mLoad fails before _auditNSType is reached) "
        f"but auditLog contained: {ns_type_entries}"
    )

    # Boot must not have completed.
    assert status.get("bootComplete") is False, (
        "bootComplete should be False when boot entry NS slot is all-zero; "
        f"status={status}"
    )
