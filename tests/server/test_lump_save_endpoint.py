"""
tests/server/test_lump_save_endpoint.py

End-to-end server tests for /api/lumps/save and its interaction with
/api/lumps/list.  Every test uses an isolated temporary lumps directory so
it never touches server/lumps/ at runtime.

Coverage
--------
  T1 — compact binary saves successfully:
       POST a LUMP whose word array is shorter than lump_size (client sends
       only non-zero words).  Server must pad to lump_size, inject the
       identity self-GT into c-list[0], return HTTP 200 with ok=true and a
       token, and the token must appear in the next /api/lumps/list response.

  T2 — c-list slot out-of-bounds returns 422:
       POST the same compact header with a code word whose c-list slot index
       equals cc (one past the end).  Server must return HTTP 422 with
       clist_inconsistent=true — no file must be written.

  T3 — error response has the fields the client error-surface code needs:
       When /api/lumps/save returns 422, the JSON body must contain an
       "error" string so _lumpSaveHandleResponse() in lump_save_handler.js
       can surface it in a toast.
"""

import json
import os
import struct
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

# ---------------------------------------------------------------------------
# LUMP binary construction helpers
# ---------------------------------------------------------------------------

# Header field constants
_MAGIC   = 0x1F << 27   # bits[31:27] = 0x1F
_N_M6    = 0            # encodes lump_size = 1 << (0+6) = 64 words
_LUMP_SZ = 64           # words when n_m6 = 0


def _hdr(cw: int, cc: int, n_m6: int = _N_M6, typ: int = 0) -> int:
    """Build a valid LUMP header word.

    Bit layout (server decodes with these masks):
      [31:27] = 0x1F  (magic)
      [26:23] = n_m6  (lump_size = 1<<(n_m6+6))
      [22:10] = cw    (code word count, 13-bit field)
      [9:8]   = typ   (content type: 0=code)
      [7:0]   = cc    (c-list entry count)
    """
    return (
        _MAGIC
        | ((n_m6 & 0xF) << 23)
        | ((cw & 0x1FFF) << 10)
        | ((typ & 0x3) << 8)
        | (cc & 0xFF)
    ) & 0xFFFFFFFF


def _compact_valid_words(cw: int = 1, cc: int = 1) -> list:
    """Return a compact binary (header + one NOP — much shorter than lump_size=64).

    The server must pad to lump_size before writing.  The endpoint requires
    len(words) >= 2 (header + at least one code word), so a single NOP
    (0x00000000) is the minimal complement.
    """
    return [_hdr(cw, cc), 0]  # header + one NOP; lump_size=64 but only 2 words sent


def _compact_clist_oob_words(cc: int = 1) -> list:
    """Return a compact binary whose code word references c-list slot == cc.

    LOAD (op=0), crSrc=6 (c-list register), slot=cc (out-of-bounds).
    Server decode: op = (word>>27)&0x1F, crSrc = (word>>15)&0xF, slot = word&0x7FFF.
    """
    bad_load = (0 << 27) | (6 << 15) | cc  # slot == cc ≥ cc → rejected
    return [_hdr(cw=1, cc=cc), bad_load]


