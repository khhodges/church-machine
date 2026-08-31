"""
tests/server/test_boot_image_manifest_ns_slot.py

Legacy drift-diagnostic tests plus regressions confirming that boot_image.py
uses committed Namespace state, not manifest or sidecar history, to select the
artifact occupying a live slot.

Background
----------
PATCH /api/lump/<token>/meta writes to both the sidecar and manifest.json.
If a partial write failure (or a hand-edit) leaves them out of sync,
boot_image.py must still use the manifest value — since that is the only
source it reads.  Silently booting with a stale slot would be very hard to
diagnose, so check_ns_slot_drift() exists to surface the discrepancy early.

Coverage
--------
  D1 — _load_boot_resident_entries uses the exact ns-state binding
  D2 — _load_boot_resident_entries returns nothing for entries without
       boot_resident=true, regardless of sidecar contents
  D3 — check_ns_slot_drift returns a warning when manifest and sidecar disagree
  D4 — check_ns_slot_drift returns no warnings when manifest and sidecar agree
  D5 — check_ns_slot_drift returns no warnings when the sidecar file is absent
  D6 — check_ns_slot_drift returns no warnings when manifest.json is missing
  D7 — check_ns_slot_drift returns no warnings for entries with no sidecar_file
  D8 — warning message includes abstraction name, token, both slot values,
       and explicitly states which value boot_image.py will use
"""

import json
import os
import shutil
import struct
import sys
import warnings

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.boot_image import (
    _load_boot_resident_entries,
    check_ns_slot_drift,
    generate_boot_image,
    BOOT_ABSTR_NS_SLOT,
)

# Real lumps directory — used to borrow the live SelfTest lump for integration tests.
_REAL_LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------

def _write_manifest(lumps_dir, entries):
    (lumps_dir / "manifest.json").write_text(json.dumps(entries))


def _write_sidecar(lumps_dir, filename, data):
    (lumps_dir / filename).write_text(json.dumps(data))


# ---------------------------------------------------------------------------
# D1 — _load_boot_resident_entries uses manifest ns_slot, ignores sidecar
# ---------------------------------------------------------------------------

class TestLoadBootResidentEntriesNamespaceStateWins:

    def test_d1_namespace_state_wins_over_manifest_and_sidecar(self, tmp_path):
        """D1 — exact ns-state slot/token/filename binding is authoritative."""
        token = "ab123456"
        sidecar_file = f"{token}.json"

        # Sidecar says slot 11 — intentionally different from the manifest.
        _write_sidecar(tmp_path, sidecar_file, {
            "token": token,
            "abstraction": "MyAbstr",
            "ns_slot": 11,          # ← stale / diverged value
        })

        # Manifest and sidecar are deliberately stale.
        _write_manifest(tmp_path, [{
            "token":         token,
            "abstraction":   "MyAbstr",
            "sidecar_file":  sidecar_file,
            "filename":      f"{token}.lump",
            "ns_slot":       9,     # ← authoritative value
            "boot_resident": True,
        }])
        (tmp_path / "ns-state.json").write_text(json.dumps({
            "abstractions": [{
                "name": "MyAbstr",
                "slot": 8,
                "type": "Inform",
                "token": "feedbeef",
                "filename": "MyAbstr.current.lump",
                "resident": True,
            }]
        }))

        entries = _load_boot_resident_entries(str(tmp_path / "manifest.json"))

        assert len(entries) == 1, (
            f"Expected exactly one boot-resident entry, got {len(entries)}: {entries}"
        )
        assert entries[0] == (8, "feedbeef", "MyAbstr.current.lump")

    def test_d1_unbound_namespace_state_does_not_fall_back(self, tmp_path):
        """D1 — an unbound state row must not be repaired from historical files."""
        token = "cd789012"
        sidecar_file = f"{token}.json"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token,
            "abstraction": "OtherAbstr",
            "ns_slot": 99,
        })
        _write_manifest(tmp_path, [{
            "token":         token,
            "abstraction":   "OtherAbstr",
            "sidecar_file":  sidecar_file,
            "filename":      f"{token}.lump",
            "ns_slot":       7,
            "boot_resident": True,
        }])
        (tmp_path / "ns-state.json").write_text(json.dumps({
            "abstractions": [{
                "name": "OtherAbstr",
                "slot": 6,
                "type": "Inform",
            }]
        }))

        entries = _load_boot_resident_entries(str(tmp_path / "manifest.json"))
        assert entries == []


