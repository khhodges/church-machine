"""Tests for boot_image.py manifest-based lump lookup (task: slot-based → name-based).

Covers:
  1. find_lump_file_by_abstraction — prefers versioned filename; falls back to token file.
  2. generate_boot_image with boot_entry_slot=7 embeds a valid WukongCallHome lump
     at slot 7's physical location.
  3. generate_boot_image raises a clear, manifest-oriented ValueError (not a cryptic
     file-not-found on a slot-encoded path) when the boot-entry lump is absent.
  4. The legacy 00000600.lump file is NOT required by generate_boot_image; it uses
     the manifest-named versioned file instead.
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
    BOOT_ABSTR_NS_SLOT,
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
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is not None
        assert os.path.basename(result) == "MyAbstr_v3.lump"

    def test_falls_back_to_token_file(self):
        """Token-named file is used when manifest entry has no filename field."""
        token = os.path.join(self.tmpdir, "aabbccdd.lump")
        open(token, "wb").close()
        self._write_manifest([{
            "token": "aabbccdd",
            "abstraction": "MyAbstr",
            "ns_slot": 42,
        }])
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is not None
        assert os.path.basename(result) == "aabbccdd.lump"

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
        result = find_lump_file_by_abstraction(self.tmpdir, "MyAbstr", 42)
        assert result is not None
        assert os.path.basename(result) == "aabbccdd.lump"


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
        THREAD_CAPS_OFFSET = 244
        cr0_gt = words[THREAD_CAPS_OFFSET]
        cr0_slot = cr0_gt & 0x1FF
        assert cr0_slot == 7, (
            f"Thread.caps[0] GT should point to NS slot 7, got slot {cr0_slot} "
            f"(GT=0x{cr0_gt:08x})"
        )

        # Check that the boot-entry slot stored in the image is 7.
        # Stored at ns_table_base - 2.
        from server.boot_image import ns_table_reserve_words, MAX_NS_ENTRIES
        ns_table_base = total - ns_table_reserve_words(MAX_NS_ENTRIES)
        stored_entry_slot = words[ns_table_base - 2] & 0xFF
        assert stored_entry_slot == 7, (
            f"boot_entry_slot stored at ns_table_base-2 should be 7, got {stored_entry_slot}"
        )

        # Slot 7's NS entry word0 is the physical location of the WukongCallHome lump.
        ns_base = _ns_slot_base(total, 7)
        slot7_loc  = words[ns_base]
        slot7_word1 = words[ns_base + 1]
        assert slot7_loc > 0, f"NS slot 7 location should be > 0, got {slot7_loc}"
        assert slot7_word1 != 0, "NS slot 7 word1 should be non-zero (lim17 etc.)"

        # The lump body at slot 7's physAddr should have magic 0x1F in bits[31:27].
        lump_hdr = words[slot7_loc]
        lump_magic = (lump_hdr >> 27) & 0x1F
        assert lump_magic == 0x1F, (
            f"WukongCallHome lump header at physAddr {slot7_loc} has wrong magic "
            f"0x{lump_magic:02x} (expected 0x1F); word=0x{lump_hdr:08x}"
        )

    def test_slot6_unaffected_by_slot7_boot_entry(self):
        """Selecting boot_entry_slot=7 does not corrupt the SelfTest slot 6 entry."""
        cfg = _minimal_cfg()
        image6 = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=6)
        image7 = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=7)
        words6 = _unpack_words(image6)
        words7 = _unpack_words(image7)
        total  = cfg["step1"]["totalNamespaceWords"]
        ns6    = _ns_slot_base(total, 6)
        # NS slot 6 entries should be identical in both images.
        for wi in range(NS_ENTRY_WORDS):
            assert words6[ns6 + wi] == words7[ns6 + wi], (
                f"NS slot 6 word{wi} changed between boot_entry_slot=6 and =7; "
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
        # Empty manifest — no SelfTest entry, no lump file.
        self._write_manifest([])

        cfg = _minimal_cfg()
        with pytest.raises(ValueError) as exc_info:
            generate_boot_image(cfg, self.tmpdir)

        msg = str(exc_info.value).lower()
        # The error should mention "selftest" and "manifest" but NOT a slot-encoded
        # filename like "00000600.lump".
        assert "selftest" in msg, (
            f"Error message should mention 'SelfTest'; got:\n{exc_info.value}"
        )
        assert "manifest" in msg, (
            f"Error message should mention 'manifest'; got:\n{exc_info.value}"
        )
        assert "00000600.lump" not in str(exc_info.value), (
            f"Error message must not reference the legacy physical-slot filename "
            f"'00000600.lump'; got:\n{exc_info.value}"
        )

    def test_manifest_entry_present_but_file_missing_raises_clear_error(self):
        """Clear error when manifest lists SelfTest but the file does not exist."""
        # Manifest says SelfTest_v99.lump exists — but we don't create it.
        self._write_manifest([{
            "token": "00000600",
            "abstraction": "SelfTest",
            "filename": "SelfTest_v99.lump",
            "ns_slot": BOOT_ABSTR_NS_SLOT,
            "ns_slot_policy": "static",
            "boot_resident": True,
        }])

        cfg = _minimal_cfg()
        with pytest.raises(ValueError) as exc_info:
            generate_boot_image(cfg, self.tmpdir)

        msg = str(exc_info.value).lower()
        assert "selftest" in msg
        assert "00000600.lump" not in str(exc_info.value)


if __name__ == "__main__":
    import subprocess, sys as _sys
    result = subprocess.run(
        ["python", "-m", "pytest", __file__, "-v"],
        cwd=ROOT,
    )
    _sys.exit(result.returncode)