def _meta(token: str, abstraction: str = "LumpSaveTest") -> dict:
    return {
        "token":        token,
        "abstraction":  abstraction,
        "content_type": "code",
        "language":     "assembly",
        "ns_slot":      None,
        "capabilities": [],
        "methods":      [],
        "grants":       ["E"],
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_lumps(tmp_path, monkeypatch):
    """Redirect the server's lumps directory to a fresh temp directory.

    save_lump() builds lumps_dir via:
        os.path.join(os.path.dirname(__file__), 'lumps')
    where __file__ is server/app.py.  Monkeypatching _app_module.__file__ to
    a path inside tmp_path makes os.path.dirname(__file__) return tmp_path,
    so lumps_dir = tmp_path/lumps — isolated from the live server/lumps/.
    """
    fake_app_py = tmp_path / "app.py"
    monkeypatch.setattr(_app_module, "__file__", str(fake_app_py))
    lumps_dir = tmp_path / "lumps"
    lumps_dir.mkdir()
    # Seed an empty manifest so list_lumps() doesn't error on missing file.
    (lumps_dir / "manifest.json").write_text("[]")
    return lumps_dir


@pytest.fixture()
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# T1 — compact binary saves successfully
# ---------------------------------------------------------------------------

class TestCompactBinarySave:
    """Compact binary (shorter than lump_size) must be padded and saved."""

    TOKEN = "7c501001"

    def test_compact_binary_returns_200(self, client, isolated_lumps):
        """POST a compact binary (header + NOP) — expect HTTP 200."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200, (
            f"Expected 200 for compact binary, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )

    def test_compact_binary_response_ok_and_token(self, client, isolated_lumps):
        """Response must have ok=true and return a token string."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("ok") is True, f"Expected ok=True in response, got: {data}"
        assert data.get("token"), f"Expected a non-empty token in response, got: {data}"

    def test_compact_binary_appears_in_list(self, client, isolated_lumps):
        """After a successful save, the token must appear in /api/lumps/list."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200
        saved_token = resp.get_json().get("token")
        assert saved_token, "Save response did not return a token"

        list_resp = client.get("/api/lumps/list")
        assert list_resp.status_code == 200
        lumps = list_resp.get_json()
        tokens_in_list = [e.get("token") for e in lumps]
        assert saved_token in tokens_in_list, (
            f"Token {saved_token!r} not found in /api/lumps/list after save. "
            f"Tokens present: {tokens_in_list}"
        )

    def test_compact_binary_padded_on_disk(self, client, isolated_lumps):
        """The saved .lump file must be padded to the full lump_size on disk."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        lump_filename = data.get("lump", "")
        assert lump_filename, f"Response missing 'lump' filename: {data}"

        lump_path = isolated_lumps / lump_filename
        assert lump_path.is_file(), f"Saved lump file not found at {lump_path}"

        word_count = lump_path.stat().st_size // 4
        assert word_count == _LUMP_SZ, (
            f"Expected padded lump of {_LUMP_SZ} words on disk, "
            f"found {word_count} words ({lump_path.stat().st_size} bytes)"
        )

    def test_compact_binary_self_gt_injected(self, client, isolated_lumps):
        """After saving a compact binary, c-list[0] must hold the expected self-GT."""
        import hashlib
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        identity_string = data.get("identity_string", "")
        assert identity_string, f"Response missing identity_string: {data}"
        lump_filename = data.get("lump", "")
        lump_path = isolated_lumps / lump_filename
        assert lump_path.is_file()

        raw = lump_path.read_bytes()
        words = struct.unpack(f">{len(raw) // 4}I", raw)
        hdr = words[0]
        lsz = 1 << (((hdr >> 23) & 0xF) + 6)
        cc  = hdr & 0xFF
        idx = lsz - cc
        assert 0 < idx < len(words), (
            f"c-list row0 index {idx} out of range for lump of {len(words)} words"
        )
        actual_gt = words[idx]

        h32 = int(hashlib.sha256(identity_string.encode()).hexdigest()[:8], 16)
        expected_gt = (0x0A000000 | (h32 & 0x1FFFFFF)) & 0xFFFFFFFF
        assert actual_gt == expected_gt, (
            f"c-list[0] on disk = {actual_gt:#010x} but expected self-GT "
            f"{expected_gt:#010x} for identity_string={identity_string!r}"
        )


# ---------------------------------------------------------------------------
# T2 — c-list slot out-of-bounds returns 422 with clist_inconsistent=true
# ---------------------------------------------------------------------------

class TestClistInconsistencyRejection:
    """A code LUMP whose code word references c-list slot >= cc must be rejected."""

    TOKEN = "7c502001"

    def test_oob_slot_returns_422(self, client, isolated_lumps):
        """Code word with slot >= cc must return HTTP 422."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for out-of-bounds c-list slot, "
            f"got {resp.status_code}. Body: {resp.get_data(as_text=True)}"
        )

    def test_oob_slot_body_has_clist_inconsistent(self, client, isolated_lumps):
        """422 body must have clist_inconsistent=true."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422
        data = resp.get_json()
        assert data.get("clist_inconsistent") is True, (
            f"Expected clist_inconsistent=True in 422 body, got: {data}"
        )

    def test_oob_slot_body_has_error_string(self, client, isolated_lumps):
        """422 body must include a human-readable error string for the client toast."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422
        data = resp.get_json()
        assert isinstance(data.get("error"), str) and data["error"], (
            f"422 body must have a non-empty error string; got: {data}"
        )

    def test_oob_slot_body_names_bad_word_and_slot(self, client, isolated_lumps):
        """422 body must report bad_code_word and bad_slot for actionable diagnostics."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422
        data = resp.get_json()
        assert "bad_code_word" in data, f"422 body must include bad_code_word; got: {data}"
        assert "bad_slot" in data,      f"422 body must include bad_slot; got: {data}"
        assert "cc" in data,            f"422 body must include cc; got: {data}"
        assert data["bad_slot"] >= data["cc"], (
            f"bad_slot={data['bad_slot']} should be >= cc={data['cc']}"
        )

    def test_oob_slot_no_file_written(self, client, isolated_lumps):
        """Rejection must not write any .lump file for the test token."""
        before = set(isolated_lumps.iterdir())
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422
        after = set(isolated_lumps.iterdir())
        new_lumps = [f for f in (after - before) if f.suffix == ".lump"]
        assert not new_lumps, (
            f"c-list inconsistency rejection must not write any .lump file; "
            f"new files on disk: {sorted(f.name for f in (after - before))}"
        )

    def test_valid_binary_not_rejected(self, client, isolated_lumps):
        """Control: a LOAD from slot 1 with cc=2 (slot 1 < cc=2) must save cleanly."""
        token = "7c502002"
        # LOAD from c-list slot 1, cc=2: slot=1 < cc=2 → valid
        good_load = (0 << 27) | (6 << 15) | 1
        binary = [_hdr(cw=1, cc=2), good_load]
        resp = client.post(
            "/api/lumps/save",
            json={"binary": binary, "metadata": _meta(token)},
        )
        assert resp.status_code == 200, (
            f"Valid c-list reference should not be rejected; "
            f"got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        assert resp.get_json().get("ok") is True


# ---------------------------------------------------------------------------
# T3 — error response shape matches what the client error-surface code expects
# ---------------------------------------------------------------------------

class TestErrorResponseShape:
    """The 422 response body must have the shape that _lumpSaveHandleResponse()
    in lump_save_handler.js checks before firing the error toast."""

    TOKEN = "7c503001"

    def test_422_has_top_level_error_key(self, client, isolated_lumps):
        """Client code: (resp && resp.error) ? resp.error : 'HTTP N'
        so 'error' must be at the top level of the JSON body."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code != 200
        data = resp.get_json()
        assert "error" in data, (
            f"Error response must have a top-level 'error' key; got keys: {list(data.keys())}"
        )
        assert isinstance(data["error"], str) and data["error"].strip(), (
            f"'error' must be a non-empty string; got: {data['error']!r}"
        )

    def test_422_error_message_is_informative(self, client, isolated_lumps):
        """The error string must mention slot and cc so the user knows what to fix."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_clist_oob_words(cc=1), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 422
        err = resp.get_json().get("error", "")
        assert "slot" in err.lower() or "c-list" in err.lower(), (
            f"Error message should reference 'slot' or 'c-list'; got: {err!r}"
        )

    def test_ok_response_has_token_for_registry_update(self, client, isolated_lumps):
        """Client: window.LumpRegistry.setCurrent(resp.token) — token must be present."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _compact_valid_words(), "metadata": _meta(self.TOKEN)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("ok") is True, f"Successful save must have ok=True; got: {data}"
        assert data.get("token") and isinstance(data["token"], str), (
            f"Successful save must return a non-empty string 'token'; got: {data}"
        )


# ---------------------------------------------------------------------------
# T4 — ELOADCALL / XLOADLAMBDA with methodIdx ≥ 1 must NOT be false-rejected
# ---------------------------------------------------------------------------
#
# Live compiler/assembler encoding (simulator/assembler.js, cloomc_compiler.js):
#   ELOADCALL (op=8): imm15 = (method_index << 5) | row  — 5-bit row, 7-bit method
#   XLOADLAMBDA (op=9): imm15 = direct c-list slot (assembler.js case 9: `imm = slot`)
#   LOAD/SAVE (ops 0,1): imm15 = c-list slot (5-bit, 0–31)
#
# The old server bug used (word & 0x7FFF) for all four opcodes, folding the
# method-index bits into the slot for ELOADCALL.  For example, method_index=1,
# row=0 gives imm15 = 32; old mask: slot=32 ≥ cc=5 → false 422.
# The fix: ELOADCALL uses & 0x1F (row in bits[4:0]); XLOADLAMBDA uses & 0x7FFF.

def _eloadcall_word(cr_src: int, method_idx: int, row: int) -> int:
    """Build an ELOADCALL instruction word (opcode=8).

    Live compiler/assembler encoding (cloomc_compiler.js):
      bits[31:27] = opcode = 8
      bits[18:15] = crSrc  (4-bit field)
      imm15[11:5] = method_index (7-bit, 1-based)
      imm15[4:0]  = c-list row   (5-bit, 0–31)
      → imm15 = (method_index << 5) | (row & 0x1F)
    """
    imm15 = ((method_idx & 0x7F) << 5) | (row & 0x1F)
    return ((8 << 27) | (cr_src << 15) | imm15) & 0xFFFFFFFF


def _xloadlambda_word(cr_src: int, slot: int) -> int:
    """Build an XLOADLAMBDA instruction word (opcode=9).

    XLOADLAMBDA is only emitted by raw assembly (never by the CLOOMC compiler).
    The assembler encodes it with imm15 = direct c-list slot (assembler.js case 9).
      bits[31:27] = opcode = 9
      bits[18:15] = crSrc  (4-bit field)
      bits[14:0]  = slot   (direct 15-bit value; server extracts via & 0x7FFF)
    """
    return ((9 << 27) | (cr_src << 15) | (slot & 0x7FFF)) & 0xFFFFFFFF


class TestEloadcallFalsePositiveFix:
    """ELOADCALL with method_index ≥ 1 must not produce a false 422.

    The server extracts the c-list row using opcode-specific masks:
      ELOADCALL (op=8):   slot = word & 0x1F    (row in imm15[4:0])
      XLOADLAMBDA (op=9): slot = word & 0x7FFF  (direct slot)
    With method_index=1 and row=0, imm15 = 32; old 0x7FFF mask: slot=32 ≥ cc=5
    → false 422.  Correct 0x1F mask: slot = 0 < cc=5 → 200 ✓
    """

    CC = 5  # enough c-list entries that row=0..4 are all valid

    def _binary(self, instr_word: int) -> list:
        """Header (typ=0, cw=1, cc=CC) + the given instruction word."""
        return [_hdr(cw=1, cc=self.CC), instr_word]

    # ── ELOADCALL: false-positive regression (the original bug) ───────────────

    def test_eloadcall_method1_row0_returns_200(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=1, row=0, cc=5 — must return 200.

        imm15 = (1 << 5) | 0 = 32.
        Old mask (0x7FFF): slot = 32 ≥ cc=5 → false 422.
        Correct mask (0x1F): row  = 0   < cc=5 → 200 ✓
        """
        word = _eloadcall_word(cr_src=6, method_idx=1, row=0)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504001")},
        )
        assert resp.status_code == 200, (
            f"ELOADCALL method_index=1, row=0 should not be rejected as "
            f"c-list out-of-bounds. Got {resp.status_code}: "
            f"{resp.get_data(as_text=True)}"
        )
        assert resp.get_json().get("ok") is True

    def test_eloadcall_method7_row0_returns_200(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=7, row=0, cc=5 — must return 200.

        imm15 = (7 << 5) | 0 = 224.
        Old mask: slot = 224 (false reject).  Correct 0x1F mask: slot = 0 ✓
        """
        word = _eloadcall_word(cr_src=6, method_idx=7, row=0)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504002")},
        )
        assert resp.status_code == 200, (
            f"ELOADCALL method_index=7, row=0 wrongly rejected. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )

    def test_eloadcall_method1_row4_returns_200(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=1, row=4, cc=5 — row=4 < cc=5, valid.

        imm15 = (1 << 5) | 4 = 36.  Correct mask: slot = 36 & 0x1F = 4 < cc=5 ✓
        """
        word = _eloadcall_word(cr_src=6, method_idx=1, row=4)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504003")},
        )
        assert resp.status_code == 200, (
            f"ELOADCALL method_index=1, row=4 (< cc=5) should be accepted. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )

    def test_eloadcall_method127_row0_returns_200(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=127 (max), row=0, cc=5 — must return 200.

        imm15 = (127 << 5) | 0 = 4064; old 0x7FFF mask: slot=4064 ≥ cc=5 → false 422.
        Fixed 0x1F mask: slot = 4064 & 0x1F = 0 < cc=5 ✓
        """
        word = _eloadcall_word(cr_src=6, method_idx=127, row=0)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504003b")},
        )
        assert resp.status_code == 200, (
            f"ELOADCALL method_index=127 (max), row=0 should not be rejected. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )

    # ── ELOADCALL: genuine OOB detection ─────────────────────────────────────

    def test_eloadcall_row_oob_returns_422(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=0, row=5, cc=5 — row=5 ≥ cc=5, genuinely OOB.

        imm15 = (0 << 5) | 5 = 5; slot = 5 & 0x1F = 5 ≥ cc=5 → 422 ✓
        """
        word = _eloadcall_word(cr_src=6, method_idx=0, row=5)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504004")},
        )
        assert resp.status_code == 422, (
            f"ELOADCALL row=5 >= cc=5 must be rejected. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("clist_inconsistent") is True, (
            f"OOB ELOADCALL must set clist_inconsistent=True; got: {data}"
        )
        assert data.get("bad_slot") == 5, (
            f"bad_slot must be 5 (the row); got: {data}"
        )

    def test_eloadcall_method1_row_oob_returns_422(self, client, isolated_lumps):
        """ELOADCALL crSrc=6, method_index=1, row=5, cc=5 — nonzero method + OOB row.

        imm15 = (1 << 5) | 5 = 37; slot = 37 & 0x1F = 5 ≥ cc=5 → 422 ✓
        Verifies that method bits do not hide a genuine OOB row.
        """
        word = _eloadcall_word(cr_src=6, method_idx=1, row=5)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504004b")},
        )
        assert resp.status_code == 422, (
            f"ELOADCALL method_index=1, row=5 >= cc=5 must be rejected. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("clist_inconsistent") is True
        assert data.get("bad_slot") == 5, (
            f"bad_slot must be 5 (bits[4:0] of imm15); got: {data}"
        )

    # ── XLOADLAMBDA tests ─────────────────────────────────────────────────────
    # XLOADLAMBDA is only emitted by raw assembly (never by the CLOOMC compiler).
    # Its imm15 encodes the c-list slot directly; the server extracts via & 0x7FFF.

    def test_xloadlambda_slot0_returns_200(self, client, isolated_lumps):
        """XLOADLAMBDA crSrc=6, slot=0, cc=5 — slot=0 < cc=5, valid."""
        word = _xloadlambda_word(cr_src=6, slot=0)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504005")},
        )
        assert resp.status_code == 200, (
            f"XLOADLAMBDA slot=0 should be accepted. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        assert resp.get_json().get("ok") is True

    def test_xloadlambda_slot_oob_returns_422(self, client, isolated_lumps):
        """XLOADLAMBDA crSrc=6, slot=5, cc=5 — slot=5 ≥ cc=5, genuinely OOB."""
        word = _xloadlambda_word(cr_src=6, slot=5)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504006")},
        )
        assert resp.status_code == 422, (
            f"XLOADLAMBDA slot=5 >= cc=5 must be rejected. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("clist_inconsistent") is True

    # ── Cross-check: non-CR6 ELOADCALL is not checked ─────────────────────────

    def test_eloadcall_non_cr6_ignored(self, client, isolated_lumps):
        """ELOADCALL targeting CR0 (not the c-list register) must not be flagged.

        The bounds check applies only when crSrc == 6 (the c-list register).
        method_index=1, row=5 (row ≥ cc=5) but crSrc=0 — not a c-list ref.
        """
        word = _eloadcall_word(cr_src=0, method_idx=1, row=5)
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta("7c504007")},
        )
        assert resp.status_code == 200, (
            f"ELOADCALL with crSrc≠6 must not trigger c-list bounds check. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )


# ---------------------------------------------------------------------------
# T5 — LOAD/SAVE/ELOADCALL/XLOADLAMBDA with crSrc ≠ 6 must never return 422
# ---------------------------------------------------------------------------
#
# The c-list bounds guard fires ONLY when crSrc == 6 (the c-list register CR6).
# For any other source register the immediate field is an address offset or an
# unrelated operand — not a c-list slot — and must never be mis-interpreted as
# one, regardless of how large the encoded value is.
#
# Parametrised matrix:
#   opcode  × crSrc (0, 1, 7, 14, 15)  × imm value ≥ cc=5
#
# Token convention: 7c505<opcode_hex><cr_hex><seq> (all 8 hex chars)

def _raw_instr_word(opcode: int, cr_src: int, imm15: int) -> int:
    """Build a raw instruction word for any opcode with the given crSrc and imm15."""
    return ((opcode & 0x1F) << 27) | ((cr_src & 0xF) << 15) | (imm15 & 0x7FFF)


import itertools as _itertools

# Each tuple: (label_suffix, opcode, cr_src, imm15)
# imm15 values chosen to be ≥ cc=5 for all opcodes, exercising large immediate paths.
_NON_CR6_CASES = [
    # LOAD (op=0), various crSrc, various large immediates
    ("load_cr0_imm5",   0,  0,   5),
    ("load_cr0_imm32",  0,  0,  32),
    ("load_cr0_imm255", 0,  0, 255),
    ("load_cr1_imm5",   0,  1,   5),
    ("load_cr7_imm63",  0,  7,  63),
    ("load_cr14_imm5",  0, 14,   5),
    ("load_cr15_imm16383", 0, 15, 0x3FFF),
    # SAVE (op=1), various crSrc, various large immediates
    ("save_cr0_imm5",   1,  0,   5),
    ("save_cr0_imm32",  1,  0,  32),
    ("save_cr0_imm255", 1,  0, 255),
    ("save_cr1_imm5",   1,  1,   5),
    ("save_cr7_imm63",  1,  7,  63),
    ("save_cr14_imm5",  1, 14,   5),
    ("save_cr15_imm16383", 1, 15, 0x3FFF),
    # ELOADCALL (op=8) — imm15 = (method_idx << 5) | row; crSrc ≠ 6
    # Large method_idx produces imm15 >> cc even though row is valid.
    ("eloadcall_cr0_m1r5",   8,  0, (1  << 5) | 5),
    ("eloadcall_cr0_m7r5",   8,  0, (7  << 5) | 5),
    ("eloadcall_cr1_m7r0",   8,  1, (7  << 5) | 0),
    ("eloadcall_cr7_m127r0", 8,  7, (127 << 5) | 0),
    ("eloadcall_cr14_m1r5",  8, 14, (1  << 5) | 5),
    ("eloadcall_cr15_m3r4",  8, 15, (3  << 5) | 4),
    # XLOADLAMBDA (op=9) — imm15 is direct slot; crSrc ≠ 6
    ("xloadlambda_cr0_slot5",     9,  0,   5),
    ("xloadlambda_cr0_slot32",    9,  0,  32),
    ("xloadlambda_cr1_slot255",   9,  1, 255),
    ("xloadlambda_cr7_slot5",     9,  7,   5),
    ("xloadlambda_cr14_slot63",   9, 14,  63),
    ("xloadlambda_cr15_slot16383",9, 15, 0x3FFF),
]


class TestNonCr6NeverRejected:
    """LOAD/SAVE/ELOADCALL/XLOADLAMBDA with crSrc ≠ 6 must NEVER return 422.

    The c-list bounds guard in save_lump() checks (crSrc == 6) before testing
    the slot index.  When the instruction reads from any register other than
    CR6, the immediate field is not a c-list slot and must never be
    mis-interpreted as one — even when the encoded value is ≥ cc.

    This class is the parametrised complement to TestEloadcallFalsePositiveFix:
    that class verified the opcode-specific mask logic for crSrc=6; this class
    verifies the crSrc≠6 gate for all four opcodes across many operand values.
    """

    # c-list size chosen to make every imm15 value in _NON_CR6_CASES ≥ cc,
    # so if the guard ever fires on crSrc≠6 the test will catch it.
    CC = 5

    def _binary(self, instr_word: int) -> list:
        return [_hdr(cw=1, cc=self.CC), instr_word]

    @pytest.mark.parametrize("label,opcode,cr_src,imm15", _NON_CR6_CASES)
    def test_non_cr6_not_rejected(self, label, opcode, cr_src, imm15,
                                  client, isolated_lumps):
        """Instruction with crSrc≠6 must return 200 regardless of imm15 size.

        Guard condition: crSrc == 6.  For crSrc ∈ {0,1,7,14,15} the guard
        must be skipped entirely; no 422 should be returned.
        """
        assert cr_src != 6, "Fixture error: this test is only for crSrc ≠ 6"
        word = _raw_instr_word(opcode, cr_src, imm15)
        # Use a deterministic token derived from the case parameters.
        token = f"7c5{opcode:01x}{cr_src:01x}{abs(imm15) & 0xFFFFF:05x}"[:8].ljust(8, "0")
        resp = client.post(
            "/api/lumps/save",
            json={"binary": self._binary(word), "metadata": _meta(token)},
        )
        assert resp.status_code == 200, (
            f"[{label}] op={opcode} crSrc={cr_src} imm15={imm15:#x} (≥cc={self.CC}) "
            f"must NOT be rejected — crSrc≠6 so it is not a c-list reference. "
            f"Got {resp.status_code}: {resp.get_data(as_text=True)}"
        )
        assert resp.get_json().get("ok") is True, (
            f"[{label}] op={opcode} crSrc={cr_src} imm15={imm15:#x}: "
            f"expected ok=True in response, got: {resp.get_json()}"
        )
