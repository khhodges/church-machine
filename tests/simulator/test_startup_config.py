"""Tests for Startup.Config — NS slot 2 (Task #396).

Covers:
  * Boot image memory layout (data region, c-list wiring) — pure Python.
  * All 8 methods via the JS simulator harness (sim_startup_config.js).
  * Integration: NS label, nsCount, Boot.Abstr c-list[4] points to slot 2.
"""
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS      = os.path.join(ROOT, "tests", "simulator", "sim_startup_config.js")
BOOT_HARNESS = os.path.join(ROOT, "tests", "simulator", "sim_startup_config_boot.js")

sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    STARTUP_CONFIG_NS_SLOT,
    STARTUP_CONFIG_VERSION,
    generate_boot_image,
    create_gt,
)


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


def _image_words(cfg=None, lumps_dir=LUMPS_DIR):
    if cfg is None:
        cfg = _default_cfg()
    raw = generate_boot_image(cfg, lumps_dir)
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}I", raw))


def _ns_table_base(words, cfg):
    total = int(cfg["step1"]["totalNamespaceWords"])
    assert len(words) == total
    return total - NS_TABLE_RESERVE


def _slot2_loc(words, cfg):
    """Physical word index of the Startup.Config lump."""
    base = _ns_table_base(words, cfg)
    return words[base + STARTUP_CONFIG_NS_SLOT * NS_ENTRY_WORDS]


