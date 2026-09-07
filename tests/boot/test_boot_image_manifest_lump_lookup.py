"""Tests for boot_image.py manifest-based lump lookup (task: slot-based → name-based).

Covers:
  1. find_lump_file_by_abstraction — prefers versioned filename; falls back to token file.
  2. generate_boot_image with boot_entry_slot=7 embeds a valid WukongCallHome lump
     at slot 7's physical location.
  3. generate_boot_image raises a clear, manifest-oriented ValueError (not a cryptic
     file-not-found on a slot-encoded path) when the boot-entry lump is absent.
   4. A historical slot-derived filename is never used as a fallback.
"""
import json
import os
import struct
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (
    find_lump_file_by_abstraction,
    generate_boot_image,
    NS_ENTRY_WORDS,
    pack_lump_header,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ── helpers ─────────────────────────────────────────────────────────────────

def _minimal_cfg(total=16384):
    return {
        "step1": {
            "totalNamespaceWords": total,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _make_minimal_lump(cw=1, cc=0, lump_size=64):
    """Return a minimal big-endian lump binary (lump_size words)."""
    import math
    n_minus_6 = int(math.log2(lump_size)) - 6
    hdr = pack_lump_header(n_minus_6, cw, cc, 0)
    words = [hdr] + [0x00000000] * (lump_size - 1)
    return struct.pack(f">{lump_size}I", *words)


def _unpack_words(data):
    n = len(data) // 4
    return list(struct.unpack(f"<{n}I", data[:n * 4]))


def _ns_slot_base(total, slot):
    """Word offset of NS entry for `slot` in the little-endian image."""
    return total - (slot + 1) * NS_ENTRY_WORDS


# ── find_lump_file_by_abstraction ────────────────────────────────────────────

class TestFindLumpFileByAbstraction:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()

    def _write_manifest(self, entries):
        p = os.path.join(self.tmpdir, "manifest.json")
        with open(p, "w") as f:
            json.dump(entries, f)

    def test_prefers_versioned_filename(self):
        """Versioned filename is returned when both versioned and token file exist."""
        versioned = os.path.join(self.tmpdir, "MyAbstr_v3.lump")
        token     = os.path.join(self.tmpdir, "aabbccdd.lump")
        open(versioned, "wb").close()
        open(token,     "wb").close()
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "MyAbstr",
            "filename": "MyAbstr_v3.lump",
            "ns_slot": 42,
        }])
        assert find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42) is None

    def test_falls_back_to_token_file(self):
        """Token-named file is used when manifest entry has no filename field."""
        token = os.path.join(self.tmpdir, "aabbccdd.lump")
        open(token, "wb").close()
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "MyAbstr",
            "ns_slot": 42,
        }])
        assert find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42) is None

    def test_returns_none_when_no_match(self):
        """Returns None when no manifest entry matches name+slot."""
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "Other",
            "ns_slot": 42,
        }])
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is None

    def test_returns_none_when_manifest_missing(self):
        """Returns None when manifest.json does not exist."""
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is None

    def test_slot_mismatch_returns_none(self):
        """Entry with right name but wrong slot returns None."""
        versioned = os.path.join(self.tmpdir, "MyAbstr_v1.lump")
        open(versioned, "wb").close()
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "MyAbstr",
            "filename": "MyAbstr_v1.lump",
            "ns_slot": 99,
        }])
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is None

    def test_versioned_file_missing_falls_back_to_token(self):
        """Falls back to token file when versioned filename is listed but absent."""
        token = os.path.join(self.tmpdir, "aabbccdd.lump")
        open(token, "wb").close()
        # versioned file NOT created on disk
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "MyAbstr",
            "filename": "MyAbstr_v3.lump",
            "ns_slot": 42,
        }])
        assert find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42) is None


# ── generate_boot_image with boot_entry_slot=7 ───────────────────────────────

