"""Regression test: _validate_step2 uses the actual saved Boot.Abstr size.

Task #568: When 00000300.lump declares a size larger than the 64w default,
resident step-2 lumps that fall inside the larger Boot.Abstr region must be
rejected. Without this fix, physAddr=450 would pass validation (assuming only
the 64w default, foundation_end=448) but then collide with Boot.Abstr in the
generated image (128w Boot.Abstr → foundation_end=512, covers 384..511).
"""
import os
import struct
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)


def _make_abstr_lump_bytes(size_words, cw=17, cc=18):
    """Return big-endian bytes for a minimal Boot.Abstr lump header + zero body.

    Header encoding (Task #568 big-endian saved-lump convention):
      [31:27] magic = 0x1F
      [26:23] n_minus_6  (size = 1 << (n_minus_6 + 6))
      [22:10] cw
      [ 9: 8] typ (0)
      [ 7: 0] cc
    """
    import math
    n_minus_6 = int(math.log2(size_words)) - 6
    hdr = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc
    return struct.pack('>I', hdr) + b'\x00' * (size_words * 4 - 4)


_FAKE_CATALOG = [
    {
        "nsSlot":      10,
        "abstraction": "TestLump",
        "lumpSize":    64,
        "token":       "deadbeef",
    }
]


def _call_validate(tmp_path, step2):
    """Call _validate_step2 with LUMPS_DIR → tmp_path and a fake catalog."""
    from server.app import _validate_step2

    step1 = {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords":  64,
        "threadLumpWords":     256,
    }
    with patch('server.app.LUMPS_DIR', str(tmp_path)), \
         patch('server.app._load_lump_catalog', return_value=_FAKE_CATALOG):
        return _validate_step2(step2, step1, "tang-nano-20k")


def test_validate_step2_rejects_lump_in_128w_abstr_region(tmp_path):
    """physAddr=450 overlaps a saved 128w Boot.Abstr (covers 384..511) — must be rejected.

    Foundation layout with 128w Boot.Abstr:
      NS(64) + Thread(256) + Free(64) + Boot.Abstr(128) = 512 (foundation_end)
    physAddr=450 < 512 → overlap → validation error expected.

    Without this fix (64w default only):
      foundation_end = 64+256+64+64 = 448 < 450 → lump would be accepted (bug).
    """
    (tmp_path / '00000300.lump').write_bytes(_make_abstr_lump_bytes(128))

    step2 = {"lumps": [{"nsSlot": 10, "resident": True, "physAddr": 450, "lumpSize": 64}]}
    err = _call_validate(tmp_path, step2)

    assert err is not None, (
        "Expected _validate_step2 to reject physAddr=450 when Boot.Abstr is 128w "
        "(foundation_end=512). Without fix, 64w default would pass it (foundation_end=448)."
    )
    assert "overlap" in err.lower() or "foundational" in err.lower() or "450" in err, (
        f"Error message should describe the overlap. Got: {err!r}"
    )


def test_validate_step2_accepts_lump_beyond_128w_abstr(tmp_path):
    """physAddr=520 is beyond the 128w Boot.Abstr (384..511) — must be accepted."""
    (tmp_path / '00000300.lump').write_bytes(_make_abstr_lump_bytes(128))

    step2 = {"lumps": [{"nsSlot": 10, "resident": True, "physAddr": 520, "lumpSize": 64}]}
    err = _call_validate(tmp_path, step2)

    assert err is None, (
        f"physAddr=520 is beyond 128w Boot.Abstr; should be accepted but got: {err!r}"
    )


def test_validate_step2_uses_64w_default_when_no_saved_lump(tmp_path):
    """Without a saved 00000300.lump, foundation_end uses the 64w default.

    physAddr=450 > foundation_end(=448) → must be accepted.
    """
    step2 = {"lumps": [{"nsSlot": 10, "resident": True, "physAddr": 450, "lumpSize": 64}]}
    err = _call_validate(tmp_path, step2)

    assert err is None, (
        f"No saved lump → 64w default → physAddr=450 should be accepted but got: {err!r}"
    )
