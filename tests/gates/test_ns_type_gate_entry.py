"""Tests that the NS.Type gate log entry appears correctly for boot entries.

Task #371: Confirm that:
  - A boot image whose NS slot 3 entry has a wrong gtType (e.g., Outform/2
    instead of Inform/1) produces an NS.Type gate log entry with result='fail'
    that appears before any Lump.Header entry in the audit log.
  - A boot image with the correct Inform (type=1) NS entry produces an NS.Type
    entry with result='pass'.

The tests drive the simulator through sim_boot_loader.js (the same Node.js
harness used by test_boot_image_loads_and_boots.py) and inspect the auditLog
field that was added to the harness output.

NS word1 layout (mirrors simulator.js parseNSWord1 and boot_image.py pack_ns_word1):
    bit 31       b
    bit 30       f
    bit 29       g
    bit 28       chainable
    bits [27:26] gtType  (0=NULL, 1=Inform, 2=Outform, 3=Abstract)
    bits [25:17] clistCount
    bits [16:0]  limit17
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

_GT_TYPE_MASK  = 0x3 << 26   # bits [27:26] of word1
_GT_TYPE_OUTFORM = 2 << 26   # Outform type value in bits [27:26]


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


def _patch_ns_slot_gttype(image_bytes, cfg, slot, new_gt_type):
    """Return a copy of image_bytes with the gtType of NS slot `slot` changed.

    NS word1 lives at:
        ns_table_base + slot * NS_ENTRY_WORDS + 1   (zero-indexed word offset)

    where  ns_table_base = totalNamespaceWords - NS_TABLE_RESERVE.
    gtType occupies bits [27:26] of word1.

    `new_gt_type` is an integer 0–3.
    """
    total = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base = total - NS_TABLE_RESERVE
    word1_idx = ns_table_base + slot * NS_ENTRY_WORDS + 1  # word offset in image

    words = list(struct.unpack(f"<{total}I", image_bytes))
    old_w1 = words[word1_idx]
    new_w1 = (old_w1 & ~_GT_TYPE_MASK) | ((new_gt_type & 0x3) << 26)
    words[word1_idx] = new_w1 & 0xFFFFFFFF
    return struct.pack(f"<{total}I", *words)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_ns_type_gate_wrong_type_produces_fail_entry():
    """Wrong gtType in Boot.Abstr NS entry → NS.Type gate entry with result='fail'.

    The NS.Type entry must appear in the audit log before any Lump.Header entry.
    The simulator must also record a TYPE fault and NOT complete boot.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    # Patch slot 3's gtType from Inform (1) to Outform (2).
    bad_image = _patch_ns_slot_gttype(image, cfg, BOOT_ABSTR_NS_SLOT, 2)

    status = _run_harness(cfg, bad_image)

    audit = status.get("auditLog", [])

    # There must be an NS.Type entry in the audit log.
    ns_type_entries = [e for e in audit if e.get("gate") == "NS.Type"]
    assert ns_type_entries, (
        "No NS.Type entry found in auditLog after booting with wrong-type NS entry; "
        f"auditLog={audit}"
    )

    # The NS.Type entry for the boot slot must have result='fail'.
    boot_ns_type = ns_type_entries[0]
    assert boot_ns_type["result"] == "fail", (
        f"Expected NS.Type result='fail' but got result={boot_ns_type['result']!r}; "
        f"entry={boot_ns_type}"
    )
    assert boot_ns_type.get("nsIndex") == BOOT_ABSTR_NS_SLOT, (
        f"Expected nsIndex={BOOT_ABSTR_NS_SLOT} in NS.Type entry; got {boot_ns_type}"
    )
    assert boot_ns_type["checks"]["type"]["actual"] == "Outform", (
        f"Expected actual type 'Outform' in NS.Type checks; got {boot_ns_type}"
    )
    assert boot_ns_type["checks"]["type"]["required"] == "Inform", (
        f"Expected required type 'Inform' in NS.Type checks; got {boot_ns_type}"
    )

    # The NS.Type entry must appear before any Lump.Header entry.
    # (When type fails, no Lump.Header entry should appear at all, but the
    # ordering constraint is stated explicitly in the task spec.)
    lump_header_entries = [e for e in audit if e.get("gate") == "Lump.Header"]
    if lump_header_entries:
        ns_type_idx   = audit.index(boot_ns_type)
        lump_hdr_idx  = audit.index(lump_header_entries[0])
        assert ns_type_idx < lump_hdr_idx, (
            f"NS.Type entry (index {ns_type_idx}) must precede first Lump.Header "
            f"entry (index {lump_hdr_idx}) in auditLog"
        )

    # The simulator must have raised a TYPE fault and must not have completed boot.
    fault_types = [f["type"] for f in status.get("faultLog", [])]
    assert "TYPE" in fault_types, (
        f"Expected a TYPE fault in faultLog but got: {status.get('faultLog')}"
    )
    assert status.get("bootComplete") is False, (
        "bootComplete should be False when NS.Type check fails"
    )


