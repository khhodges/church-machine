"""
tests/server/test_boot_config_validation.py

Automated test coverage for _validate_step2 — specifically the
physAddr-vs-board-RAM ceiling checks introduced in Task #1183, and the
usable-namespace-region check introduced in Task #1188.

Tests cover:
  - Lump within range (no error)
  - Lump ending exactly at the board RAM ceiling (no error — boundary is inclusive)
  - Lump extending one word past the ceiling (error)
  - Error message content for out-of-range cases
  - Two board profiles: Tang Nano 20K (16 384 words) and Wukong XC7A100T (131 072 words)
  - General _validate_step2 input-validation guards
  - Lump within usable namespace region (no error)
  - Lump ending exactly at usable_end boundary (no error — boundary is inclusive)
  - Lump extending one word past usable_end (error — "usable namespace region")
  - Two distinct totalNamespaceWords values to parameterise the usable-end ceiling
"""

import json
import os
import struct
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import (
    DEFAULT_BOOT_CONFIG,
    HARDWARE_PROFILES,
    _validate_step1,
    _validate_step2,
)

# ---------------------------------------------------------------------------
# Test constants
# ---------------------------------------------------------------------------

LUMP_SIZE = 64  # words — used for all resident test lumps
NS_SLOT = 16    # outside the current 0–10 foundational/device catalog

FAKE_CATALOG_ENTRY = {
    "abstraction": "TestLump",
    "nsSlot": NS_SLOT,
    "lumpSize": LUMP_SIZE,
    "token": "deadbeef",
    "binaryHash": "a" * 64,
}

# Thread.1, Boot.Abstr, and catalog bodies at slots 7–10 occupy the RAM
# prefix. Boot.NS instead resides at the Namespace-table tail.
# With thread_lump=256 and BOOT_ABSTR_DEFAULT_SIZE=64 → 576.
FOUNDATION_END = 256 + 64 + (4 * 64)  # 576


def _fake_catalog(selected_tokens=None):
    return [FAKE_CATALOG_ENTRY]


def _make_step1(total_ns_words, ns_lump=64, thread_lump=256):
    return {
        "totalNamespaceWords": total_ns_words,
        "namespaceLumpWords": ns_lump,
        "threadLumpWords": thread_lump,
        # Fix nsSlotsMax=256 so ns_table_reserve_words(256)=1024=0x400 matches _NS_TABLE_RESERVE.
        "nsSlotsMax": 256,
    }