# ---------------------------------------------------------------------------
# D2 — boot_resident=False / absent entries are not returned
# ---------------------------------------------------------------------------

class TestLoadBootResidentEntriesFiltering:

    def test_d2_non_boot_resident_entry_excluded(self, tmp_path):
        """D2 — An entry with boot_resident=false is never returned regardless
        of sidecar ns_slot.

        This guards the common case where a user lump has ns_slot set in the
        sidecar but has not been promoted to boot-resident in the manifest.
        """
        token = "ef345678"
        sidecar_file = f"{token}.json"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token,
            "abstraction": "DynamicAbstr",
            "ns_slot": 15,
        })
        _write_manifest(tmp_path, [{
            "token":         token,
            "abstraction":   "DynamicAbstr",
            "sidecar_file":  sidecar_file,
            "filename":      f"{token}.lump",
            "ns_slot":       15,
            "boot_resident": False,   # ← explicitly not boot-resident
        }])

        entries = _load_boot_resident_entries(str(tmp_path / "manifest.json"))
        assert entries == [], (
            f"boot_resident=False entry must not appear in boot-resident list; "
            f"got {entries}"
        )

    def test_d2_missing_boot_resident_key_excluded(self, tmp_path):
        """D2 (variant) — Entry without boot_resident key is excluded."""
        token = "fe654321"
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  "NoKey",
            "filename":     f"{token}.lump",
            "ns_slot":      12,
            # no "boot_resident" key at all
        }])
        entries = _load_boot_resident_entries(str(tmp_path / "manifest.json"))
        assert entries == []


# ---------------------------------------------------------------------------
# D3 — check_ns_slot_drift warns when manifest and sidecar disagree
# ---------------------------------------------------------------------------

