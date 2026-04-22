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

ROOT     = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS  = os.path.join(ROOT, "tests", "sim_startup_config.js")

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
            "abstractionLumpWords":  256,
        },
    }


def _image_words(cfg=None):
    if cfg is None:
        cfg = _default_cfg()
    raw = generate_boot_image(cfg, LUMPS_DIR)
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
    # lump word 0 = header, lump word 1 = data[0] = entry_slot
    entry_slot = words[loc + 1]
    assert entry_slot == 4, f"entry_slot default should be 4, got {entry_slot}"


def test_boot_image_startup_config_version_word():
    """data[1] (config_version) equals STARTUP_CONFIG_VERSION in the boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    config_version = words[loc + 2]
    assert config_version == STARTUP_CONFIG_VERSION


def test_boot_image_startup_config_flags_zero():
    """data[2] (flags) is 0 in the default boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    flags = words[loc + 3]
    assert flags == 0


def test_boot_image_startup_config_fault_count_zero():
    """data[3] (fault_count) is 0 in the default boot image."""
    cfg = _default_cfg()
    words = _image_words(cfg)
    loc = _slot2_loc(words, cfg)
    fault_count = words[loc + 4]
    assert fault_count == 0


def test_boot_image_boot_abstr_clist4_points_to_startup_config():
    """Boot.Abstr's c-list[4] must be a GT pointing at NS slot 2 (Startup.Config)."""
    cfg = _default_cfg()
    ns_size     = int(cfg["step1"]["namespaceLumpWords"])
    thread_size = int(cfg["step1"]["threadLumpWords"])
    abstr_size  = int(cfg["step1"]["abstractionLumpWords"])

    words = _image_words(cfg)
    # Boot.Abstr lump location from NS table slot 3
    base = _ns_table_base(words, cfg)
    boot_abstr_loc = words[base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS]
    DEMO_CLIST_SIZE = 17
    clist_start = abstr_size - DEMO_CLIST_SIZE
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


def test_method_ReadParam_oob():
    """ReadParam(64) returns 0xFFFFFFFF (KEY_OOB sentinel)."""
    assert _h()["ReadParam_oob"]["result"] == 0xFFFFFFFF


def test_method_WriteParam_and_roundtrip():
    """WriteParam(5, 0xABCD) returns 0=ok and ReadParam(5) confirms the value."""
    assert _h()["WriteParam_ok"]["result"] == 0
    assert _h()["ReadParam_key5"]["result"] == 0xABCD


def test_method_WriteParam_readonly():
    """WriteParam(1, ...) returns 2=READ_ONLY (header words are protected)."""
    assert _h()["WriteParam_ro"]["result"] == 2


def test_method_WriteParam_oob():
    """WriteParam(64, ...) returns 1=KEY_OOB."""
    assert _h()["WriteParam_oob"]["result"] == 1


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