def _make_step2(phys_addr, resident=True, lump_size=LUMP_SIZE):
    return {
        "lumps": [
            {
                "nsSlot": NS_SLOT,
                "resident": resident,
                "physAddr": phys_addr,
                "lumpSize": lump_size,
            }
        ]
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_catalog_and_lumps_dir(tmp_path):
    """
    Patch _load_lump_catalog to return a predictable single-entry catalog and
    point LUMPS_DIR at a tmp directory that contains no 00000300.lump so
    _validate_step2 always falls back to BOOT_ABSTR_DEFAULT_SIZE (64 words).
    """
    with (
        patch.object(_app_module, "_load_lump_catalog", side_effect=_fake_catalog),
        patch.object(_app_module, "LUMPS_DIR", str(tmp_path)),
    ):
        yield


_NS_TABLE_RESERVE = 0x400  # 1024 words (64 NS entries × 4 words)

TI60_BOARD = "wukong-xc7a100t"  # default board (Ti60 retired, Task #2509)
TI60_RAM = HARDWARE_PROFILES[TI60_BOARD]["totalRamWords"]
TI60_TOTAL_NS = TI60_RAM + _NS_TABLE_RESERVE + 512


def test_wukong_profile_matches_the_synthesized_namespace_bram():
    """Configuration must not promise more memory than a native upload has."""
    profile = HARDWARE_PROFILES[TI60_BOARD]
    assert profile["totalRamWords"] == 16_384
    assert profile["addressBits"] == 16
    assert profile["maxThreadCount"] == 3


# ---------------------------------------------------------------------------
# General _validate_step2 input validation
# ---------------------------------------------------------------------------

class TestValidateStep2General:
    """Tests for the input-validation guards that are board-profile agnostic."""

    def _step1(self):
        return _make_step1(TI60_TOTAL_NS)

    def test_none_step2_returns_none(self):
        """None step2 is a valid no-op (feature not configured)."""
        assert _validate_step2(None, self._step1(), TI60_BOARD) is None

    def test_non_dict_step2_returns_error(self):
        err = _validate_step2("bad-type", self._step1(), TI60_BOARD)
        assert err is not None
        assert "object" in err

    def test_empty_lumps_list_passes(self):
        assert _validate_step2({"lumps": []}, self._step1(), TI60_BOARD) is None

    def test_missing_catalog_slot_rejected(self):
        """A saved lazy selection must name a real catalog slot."""
        missing_slot = NS_SLOT + 1
        err = _validate_step2(
            {"lumps": [{"nsSlot": missing_slot, "resident": False}]},
            self._step1(),
            TI60_BOARD,
        )
        assert err == f"NS slot {missing_slot} is not present in the lump catalog"

    def test_lazy_lump_needs_no_phys_addr(self):
        """Lazy entries (resident=False) need only nsSlot — no physAddr required."""
        step2 = {"lumps": [{"nsSlot": NS_SLOT, "resident": False}]}
        err = _validate_step2(step2, self._step1(), TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_reserved_slot_rejected(self):
        """NS slots 0-3 are foundational and cannot host a resident lump."""
        step2 = {
            "lumps": [{"nsSlot": 0, "resident": True, "physAddr": 500, "lumpSize": 64}]
        }
        err = _validate_step2(step2, self._step1(), TI60_BOARD)
        assert err is not None
        assert "reserved" in err

    def test_duplicate_ns_slot_rejected(self):
        """Two entries for the same NS slot → duplicate error."""
        step2 = {
            "lumps": [
                {"nsSlot": NS_SLOT, "resident": False},
                {"nsSlot": NS_SLOT, "resident": False},
            ]
        }
        err = _validate_step2(step2, self._step1(), TI60_BOARD)
        assert err is not None
        assert "duplicate" in err

    def test_phys_addr_inside_foundation_rejected(self):
        """physAddr that overlaps the foundational footprint → error."""
        phys = FOUNDATION_END - 1  # one word before the end of the foundation
        err = _validate_step2(_make_step2(phys), self._step1(), TI60_BOARD)
        assert err is not None
        assert "foundational" in err

    def test_phys_addr_at_foundation_boundary_passes(self):
        """physAddr exactly equal to foundation_end → first valid placement."""
        phys = FOUNDATION_END  # not inside, not past board ceiling
        err = _validate_step2(_make_step2(phys), self._step1(), TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_resident_lump_missing_phys_addr_rejected(self):
        """Resident lump with no physAddr field → error."""
        step2 = {"lumps": [{"nsSlot": NS_SLOT, "resident": True, "lumpSize": 64}]}
        err = _validate_step2(step2, self._step1(), TI60_BOARD)
        assert err is not None
        assert "physAddr" in err or "non-negative" in err

    def test_overlapping_resident_lumps_rejected(self):
        """Two resident lumps whose address ranges overlap → collision error."""
        entry_a = {
            "nsSlot": NS_SLOT,
            "resident": True,
            "physAddr": FOUNDATION_END,
            "lumpSize": LUMP_SIZE,
        }
        entry_b = {
            "nsSlot": NS_SLOT + 1,
            "resident": True,
            "physAddr": FOUNDATION_END + LUMP_SIZE - 1,
            "lumpSize": LUMP_SIZE,
        }
        # Add a second unreserved slot to the fake catalog so the overlap
        # guard runs before the missing-catalog guard.
        extended_catalog = [
            FAKE_CATALOG_ENTRY,
            {
                "abstraction": "OtherLump",
                "nsSlot": NS_SLOT + 1,
                "lumpSize": LUMP_SIZE,
                "token": "aabbccdd",
            },
        ]
        with patch.object(_app_module, "_load_lump_catalog", return_value=extended_catalog):
            err = _validate_step2({"lumps": [entry_a, entry_b]}, self._step1(), TI60_BOARD)
        assert err is not None
        assert "overlap" in err

    def test_physical_wukong_rejects_preload_and_accepts_empty_policy(self):
        """The physical board no longer synthesizes a post-boot prefetch engine."""
        preload = {"lumps": [{
            "nsSlot": NS_SLOT, "loadPolicy": "Preload",
            # Hardware-facing identity/capacity are derived catalog bindings;
            # URL, ordering and required/optional are deliberately absent.
            "lumpToken": "deadbeef", "lumpSize": 64,
            "binaryHash": "a" * 64,
        }]}
        err = _validate_step2(preload, self._step1(), TI60_BOARD)
        assert err is not None
        assert "Preload LUMPs are not supported" in err
        empty = {"lumps": [{"nsSlot": NS_SLOT, "loadPolicy": "Empty"}]}
        assert _validate_step2(empty, self._step1(), TI60_BOARD) is None
        invalid = {"lumps": [{"nsSlot": NS_SLOT, "loadPolicy": "Prefetch"}]}
        assert "invalid loadPolicy" in _validate_step2(
            invalid, self._step1(), TI60_BOARD)

    def test_physical_wukong_preload_post_is_rejected(
            self, monkeypatch, tmp_path):
        """The API fails clearly instead of saving an ignored preload request."""
        monkeypatch.setattr(_app_module, "BOOT_CONFIG_PATH", str(tmp_path / "boot-config.json"))
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps([{
            "abstraction": "TestLump",
            "token": "deadbeef",
            "archived": False,
        }]))
        monkeypatch.setattr(_app_module, "LUMPS_MANIFEST_PATH", str(manifest_path))
        payload = {
            "targetBoard": TI60_BOARD,
            "step1": dict(DEFAULT_BOOT_CONFIG["step1"]),
            "step2": {"lumps": [{
                "nsSlot": NS_SLOT,
                "loadPolicy": "Preload",
                "abstraction": "TestLump",
                "lumpToken": "deadbeef",
                "lumpSize": LUMP_SIZE,
                # The server derives this binding when the policy control only
                # supplies the selected Namespace slot.
            }]},
            "step3": {"emptySlotCount": 0},
        }
        with _app_module.app.test_client() as client:
            response = client.post("/api/boot-config", json=payload)
        assert response.status_code == 400, response.get_json()
        assert "Preload LUMPs are not supported" in response.get_json()["error"]

    def test_canonical_preload_rejects_forged_catalog_bindings(self, monkeypatch, tmp_path):
        """A client cannot substitute a plausible hash or capacity for catalog truth."""
        monkeypatch.setattr(_app_module, "BOOT_CONFIG_PATH", str(tmp_path / "boot-config.json"))
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps([{
            "abstraction": "TestLump", "token": "deadbeef", "archived": False,
        }]))
        monkeypatch.setattr(_app_module, "LUMPS_MANIFEST_PATH", str(manifest_path))
        payload = {
            "targetBoard": TI60_BOARD,
            "step1": dict(DEFAULT_BOOT_CONFIG["step1"]),
            "step2": {"lumps": [{
                "nsSlot": NS_SLOT, "loadPolicy": "Preload",
                "abstraction": "TestLump", "lumpToken": "deadbeef",
                "lumpSize": 128, "binaryHash": "b" * 64,
            }]},
            "step3": {"emptySlotCount": 0},
        }
        with _app_module.app.test_client() as client:
            response = client.post("/api/boot-config", json=payload)
        assert response.status_code == 400
        assert "does not match its canonical catalog record" in response.get_json()["error"]


# ---------------------------------------------------------------------------
# Thread foundation geometry
# ---------------------------------------------------------------------------

class TestValidateStep1ThreadGeometry:
    """The default Thread allocation must fit its fixed capability zone."""

    def test_default_thread_size_is_valid(self):
        step1 = dict(DEFAULT_BOOT_CONFIG["step1"])
        assert _validate_step1(DEFAULT_BOOT_CONFIG["targetBoard"], step1) is None
        assert step1["threadLumpWords"] >= 256

    def test_undersized_thread_is_rejected_before_image_generation(self):
        step1 = dict(DEFAULT_BOOT_CONFIG["step1"])
        step1["threadLumpWords"] = 64
        err = _validate_step1(DEFAULT_BOOT_CONFIG["targetBoard"], step1)
        assert err is not None
        assert "threadLumpWords must be at least 256" in err

    def test_generated_thread_slots_are_reserved_and_need_namespace_capacity(self):
        step1 = _make_step1(16384)
        step1["threadCount"] = 2
        collision = {"lumps": [{"nsSlot": 11, "loadPolicy": "Empty"}]}
        err = _validate_step2(collision, step1, TI60_BOARD)
        assert err is not None
        assert "Thread#2" in err

        step1["nsSlotsMax"] = 11
        err = _validate_step1(TI60_BOARD, step1)
        assert err is not None
        assert "cannot hold" in err

    def test_resident_lump_cannot_overlap_generated_thread_memory(self):
        step1 = _make_step1(16384)
        step1["threadCount"] = 2
        # Thread#2 occupies words 576..831 in the canonical boot layout.
        err = _validate_step2(_make_step2(640, lump_size=256), step1, TI60_BOARD)
        assert err is not None
        assert "foundational" in err

    def test_boot_config_exposes_fixed_selftest_size_for_builder_placement(self, tmp_path):
        """Builder receives slot-6's size, not a selected lightning-bolt target."""
        words = [0] * 512
        words[0] = (0x1F << 27) | (3 << 23) | (3 << 10) | 2
        (tmp_path / "00000600.lump").write_bytes(struct.pack(">512I", *words))
        (tmp_path / "manifest.json").write_text(json.dumps([{
            "token": "00000600",
            "abstraction": "SelfTest",
            "ns_slot": 6,
            "ns_slot_policy": "static",
        }]))
        (tmp_path / "ns-state.json").write_text(json.dumps({
            "abstractions": [{"name": "SelfTest", "slot": 6, "token": "00000600"}],
        }))
        with (
            patch.object(_app_module, "LUMPS_DIR", str(tmp_path)),
            patch.object(_app_module, "BOOT_CONFIG_PATH", str(tmp_path / "none.json")),
            patch.object(_app_module, "BOOT_CONFIG_LEGACY_PATH", str(tmp_path / "none-legacy.json")),
        ):
            response = _app_module.app.test_client().get("/api/boot-config")
        assert response.status_code == 200
        assert response.get_json()["limits"]["bootAbstrLumpWords"] == 512


# ---------------------------------------------------------------------------
# Usable namespace region check (Task #1188)
#
# usable_end = totalNamespaceWords - NS_TABLE_RESERVE  (NS_TABLE_RESERVE = 0x400 = 1024)
# A resident lump fails when:  phys + lump_size > usable_end
#
# Two distinct totalNamespaceWords values are exercised so the ceiling is
# parameterised rather than hard-coded.  The physAddr values used here are
# all far below the Ti60 F225 board-RAM ceiling, so the
# board-RAM check never fires first — the usable-end check is the binding
# constraint throughout this class.
# ---------------------------------------------------------------------------

# Profile A — small namespace window
# usable_end_A = FOUNDATION_END + LUMP_SIZE + 100  = 384 + 64 + 100 = 548
_SMALL_NS_TOTAL = FOUNDATION_END + LUMP_SIZE + 100 + _NS_TABLE_RESERVE   # 1572
_USABLE_END_A   = _SMALL_NS_TOTAL - _NS_TABLE_RESERVE                    # 548

# Profile B — medium namespace window (distinct totalNamespaceWords)
# usable_end_B = FOUNDATION_END + LUMP_SIZE + 500  = 384 + 64 + 500 = 948
_MEDIUM_NS_TOTAL = FOUNDATION_END + LUMP_SIZE + 500 + _NS_TABLE_RESERVE  # 1972
_USABLE_END_B    = _MEDIUM_NS_TOTAL - _NS_TABLE_RESERVE                  # 948


class TestUsableNamespaceRegion:
    """
    Tests for the usable-namespace-region guard in _validate_step2.

    The check is: phys + lump_size > usable_end → error containing
    "usable namespace region".

    Two distinct totalNamespaceWords values (small / medium) are exercised
    so the ceiling boundary is parameterised rather than implied by a single
    constant.
    """

    # --- Profile A (totalNamespaceWords = 1380, usable_end = 612) -----------

    def test_within_usable_region_profile_a_passes(self):
        """Lump well inside usable_end for the small namespace profile → no error."""
        phys = FOUNDATION_END               # 448; end = 512 < 612
        step1 = _make_step1(_SMALL_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_exactly_at_usable_boundary_profile_a_passes(self):
        """Lump whose last word is exactly usable_end → boundary is inclusive, no error."""
        phys = _USABLE_END_A - LUMP_SIZE    # 548; end = 612 == usable_end_A
        step1 = _make_step1(_SMALL_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_one_word_past_usable_boundary_profile_a_fails(self):
        """Lump extending one word past usable_end → validation error."""
        phys = _USABLE_END_A - LUMP_SIZE + 1  # 549; end = 613 > 612
        step1 = _make_step1(_SMALL_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is not None, "expected a validation error but got None"
        assert "usable namespace region" in err, f"unexpected error text: {err!r}"

    def test_error_names_the_usable_end_profile_a(self):
        """Out-of-range error message includes the numeric usable_end address."""
        phys = _USABLE_END_A - LUMP_SIZE + 1
        step1 = _make_step1(_SMALL_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is not None
        assert str(_USABLE_END_A) in err, (
            f"usable_end ({_USABLE_END_A}) not mentioned in error: {err!r}"
        )

    def test_error_names_the_abstraction_profile_a(self):
        """Out-of-range error message includes the abstraction name."""
        phys = _USABLE_END_A - LUMP_SIZE + 1
        step1 = _make_step1(_SMALL_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is not None
        assert FAKE_CATALOG_ENTRY["abstraction"] in err, (
            f"abstraction name not in error: {err!r}"
        )

    # --- Profile B (totalNamespaceWords = 1780, usable_end = 1012) ----------

    def test_within_usable_region_profile_b_passes(self):
        """Lump well inside usable_end for the medium namespace profile → no error."""
        phys = FOUNDATION_END               # 448; end = 512 < 1012
        step1 = _make_step1(_MEDIUM_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_exactly_at_usable_boundary_profile_b_passes(self):
        """Lump ending exactly at usable_end for profile B → boundary is inclusive, no error."""
        phys = _USABLE_END_B - LUMP_SIZE    # 948; end = 1012 == usable_end_B
        step1 = _make_step1(_MEDIUM_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is None, f"expected no error but got: {err!r}"

    def test_one_word_past_usable_boundary_profile_b_fails(self):
        """Lump extending one word past usable_end for profile B → validation error."""
        phys = _USABLE_END_B - LUMP_SIZE + 1  # 949; end = 1013 > 1012
        step1 = _make_step1(_MEDIUM_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is not None, "expected a validation error but got None"
        assert "usable namespace region" in err, f"unexpected error text: {err!r}"

    def test_error_names_the_usable_end_profile_b(self):
        """Out-of-range error message includes the numeric usable_end address for profile B."""
        phys = _USABLE_END_B - LUMP_SIZE + 1
        step1 = _make_step1(_MEDIUM_NS_TOTAL)
        err = _validate_step2(_make_step2(phys), step1, TI60_BOARD)
        assert err is not None
        assert str(_USABLE_END_B) in err, (
            f"usable_end ({_USABLE_END_B}) not mentioned in error: {err!r}"
        )