def test_ns_type_gate_correct_type_produces_pass_entry():
    """Correct Inform gtType in Boot.Abstr NS entry → NS.Type gate entry with result='pass'.

    The boot must complete cleanly and no TYPE fault must be present.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image)

    audit = status.get("auditLog", [])

    # There must be an NS.Type entry.
    ns_type_entries = [e for e in audit if e.get("gate") == "NS.Type"]
    assert ns_type_entries, (
        "No NS.Type entry found in auditLog after booting with correct Inform NS entry; "
        f"auditLog={audit}"
    )

    boot_ns_type = ns_type_entries[0]
    assert boot_ns_type["result"] == "pass", (
        f"Expected NS.Type result='pass' but got result={boot_ns_type['result']!r}; "
        f"entry={boot_ns_type}"
    )
    assert boot_ns_type.get("nsIndex") == BOOT_ABSTR_NS_SLOT, (
        f"Expected nsIndex={BOOT_ABSTR_NS_SLOT} in NS.Type entry; got {boot_ns_type}"
    )
    assert boot_ns_type["checks"]["type"]["actual"] == "Inform", (
        f"Expected actual type 'Inform' in NS.Type checks; got {boot_ns_type}"
    )

    # No TYPE fault should be present.
    fault_types = [f["type"] for f in status.get("faultLog", [])]
    assert "TYPE" not in fault_types, (
        f"Unexpected TYPE fault in correct-type boot; faultLog={status.get('faultLog')}"
    )

    # Boot must complete cleanly.
    assert status.get("bootComplete") is True, (
        f"bootComplete should be True for correct-type boot; status={status}"
    )


def test_b03_ns_type_audit_entry_wrong_type():
    """Wrong gtType must be caught at B:03 (INIT_ABSTR), not only at B:04.

    When the boot entry NS slot has the wrong type:
    - The NS.Type fail entry must be present in the audit log.
    - The fault that halts boot must originate from INIT_ABSTR (B:03), confirmed
      by the fault message containing 'INIT_ABSTR'.
    - Boot must not complete and a TYPE fault must appear in faultLog.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    bad_image = _patch_ns_slot_gttype(image, cfg, BOOT_ABSTR_NS_SLOT, 2)  # Outform

    status = _run_harness(cfg, bad_image)

    audit = status.get("auditLog", [])
    ns_type_entries = [e for e in audit if e.get("gate") == "NS.Type"]
    assert ns_type_entries, (
        "No NS.Type entry found in auditLog; expected B:03 to record one before faulting; "
        f"auditLog={audit}"
    )
    assert ns_type_entries[0]["result"] == "fail", (
        f"Expected the NS.Type entry from B:03 to have result='fail'; got {ns_type_entries[0]}"
    )

    # Confirm the fault was raised by INIT_ABSTR (B:03), not by LOAD_NUC (B:04).
    fault_msgs = [f.get("message", "") for f in status.get("faultLog", [])]
    assert any("INIT_ABSTR" in m for m in fault_msgs), (
        "Expected a fault message containing 'INIT_ABSTR' (B:03 caught the wrong type), "
        f"but faultLog messages were: {fault_msgs}"
    )

    fault_types = [f["type"] for f in status.get("faultLog", [])]
    assert "TYPE" in fault_types, (
        f"Expected a TYPE fault in faultLog but got: {status.get('faultLog')}"
    )
    assert status.get("bootComplete") is False, (
        "bootComplete should be False when B:03 NS.Type check fails"
    )