def _run_harness():
    proc = subprocess.run(
        ["node", HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_startup_config.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    return json.loads(proc.stdout.decode("utf-8").strip())


# Fetch harness results once (module-level) to avoid running Node 8 times.
_HARNESS = None

def _h():
    global _HARNESS
    if _HARNESS is None:
        _HARNESS = _run_harness()
    return _HARNESS


def _run_boot_harness():
    proc = subprocess.run(
        ["node", BOOT_HARNESS],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_startup_config_boot.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    return json.loads(proc.stdout.decode("utf-8").strip())


_BOOT_HARNESS_RESULT = None

def _bh():
    global _BOOT_HARNESS_RESULT
    if _BOOT_HARNESS_RESULT is None:
        _BOOT_HARNESS_RESULT = _run_boot_harness()
    return _BOOT_HARNESS_RESULT


# ---------------------------------------------------------------------------
# Boot image memory layout tests (pure Python)
# ---------------------------------------------------------------------------

def test_startup_config_ns_slot_is_2():
    """STARTUP_CONFIG_NS_SLOT constant equals 2."""
    assert STARTUP_CONFIG_NS_SLOT == 2


def test_startup_config_version_constant():
    """STARTUP_CONFIG_VERSION is 0x00000001."""
    assert STARTUP_CONFIG_VERSION == 0x00000001


def test_boot_image_slot2_ns_entry_nonzero():
    """NS table slot 2 must have a non-zero entry in the generated boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    base = _ns_table_base(words, cfg)
    slot2_w0 = words[base + 2 * NS_ENTRY_WORDS]
    slot2_w1 = words[base + 2 * NS_ENTRY_WORDS + 1]
    assert slot2_w0 != 0 or slot2_w1 != 0, "NS slot 2 entry must be non-zero (Startup.Config)"


def test_boot_image_startup_config_entry_slot_default():
    """data[0] (entry_slot) defaults to 4 in the generated boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    # lump layout: word 0 = header, words 1-3 = code region, word 4 = data[0] = entry_slot
    entry_slot = words[loc + 4]
    assert entry_slot == 4, f"entry_slot default should be 4, got {entry_slot}"


def test_boot_image_startup_config_version_word():
    """data[1] (config_version) equals STARTUP_CONFIG_VERSION in the boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    config_version = words[loc + 5]
    assert config_version == STARTUP_CONFIG_VERSION


def test_boot_image_startup_config_flags_zero():
    """data[2] (flags) is 0 in the default boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    flags = words[loc + 6]
    assert flags == 0


def test_boot_image_startup_config_fault_count_zero():
    """data[3] (fault_count) is 0 in the default boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    fault_count = words[loc + 7]
    assert fault_count == 0


def test_boot_image_boot_abstr_clist4_points_to_startup_config(tmp_path):
    """Boot.Abstr's c-list[4] must be a GT pointing at NS slot 2 (Startup.Config).

    Uses a temp lumps dir (no saved 00000300.lump) so the default 64w synthesized
    Boot.Abstr — which always has DEMO_CLIST_SIZE=18 c-list entries — is used.
    This ensures c-list[4] is always in range regardless of any saved lump in
    the real server/lumps directory (Task #568).
    """
    cfg = _default_cfg()
    words = _image_words(cfg, lumps_dir=str(tmp_path))
    # Boot.Abstr lump location from NS table slot 3
    base = _ns_table_base(words, cfg)
    boot_abstr_loc = words[base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS]
    # Derive abstr_size and cc from the lump header (Task #568 — abstractionLumpWords deprecated)
    hdr        = words[boot_abstr_loc]
    n_minus_6  = (hdr >> 23) & 0xF
    abstr_size = 1 << (n_minus_6 + 6)
    cc         = hdr & 0xFF
    clist_start = abstr_size - cc
    clist4_gt = words[boot_abstr_loc + clist_start + 4]
    # GT bits[8:0] = NS slot index
    gt_index = clist4_gt & 0x1FF
    assert gt_index == STARTUP_CONFIG_NS_SLOT, (
        f"Boot.Abstr c-list[4] GT index should be {STARTUP_CONFIG_NS_SLOT} "
        f"(Startup.Config), got {gt_index} (GT word 0x{clist4_gt:08x})"
    )


# ---------------------------------------------------------------------------
# Method dispatch tests (via JS harness — all 8 methods)
# ---------------------------------------------------------------------------

def test_method_GetEntry_default():
    """GetEntry returns 4 (the default entry_slot) on a fresh Startup.Config."""
    assert _h()["GetEntry"]["result"] == 4


def test_method_SetEntry_persists():
    """SetEntry(16) returns 0=ok and GetEntry then returns 16."""
    assert _h()["SetEntry_slot16"]["result"] == 0
    assert _h()["GetEntry_after"]["result"] == 16


def test_method_SetEntry_rejects_recursive_slot2():
    """SetEntry(2) must return 3=RECURSIVE_SLOT (self-reference)."""
    assert _h()["SetEntry_slot2"]["result"] == 3


def test_method_SetEntry_rejects_recursive_slot3():
    """SetEntry(3) must return 3=RECURSIVE_SLOT (Boot.Abstr would recurse)."""
    assert _h()["SetEntry_slot3"]["result"] == 3


def test_method_ReadParam_entry_slot():
    """ReadParam(0) returns entry_slot = 4 after Reset."""
    assert _h()["ReadParam_key0"]["result"] == 4


def test_method_ReadParam_config_version():
    """ReadParam(1) returns STARTUP_CONFIG_VERSION (0x00000001)."""
    assert _h()["ReadParam_key1"]["result"] == STARTUP_CONFIG_VERSION


def test_method_ReadParam_last_valid_key():
    """ReadParam(58) returns a non-OOB value — key 58 is the last valid data key."""
    assert _h()["ReadParam_key62"]["result"] != 0xFFFFFFFF


def test_method_ReadParam_oob_key63():
    """ReadParam(59) returns 0xFFFFFFFF — key 59 is past the data region boundary."""
    assert _h()["ReadParam_oob"]["result"] == 0xFFFFFFFF


def test_method_ReadParam_oob_key64():
    """ReadParam(60) also returns 0xFFFFFFFF (deeply OOB)."""
    assert _h()["ReadParam_oob64"]["result"] == 0xFFFFFFFF


def test_method_WriteParam_and_roundtrip():
    """WriteParam(5, 0xABCD) returns 0=ok and ReadParam(5) confirms the value."""
    assert _h()["WriteParam_ok"]["result"] == 0
    assert _h()["ReadParam_key5"]["result"] == 0xABCD


def test_method_WriteParam_last_valid_key():
    """WriteParam(58, 0x1234) returns 0=ok (key 58 is the last writable key)."""
    assert _h()["WriteParam_key62"]["result"] == 0


def test_method_WriteParam_readonly():
    """WriteParam(1, ...) returns 2=READ_ONLY (header words are protected)."""
    assert _h()["WriteParam_ro"]["result"] == 2


def test_method_WriteParam_oob_key63():
    """WriteParam(59, ...) returns 1=KEY_OOB — must not write past the data region."""
    assert _h()["WriteParam_oob"]["result"] == 1


def test_method_WriteParam_oob_does_not_corrupt_boot_abstr():
    """WriteParam(59, 0xDEADBEEF) must not overwrite Boot.Abstr's lump header."""
    assert _h()["WriteParam_oob_boot_abstr_hdr_unchanged"] is True


def test_method_WriteParam_oob_key64():
    """WriteParam(60, ...) also returns 1=KEY_OOB (deeply OOB)."""
    assert _h()["WriteParam_oob64"]["result"] == 1


def test_method_Validate_bitmask():
    """Validate returns 0xF when all four foundational slots are non-null."""
    result = _h()["Validate"]["result"]
    assert result == 0xF, (
        f"Validate bitmask should be 0xF (slots 0-3 all non-null), got 0x{result:X}"
    )


def test_method_Version_returns_constant():
    """Version returns STARTUP_CONFIG_VERSION (0x00000001)."""
    assert _h()["Version"]["result"] == STARTUP_CONFIG_VERSION


def test_method_Reset_restores_entry_slot():
    """Reset restores entry_slot to 4 (the factory default)."""
    assert _h()["Reset_entry"]["result"] == 4


def test_method_Execute_passes_all_prechecks():
    """Execute returns ok=True when all pre-checks pass."""
    assert _h()["Execute_ok"]["ok"] is True


def test_method_Execute_fault_bad_flags_returns_error():
    """Execute with non-zero flags returns ok=False, result=2 (BAD_FLAGS)."""
    r = _h()["Execute_fault_bad_flags"]
    assert r["ok"] is False
    assert r["result"] == 2


def test_method_Execute_fault_increments_fault_count_in_memory():
    """Execute pre-check failure increments fault_count in the lump's data region."""
    assert _h()["Execute_fault_count_incremented"] is True


# ---------------------------------------------------------------------------
# Gate log / audit trail tests
# ---------------------------------------------------------------------------

def test_execute_adds_entry_to_audit_log():
    """Execute() writes a 'Startup.Config.Execute' gate entry to the simulator audit log."""
    assert _h()["auditLog_has_startup_config"] is True


def test_execute_audit_log_entry_dispatches_to_entry_slot():
    """The audit log entry records the configured entry slot (default 4)."""
    assert _h()["auditLog_entry_nsIndex"] == 4


def test_execute_audit_log_entry_result_is_pass():
    """The audit log entry has result='pass' on a clean Execute."""
    assert _h()["auditLog_entry_result"] == "pass"


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------

def test_ns_label_slot2_is_startup_config():
    """The simulator labels NS slot 2 as 'Startup.Config' after init."""
    assert _h()["nsLabel2"] == "Startup.Config"


def test_nsCount_unchanged():
    """nsCount remains 47 after adding Startup.Config at slot 2."""
    assert _h()["nsCount"] == 47


def test_boot_abstr_clist4_points_to_slot2_in_simulator():
    """In the simulator, Boot.Abstr's c-list[4] GT index is 2 (Startup.Config)."""
    assert _h()["clist4IsSlot2"] is True, (
        f"Boot.Abstr c-list[4] GT should point to NS slot 2, "
        f"got index {_h().get('clist4GtIndex')}"
    )


# ---------------------------------------------------------------------------
# Boot integration tests (full boot sequence → Startup.Config.Execute)
# ---------------------------------------------------------------------------

def test_boot_integration_boot_completes():
    """Boot steps B:00-B:04 complete without faults (bootComplete=True)."""
    assert _bh()["bootComplete"] is True


def test_boot_integration_no_boot_faults():
    """Boot sequence produces no fault-log entries."""
    assert _bh()["faultLog"] == []


def test_boot_integration_startup_config_execute_called():
    """After boot, Startup.Config.Execute() dispatch writes a gate-log entry."""
    assert _bh()["auditLogHasStartup"] is True


def test_boot_integration_startup_config_no_faults_implies_execute_ok():
    """No boot faults implies Startup.Config.Execute() succeeded (faults would appear in faultLog)."""
    bh = _bh()
    assert bh["faultLog"] == [], f"Expected no faults; got: {bh['faultLog']}"


def test_boot_integration_startup_config_dispatches_to_entry_slot():
    """The gate-log entry records nsIndex = 4 (the default entry_slot)."""
    assert _bh()["dispatchedToSlot"] == 4


def test_boot_integration_led_bits_all_on_after_execute():
    """ledBits = 0x3F (all 6 LEDs on) after successful Startup.Config.Execute()."""
    assert _bh()["ledBits"] == 0x3F


def test_boot_integration_gate_log_bootStepName():
    """The gate-log entry has bootStepName='STARTUP_CONFIG'."""
    entry = _bh()["startupConfigEntry"]
    assert entry is not None
    assert entry.get("bootStepName") == "STARTUP_CONFIG"


def test_boot_integration_execute_failure_halts_boot():
    """If Startup.Config flags are corrupt, Execute() fails and boot halts without bootComplete."""
    result = subprocess.run(
        ["node", "-e", r"""
global.window = { bootConfig: { step1: {
    totalNamespaceWords: 16384, namespaceLumpWords: 64,
    threadLumpWords: 256 } } };
const ChurchSimulator     = require('./simulator/simulator.js');
const AbstractionRegistry = require('./simulator/abstractions.js');
const SystemAbstractions  = require('./simulator/system_abstractions.js');
const sim = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);
// Corrupt the flags word (data[2]) in the Startup.Config lump so Execute() fails BAD_FLAGS.
// Lump layout: word 0 = header, words 1-3 = code, word 4 = data[0], word 5 = data[1],
//              word 6 = data[2] (flags), word 7 = data[3] (fault_count).
const scLoc = sim.memory[sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS];
sim.memory[scLoc + 6] = 0xDEAD;  // data[2] = flags (must be 0)
// Drive boot — B:05a should detect failure and halt.
for (let i = 0; i < 32 && !sim.bootComplete && !sim.halted; i++) sim._bootStep();
const out = {
    bootComplete: sim.bootComplete === true,
    halted: sim.halted === true,
    hasFault: (sim.faultLog || []).length > 0,
    ledBits: sim.ledBits | 0,
};
process.stdout.write(JSON.stringify(out) + '\n');
"""],
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    assert result.returncode == 0, result.stderr.decode()
    data = json.loads(result.stdout.decode().strip())
    assert data["bootComplete"] is False, "boot should NOT complete if Execute() fails"
    assert data["halted"] is True, "simulator should halt on Execute() failure"
    assert data["hasFault"] is True, "faultLog should be non-empty"
    assert data["ledBits"] != 0x3F, "ledBits should encode fault count, not success"