class TestCheckNsSlotDrift:

    def test_d3_warning_on_disagreement(self, tmp_path):
        """D3 — check_ns_slot_drift returns a warning when manifest and
        sidecar carry different ns_slot values."""
        token = "aa000001"
        sidecar_file = f"{token}.json"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token, "abstraction": "DriftAbstr",
            "ns_slot": 11,   # sidecar says 11
        })
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  "DriftAbstr",
            "sidecar_file": sidecar_file,
            "ns_slot":      9,          # manifest says 9
        }])

        warnings = check_ns_slot_drift(str(tmp_path))

        assert len(warnings) == 1, (
            f"Expected exactly one drift warning, got {len(warnings)}: {warnings}"
        )

    def test_d4_no_warning_when_slots_agree(self, tmp_path):
        """D4 — check_ns_slot_drift returns [] when manifest and sidecar agree."""
        token = "aa000002"
        sidecar_file = f"{token}.json"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token, "abstraction": "AgreeAbstr",
            "ns_slot": 9,
        })
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  "AgreeAbstr",
            "sidecar_file": sidecar_file,
            "ns_slot":      9,          # same as sidecar
        }])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert warnings == [], f"Expected no warnings when slots agree; got {warnings}"

    def test_d5_no_warning_when_sidecar_absent(self, tmp_path):
        """D5 — Missing sidecar file is silently skipped (no warning, no crash)."""
        token = "aa000003"
        sidecar_file = f"{token}.json"
        # Do NOT create the sidecar file on disk.
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  "AbsentSidecar",
            "sidecar_file": sidecar_file,
            "ns_slot":      9,
        }])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert warnings == [], (
            f"Missing sidecar must be silently skipped; got {warnings}"
        )

    def test_d6_no_warning_when_manifest_missing(self, tmp_path):
        """D6 — Missing manifest.json returns [] without raising."""
        # No manifest.json created.
        warnings = check_ns_slot_drift(str(tmp_path))
        assert warnings == [], (
            f"Missing manifest.json must return [] silently; got {warnings}"
        )

    def test_d7_no_warning_for_entry_without_sidecar_file_key(self, tmp_path):
        """D7 — Manifest entry with no sidecar_file field is skipped cleanly."""
        token = "aa000004"
        _write_manifest(tmp_path, [{
            "token":       token,
            "abstraction": "NoSidecarKey",
            "ns_slot":     9,
            # no "sidecar_file" key — older manifest format
        }])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert warnings == [], (
            f"Entry without sidecar_file must be skipped; got {warnings}"
        )

    def test_d8_warning_message_content(self, tmp_path):
        """D8 — Warning message includes abstraction name, token, both slot
        values, and states that boot_image.py will use the manifest value."""
        token = "bb000001"
        sidecar_file = f"{token}.json"
        abstraction = "ImportantAbstr"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token, "abstraction": abstraction,
            "ns_slot": 20,
        })
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  abstraction,
            "sidecar_file": sidecar_file,
            "ns_slot":      8,
        }])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert len(warnings) == 1
        msg = warnings[0]

        assert abstraction in msg, (
            f"Warning must mention the abstraction name '{abstraction}'; got:\n{msg}"
        )
        assert token in msg, (
            f"Warning must mention the token '{token}'; got:\n{msg}"
        )
        # Both slot values must appear so the operator can see the disagreement.
        assert "8" in msg, (
            f"Warning must include the manifest slot value (8); got:\n{msg}"
        )
        assert "20" in msg, (
            f"Warning must include the sidecar slot value (20); got:\n{msg}"
        )
        # Explicitly state which source wins (the manifest).
        assert "manifest" in msg.lower(), (
            f"Warning must mention 'manifest' to identify the winning source; got:\n{msg}"
        )

    def test_d3_multiple_entries_one_drifted(self, tmp_path):
        """D3 (multi-entry) — Only the diverged entry produces a warning."""
        tok_ok  = "cc000001"
        tok_bad = "cc000002"

        _write_sidecar(tmp_path, f"{tok_ok}.json",  {"token": tok_ok,  "abstraction": "GoodAbstr", "ns_slot": 5})
        _write_sidecar(tmp_path, f"{tok_bad}.json", {"token": tok_bad, "abstraction": "BadAbstr",  "ns_slot": 7})

        _write_manifest(tmp_path, [
            {"token": tok_ok,  "abstraction": "GoodAbstr", "sidecar_file": f"{tok_ok}.json",  "ns_slot": 5},
            {"token": tok_bad, "abstraction": "BadAbstr",  "sidecar_file": f"{tok_bad}.json", "ns_slot": 9},
        ])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert len(warnings) == 1, (
            f"Exactly one entry drifted; expected 1 warning, got {len(warnings)}: {warnings}"
        )
        assert "BadAbstr" in warnings[0], (
            f"Warning should name the drifted abstraction 'BadAbstr'; got:\n{warnings[0]}"
        )

    def test_d4_both_none_slots_agree(self, tmp_path):
        """D4 (None/null) — manifest ns_slot=null and sidecar ns_slot=null agree; no warning."""
        token = "dd000001"
        sidecar_file = f"{token}.json"

        _write_sidecar(tmp_path, sidecar_file, {
            "token": token, "abstraction": "DynamicAbstr", "ns_slot": None,
        })
        _write_manifest(tmp_path, [{
            "token":        token,
            "abstraction":  "DynamicAbstr",
            "sidecar_file": sidecar_file,
            "ns_slot":      None,
        }])

        warnings = check_ns_slot_drift(str(tmp_path))
        assert warnings == [], f"null==null must not produce a warning; got {warnings}"


# ---------------------------------------------------------------------------
# D9 — Integration: generate_boot_image emits UserWarning during a real call
# ---------------------------------------------------------------------------