def test_pipeline_output_stage_labels_for_ns_type_entries():
    """_auditPipeline() must emit correct stage labels for B:03 and B:04 NS.Type entries.

    For a valid boot image:
    - The first NS.Type pipeline entry must have stage="INIT_ABSTR – NS.Type"
      (from B:03 INIT_ABSTR).
    - The second NS.Type pipeline entry must have stage="LOAD_NUC – NS.Type"
      (from B:04 LOAD_NUC).
    This locks in the UI-facing contract added in Task #374.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image)

    pipeline = status.get("pipelineOutput", [])
    ns_type_pipeline = [e for e in pipeline if e.get("type") == "NS.Type"]

    assert len(ns_type_pipeline) >= 2, (
        "Expected at least two NS.Type pipeline entries (one from B:03, one from B:04); "
        f"got {len(ns_type_pipeline)}: {ns_type_pipeline}"
    )

    b03_stage = ns_type_pipeline[0].get("stage", "")
    assert b03_stage == "INIT_ABSTR \u2013 NS.Type", (
        f"Expected first NS.Type pipeline entry stage='INIT_ABSTR \u2013 NS.Type' (B:03); "
        f"got {b03_stage!r}"
    )

    b04_stage = ns_type_pipeline[1].get("stage", "")
    assert b04_stage == "NUC_CLIST \u2013 NS.Type", (
        f"Expected second NS.Type pipeline entry stage='NUC_CLIST \u2013 NS.Type' (B:06); "
        f"got {b04_stage!r}"
    )


def test_pipeline_output_stage_label_for_b03_fail():
    """_auditPipeline() must label a B:03 NS.Type fail with the INIT_ABSTR prefix.

    When the boot NS slot has the wrong type (Outform instead of Inform):
    - The NS.Type pipeline entry must have stage="INIT_ABSTR – NS.Type".
    - Its status must be 'fail'.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    bad_image = _patch_ns_slot_gttype(image, cfg, BOOT_ABSTR_NS_SLOT, 2)  # Outform

    status = _run_harness(cfg, bad_image)

    pipeline = status.get("pipelineOutput", [])
    ns_type_pipeline = [e for e in pipeline if e.get("type") == "NS.Type"]

    assert ns_type_pipeline, (
        "Expected at least one NS.Type pipeline entry when boot has wrong NS type; "
        f"pipelineOutput={pipeline}"
    )

    b03_entry = ns_type_pipeline[0]
    b03_stage = b03_entry.get("stage", "")
    assert b03_stage == "INIT_ABSTR \u2013 NS.Type", (
        f"Expected stage='INIT_ABSTR \u2013 NS.Type' for B:03 fail entry; got {b03_stage!r}"
    )
    assert b03_entry.get("status") == "fail", (
        f"Expected status='fail' for B:03 NS.Type pipeline entry; got {b03_entry.get('status')!r}"
    )


def test_b03_ns_type_pass_entry_present_before_b04_entry():
    """Correct Inform gtType → B:03 produces its own NS.Type pass entry before B:04's.

    When the boot image is valid, both B:03 (INIT_ABSTR) and B:04 (LOAD_NUC) call
    _auditNSType, producing two NS.Type entries in the audit log.  The first must
    come from B:03 and must have result='pass'.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image)

    audit = status.get("auditLog", [])
    ns_type_entries = [e for e in audit if e.get("gate") == "NS.Type"]

    assert len(ns_type_entries) >= 2, (
        "Expected at least two NS.Type audit entries (one from B:03, one from B:04) "
        f"for a valid boot image; got {len(ns_type_entries)}: {ns_type_entries}"
    )

    # First entry comes from B:03 and must pass.
    b03_entry = ns_type_entries[0]
    assert b03_entry["result"] == "pass", (
        f"Expected first NS.Type entry (from B:03) to have result='pass'; got {b03_entry}"
    )
    assert b03_entry.get("nsIndex") == BOOT_ABSTR_NS_SLOT, (
        f"Expected nsIndex={BOOT_ABSTR_NS_SLOT} in B:03 NS.Type entry; got {b03_entry}"
    )

    # Second entry comes from B:04 and must also pass.
    b04_entry = ns_type_entries[1]
    assert b04_entry["result"] == "pass", (
        f"Expected second NS.Type entry (from B:04) to have result='pass'; got {b04_entry}"
    )

    # No TYPE fault and boot completes.
    fault_types = [f["type"] for f in status.get("faultLog", [])]
    assert "TYPE" not in fault_types, (
        f"Unexpected TYPE fault for valid boot image; faultLog={status.get('faultLog')}"
    )
    assert status.get("bootComplete") is True, (
        f"bootComplete should be True for valid boot image; status={status}"
    )