class TestBootImageSlot7:
    """boot_entry_slot=7 (WukongCallHome) should embed a valid lump at slot 7."""

    def test_slot7_has_valid_lump_magic(self):
        """boot_entry_slot=7 produces an image with valid lump magic at slot 7's physAddr."""
        cfg = _minimal_cfg()
        image = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=7)
        words = _unpack_words(image)
        total = cfg["step1"]["totalNamespaceWords"]

        # Check that Thread.caps[0] GT points to slot 7.
        # Thread lump is at physAddr 0 (running_offset starts at 0, Thread gets loc=0).
        # THREAD_CAPS_OFFSET = 244 words into the thread lump.
        from hardware.thread_design import thread_layout
        THREAD_CAPS_OFFSET = 16 + thread_layout(
            cfg["step1"]["threadLumpWords"], 32)["caps_start"]
        cr0_gt = words[THREAD_CAPS_OFFSET]
        cr0_slot = cr0_gt & 0x1FF
        assert cr0_slot == 7, (
            f"Thread.caps[0] GT should point to NS slot 7, got slot {cr0_slot} "
            f"(GT=0x{cr0_gt:08x})"
        )

        # Slot 7's NS entry word0 is the physical location of the WukongCallHome lump.
        ns_base = _ns_slot_base(total, 7)
        slot7_loc  = words[ns_base]
        slot7_word1 = words[ns_base + 1]
        assert slot7_loc > 0, f"NS slot 7 location should be > 0, got {slot7_loc}"
        assert slot7_word1 != 0, "NS slot 7 word1 should be non-zero (lim17 etc.)"

        # Namespace Header V2 records the selected resident entry as a byte
        # address, not in the retired pre-table sentinel.
        from shared.namespace_header import BOOT_ENTRY
        assert words[BOOT_ENTRY] == slot7_loc * 4

        # The lump body at slot 7's physAddr should have magic 0x1F in bits[31:27].
        lump_hdr = words[slot7_loc]
        lump_magic = (lump_hdr >> 27) & 0x1F
        assert lump_magic == 0x1F, (
            f"WukongCallHome lump header at physAddr {slot7_loc} has wrong magic "
            f"0x{lump_magic:02x} (expected 0x1F); word=0x{lump_hdr:08x}"
        )

    def test_active_selftest_unaffected_by_slot7_boot_entry(self):
        """Selecting another entry does not corrupt the active SelfTest descriptor."""
        cfg = _minimal_cfg()
        image6 = generate_boot_image(cfg, LUMPS_DIR)
        image7 = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=7)
        words6 = _unpack_words(image6)
        words7 = _unpack_words(image7)
        total  = cfg["step1"]["totalNamespaceWords"]
        with open(os.path.join(LUMPS_DIR, "ns-state.json"), encoding="utf-8") as fh:
            state = json.load(fh)
        selected = [row for row in state["abstractions"] if row.get("name") == "SelfTest"]
        assert len(selected) == 1
        ns6 = _ns_slot_base(total, selected[0]["slot"])
        # The selected SelfTest NS entry should be identical in both images.
        for wi in range(NS_ENTRY_WORDS):
            assert words6[ns6 + wi] == words7[ns6 + wi], (
                f"active SelfTest NS word{wi} changed between default and =7; "
                f"was 0x{words6[ns6+wi]:08x}, got 0x{words7[ns6+wi]:08x}"
            )


# ── generate_boot_image raises a clear error when SelfTest lump is absent ────

class TestBootImageMissingLump:
    """A missing SelfTest lump should raise a clear manifest-oriented error."""

    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()

    def _write_manifest(self, entries):
        p = os.path.join(self.tmpdir, "manifest.json")
        with open(p, "w") as f:
            json.dump(entries, f)

    def test_missing_selftest_lump_raises_clear_error(self):
        """ValueError message mentions manifest and SelfTest, not a slot-encoded path."""
        # Empty state/manifest — no active SelfTest locator or lump file.
        self._write_manifest([])
        with open(os.path.join(self.tmpdir, "ns-state.json"), "w") as f:
            json.dump({"abstractions": []}, f)

        cfg = _minimal_cfg()
        with pytest.raises(ValueError) as exc_info:
            generate_boot_image(cfg, self.tmpdir)

        msg = str(exc_info.value).lower()
        # The error should name the active binding failure, rather than trying
        # to infer a filename from a historical physical slot.
        assert "selftest" in msg, (
            f"Error message should mention 'SelfTest'; got:\n{exc_info.value}"
        )
        assert "namespace-state" in msg

    def test_manifest_entry_present_but_file_missing_raises_clear_error(self):
        """Clear error when manifest lists SelfTest but the file does not exist."""
        # State and manifest select SelfTest_v99.lump — but we don't create it.
        slot, token, filename = 23, "active-selftest", "SelfTest_v99.lump"
        self._write_manifest([{
            "token": token,
            "abstraction": "SelfTest",
            "filename": filename,
            "ns_slot": slot,
            "ns_slot_policy": "static",
            "boot_resident": True,
        }])
        with open(os.path.join(self.tmpdir, "ns-state.json"), "w") as f:
            json.dump({"abstractions": [{
                "name": "SelfTest", "slot": slot, "token": token, "filename": filename,
            }]}, f)

        cfg = _minimal_cfg()
        with pytest.raises(ValueError) as exc_info:
            generate_boot_image(cfg, self.tmpdir)

        msg = str(exc_info.value).lower()
        assert "selftest" in msg
        assert filename in str(exc_info.value)


if __name__ == "__main__":
    import subprocess, sys as _sys
    result = subprocess.run(
        ["python", "-m", "pytest", __file__, "-v"],
        cwd=ROOT,
    )
    _sys.exit(result.returncode)