def _minimal_cfg(total=16384):
    return {
        "step1": {
            "totalNamespaceWords": total,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _seed_lumps_dir_with_selftest(tmp_path):
    """Copy the live SelfTest lump and its manifest entry into tmp_path.

    This gives generate_boot_image the Boot.Abstr lump it requires without
    having to synthesise a valid lump binary from scratch.
    Returns the manifest entry list (one SelfTest entry).
    """
    import json as _json

    real_mf = os.path.join(_REAL_LUMPS_DIR, "manifest.json")
    with open(real_mf) as f:
        real_entries = _json.load(f)

    # Find the SelfTest entry and copy its lump file.
    st_entry = next(
        (e for e in real_entries
         if isinstance(e, dict) and e.get("abstraction") == "SelfTest"
         and e.get("ns_slot") == BOOT_ABSTR_NS_SLOT),
        None,
    )
    if st_entry is None:
        pytest.skip("No SelfTest lump in server/lumps — cannot run integration test")

    # Copy the lump file (versioned filename preferred, fallback to token.lump).
    fname = st_entry.get("filename") or f"{st_entry['token']}.lump"
    src = os.path.join(_REAL_LUMPS_DIR, fname)
    if not os.path.isfile(src):
        src = os.path.join(_REAL_LUMPS_DIR, f"{st_entry['token']}.lump")
    if not os.path.isfile(src):
        pytest.skip(f"SelfTest lump file not found: {src}")

    shutil.copy(src, str(tmp_path / fname))
    # Also copy token.lump as fallback if different from fname.
    tok_lump = f"{st_entry['token']}.lump"
    if tok_lump != fname:
        tok_src = os.path.join(_REAL_LUMPS_DIR, tok_lump)
        if os.path.isfile(tok_src):
            shutil.copy(tok_src, str(tmp_path / tok_lump))

    return [st_entry]


class TestGenerateBootImageDriftWarning:
    """Historical drift diagnostics must not influence image generation."""

    def test_d9_manifest_sidecar_drift_is_not_boot_authority(self, tmp_path):
        """D9 — stale historical slot claims are ignored by generation."""
        # Seed the lumps dir with a real SelfTest lump so generate_boot_image
        # can proceed past the Boot.Abstr lookup.
        manifest_entries = _seed_lumps_dir_with_selftest(tmp_path)

        # Add a user lump whose sidecar disagrees with the manifest ns_slot.
        user_token = "ee000001"
        user_sidecar_file = f"{user_token}.json"
        _write_sidecar(tmp_path, user_sidecar_file, {
            "token": user_token,
            "abstraction": "UserAbstr",
            "ns_slot": 20,          # sidecar says 20
        })
        manifest_entries.append({
            "token":        user_token,
            "abstraction":  "UserAbstr",
            "sidecar_file": user_sidecar_file,
            "filename":     f"{user_token}.lump",
            "ns_slot":      15,     # manifest says 15 — intentional mismatch
        })
        _write_manifest(tmp_path, manifest_entries)

        cfg = _minimal_cfg()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            generate_boot_image(cfg, str(tmp_path))
        assert not [w for w in caught if "ns_slot mismatch" in str(w.message)]

    def test_d9_no_spurious_warning_when_all_slots_agree(self, tmp_path):
        """D9 (negative) — generate_boot_image emits no UserWarning when
        manifest and sidecar ns_slot values agree for all entries.
        """
        manifest_entries = _seed_lumps_dir_with_selftest(tmp_path)

        user_token = "ee000002"
        user_sidecar_file = f"{user_token}.json"
        _write_sidecar(tmp_path, user_sidecar_file, {
            "token": user_token,
            "abstraction": "UserAbstrOK",
            "ns_slot": 15,          # sidecar agrees with manifest
        })
        manifest_entries.append({
            "token":        user_token,
            "abstraction":  "UserAbstrOK",
            "sidecar_file": user_sidecar_file,
            "filename":     f"{user_token}.lump",
            "ns_slot":      15,     # same as sidecar
        })
        _write_manifest(tmp_path, manifest_entries)

        cfg = _minimal_cfg()
        import warnings as _warnings
        with _warnings.catch_warnings(record=True) as caught:
            _warnings.simplefilter("always")
            generate_boot_image(cfg, str(tmp_path))

        drift_warnings = [
            w for w in caught
            if issubclass(w.category, UserWarning)
            and "ns_slot mismatch" in str(w.message)
        ]
        assert drift_warnings == [], (
            f"Expected no ns_slot mismatch warnings when all slots agree; "
            f"got: {[str(w.message) for w in drift_warnings]}"
        )
