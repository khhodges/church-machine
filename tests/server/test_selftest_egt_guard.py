"""
tests/server/test_selftest_egt_guard.py

Runtime guard: /api/lumps/save must reject any 512-word canonical SelfTest
lump (token 00000600) whose cc != 2 or whose word[510] != 0x4A000006.

The invariant is asserted at module-load time by hardware/boot_rom.py (lines
656 and 658), so a corrupt save is only discovered when the server restarts
and the IDE fails to launch.  This guard catches corruption at save time and
must not touch any file on disk when rejecting.

Cases covered:
  - cc=0 submission (cc auto-rewrite bypass attempt) → 422 selftest_cc_mismatch
  - cc=1 submission (wrong cc, even with correct E-GT at wrong index) → 422 selftest_cc_mismatch
  - cc=2 with wrong word[510] → 422 selftest_egt_mismatch
  - cc=2 with correct word[510]=0x4A000006 → 200 (control: valid save)
  - No .lump file written on any rejection
  - Existing canonical lump bytes are byte-for-byte identical after rejection
"""

import json
import os
import shutil
import struct
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

LUMPS_DIR = os.path.join(os.path.dirname(_app_module.__file__), "lumps")

# ── Constants matching hardware/boot_rom.py assertions ────────────────────────

SELFTEST_TOKEN         = "00000600"
SELFTEST_CANONICAL_CC  = 2
SELFTEST_EXPECTED_EGT  = 0x4A000006   # boot_rom.py line 658
SELFTEST_LUMP_SIZE     = 512
SELFTEST_N_MINUS_6     = 3            # 2^(3+6) = 512

_MAGIC = 0x1F << 27


# ── Binary helpers ─────────────────────────────────────────────────────────────

def _make_512_header(cw: int, cc: int) -> int:
    """Build a valid LUMP header for a 512-word lump."""
    return _MAGIC | (SELFTEST_N_MINUS_6 << 23) | (cw << 10) | cc


def _make_512_words(cw: int, cc: int, word_510: int = 0) -> list:
    """Return a 512-word array with the given header and word[510] value."""
    words = [0] * SELFTEST_LUMP_SIZE
    words[0] = _make_512_header(cw, cc)
    words[510] = word_510
    return words


# Reusable canonical binary (cc=2, word[510]=0x4A000006) — the only valid form.
_CANONICAL_BINARY = _make_512_words(cw=1, cc=2, word_510=SELFTEST_EXPECTED_EGT)
_CANONICAL_BINARY[511] = SELFTEST_EXPECTED_EGT   # word[511] = Next.GT (any E-GT is fine)

# Corrupt binaries that must be rejected.
_BAD_CC0_BINARY    = _make_512_words(cw=1, cc=0,  word_510=SELFTEST_EXPECTED_EGT)
_BAD_CC1_BINARY    = _make_512_words(cw=1, cc=1,  word_510=0)            # E-GT only at word[511]
_BAD_CC1_BINARY[511] = SELFTEST_EXPECTED_EGT   # correct value at [511], wrong at [510]
_BAD_W510_BINARY   = _make_512_words(cw=1, cc=2,  word_510=0xDEADBEEF)  # wrong E-GT


def _make_64_words(cw: int = 1, cc: int = 2) -> list:
    """Return a 64-word token-00000600 binary (n_minus_6=0, lump_size=64).

    Declares lump_size=64 — rejected by the array-length check (64 != 512)
    before any header or content check fires.
    """
    hdr = _MAGIC | (0 << 23) | (cw << 10) | cc   # n_minus_6=0 → 64 words
    words = [0] * 64
    words[0] = hdr
    return words


def _make_oversized_512header_words(n_extra: int) -> list:
    """Return a (512 + n_extra)-word array with a valid 512-word header.

    Header declares lump_size=512 and the E-GT is at word[510], but the extra
    trailing words would be serialized to disk and produce a file larger than
    2048 bytes, which hardware/boot_rom.py's struct.unpack(">512I", raw)
    rejects on server start.  The guard must reject this before any write.
    """
    words = _make_512_words(cw=1, cc=2, word_510=SELFTEST_EXPECTED_EGT)
    words[511] = SELFTEST_EXPECTED_EGT          # canonical Next.GT
    words.extend([0] * n_extra)                 # trailing extra words
    return words


# A 64-word binary with the correct E-GT embedded — still must be rejected
# because array length (64) != 512.  E-GT at word[62] (64-2) confirms the
# size check fires before the content check.
_BAD_SIZE64_BINARY = _make_64_words(cw=1, cc=2)
_BAD_SIZE64_BINARY[62] = SELFTEST_EXPECTED_EGT

# Oversized: valid 512-word header + 1 trailing word = 513 entries.
_BAD_SIZE513_BINARY = _make_oversized_512header_words(n_extra=1)

# Oversized: valid 512-word header + 512 trailing words = 1024 entries.
_BAD_SIZE1024_BINARY = _make_oversized_512header_words(n_extra=512)


def _meta(abstraction: str = "SelfTest") -> dict:
    return {
        "token":           SELFTEST_TOKEN,
        "abstraction":     abstraction,
        "ns_slot":         6,
        "cw":              1,
        "cc":              SELFTEST_CANONICAL_CC,
        "profile":         "IoT",
        "language":        "assembly",
        "author":          "",
        "version":         "",
        "methods":         [],
        "capabilities":    [],
        "grants":          ["E"],
        "content_type":    "code",
        "pet_names_dr":    {},
        "pet_names_cr":    {},
        "mtbf_clean_runs": 0,
        "mtbf_total_runs": 0,
        "mtbf_status":     "unknown",
    }


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    Tests here POST /api/lumps/save for token 00000600.  The save-time guard
    rejects corrupt saves before any write, but the canonical-save control
    test writes a real versioned lump file and updates the manifest.  A mid-
    suite failure could leave stale files or a corrupt manifest.json that
    breaks the IDE on next server start.

    This module-scoped autouse fixture holds the cross-process
    ``lumps_write_lock`` (see tests/boot/conftest.py) for the entire
    snapshot → tests → restore span, so that cooperating test modules that
    also take the lock cannot interleave with this module's write window.

    Guarantee and limits: serializes only *cooperating* lock holders.  Do not
    run this suite while the IDE dev server is actively saving lumps.
    """
    from tests.boot.conftest import lumps_write_lock

    with lumps_write_lock():
        snap_dir = str(tmp_path_factory.mktemp("lumps_snapshot_selftest_egt"))
        entries = {}
        for name in os.listdir(LUMPS_DIR):
            p = os.path.join(LUMPS_DIR, name)
            if os.path.islink(p):
                entries[name] = ("link", os.readlink(p))
            elif os.path.isfile(p):
                dst = os.path.join(snap_dir, name)
                shutil.copy2(p, dst)
                entries[name] = ("file", dst)

        yield

        # 1. Remove anything created during the module.
        for name in os.listdir(LUMPS_DIR):
            if name not in entries:
                p = os.path.join(LUMPS_DIR, name)
                if os.path.islink(p) or os.path.isfile(p):
                    os.remove(p)

        # 2. Restore originals (content, symlink targets, deleted files).
        for name, (kind, val) in entries.items():
            p = os.path.join(LUMPS_DIR, name)
            if kind == "link":
                current = os.readlink(p) if os.path.islink(p) else None
                if current != val:
                    if os.path.islink(p) or os.path.exists(p):
                        os.remove(p)
                    os.symlink(val, p)
            else:
                with open(val, "rb") as fh:
                    original = fh.read()
                if os.path.islink(p):
                    os.remove(p)
                needs_write = True
                if os.path.isfile(p):
                    with open(p, "rb") as fh:
                        needs_write = fh.read() != original
                if needs_write:
                    with open(p, "wb") as fh:
                        fh.write(original)


@pytest.fixture(scope="module")
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestSelfTestEGTGuard:
    """Guard: corrupt 512-word canonical SelfTest saves are rejected at save time."""

    def test_cc0_returns_422_selftest_cc_mismatch(self, client):
        """cc=0 submission (auto-rewrite bypass attempt) → 422 selftest_cc_mismatch."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_CC0_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for cc=0 bypass attempt, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_cc_mismatch") is True, (
            f"Expected selftest_cc_mismatch=True in 422 body; got: {data}"
        )
        assert data.get("expected_cc") == SELFTEST_CANONICAL_CC, (
            f"Expected expected_cc={SELFTEST_CANONICAL_CC}; got: {data}"
        )
        assert data.get("actual_cc") == 0, (
            f"Expected actual_cc=0; got: {data}"
        )

    def test_cc1_returns_422_selftest_cc_mismatch(self, client):
        """cc=1 with E-GT at word[511] (not word[510]) → 422 selftest_cc_mismatch.

        This catches the bypass where a client submits cc=1 so that
        _clist_row0_idx = 511 (not 510) and puts the E-GT there instead.
        The guard checks cc first, so this is caught before the word[510] check.
        """
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_CC1_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for cc=1 submission, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_cc_mismatch") is True, (
            f"Expected selftest_cc_mismatch=True; got: {data}"
        )
        assert data.get("actual_cc") == 1, (
            f"Expected actual_cc=1; got: {data}"
        )

    def test_wrong_word510_returns_422_selftest_egt_mismatch(self, client):
        """cc=2 but word[510] != 0x4A000006 → 422 selftest_egt_mismatch."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_W510_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for wrong word[510], got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_egt_mismatch") is True, (
            f"Expected selftest_egt_mismatch=True; got: {data}"
        )
        assert data.get("expected_egt") == SELFTEST_EXPECTED_EGT, (
            f"Expected expected_egt={SELFTEST_EXPECTED_EGT:#010x}; got: {data}"
        )
        assert data.get("actual_word_510") == 0xDEADBEEF, (
            f"Expected actual_word_510=0xDEADBEEF; got: {data}"
        )
        assert data.get("word_index") == 510, (
            f"Expected word_index=510; got: {data}"
        )

    def test_canonical_binary_saves_successfully(self, client):
        """Control: cc=2 with word[510]=0x4A000006 → 200, on-disk file is exactly 2048 bytes."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _CANONICAL_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 200, (
            f"Expected 200 for canonical SelfTest binary, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("ok") is True, f"Expected ok=True; got: {data}"
        assert data.get("token") == SELFTEST_TOKEN, (
            f"Expected token={SELFTEST_TOKEN!r}; got: {data.get('token')!r}"
        )
        # The on-disk file must be exactly 512 words × 4 bytes = 2048 bytes.
        # hardware/boot_rom.py does struct.unpack(">512I", raw) which requires
        # exactly 2048 bytes; any other size breaks IDE server startup.
        saved_filename = data.get("lump", "")
        assert saved_filename, f"Response missing 'lump' filename: {data}"
        saved_path = os.path.join(LUMPS_DIR, saved_filename)
        assert os.path.isfile(saved_path), (
            f"Saved lump not found at {saved_path}"
        )
        on_disk_bytes = os.path.getsize(saved_path)
        assert on_disk_bytes == SELFTEST_LUMP_SIZE * 4, (
            f"Saved lump must be exactly {SELFTEST_LUMP_SIZE * 4} bytes "
            f"(512 words × 4); got {on_disk_bytes} bytes at {saved_filename}"
        )

    def test_no_lump_written_on_cc_rejection(self, client):
        """Rejected save (cc=0) must not write any new .lump file to disk."""
        before = set(os.listdir(LUMPS_DIR))
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_CC0_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422
        after = set(os.listdir(LUMPS_DIR))
        new_lump_files = [f for f in (after - before) if f.endswith(".lump")]
        assert not new_lump_files, (
            f"cc=0 rejection must not write any .lump file; "
            f"found new files: {sorted(new_lump_files)}"
        )

    def test_no_lump_written_on_egt_rejection(self, client):
        """Rejected save (wrong word[510]) must not write any new .lump file."""
        before = set(os.listdir(LUMPS_DIR))
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_W510_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422
        after = set(os.listdir(LUMPS_DIR))
        new_lump_files = [f for f in (after - before) if f.endswith(".lump")]
        assert not new_lump_files, (
            f"E-GT rejection must not write any .lump file; "
            f"found new files: {sorted(new_lump_files)}"
        )

    def test_513word_binary_returns_422_selftest_size_mismatch(self, client):
        """A 513-word array with a valid 512-word header is rejected before any write.

        The header correctly declares lump_size=512 and word[510]=E-GT is set,
        but the extra 513th word would be serialized to disk, producing a
        2052-byte file.  hardware/boot_rom.py's struct.unpack(">512I", raw)
        rejects any file not exactly 2048 bytes on next server start.
        """
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_SIZE513_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for 513-word token-00000600 binary, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_size_mismatch") is True, (
            f"Expected selftest_size_mismatch=True in 422 body; got: {data}"
        )
        assert data.get("actual_lump_size") == 513, (
            f"Expected actual_lump_size=513; got: {data}"
        )

    def test_1024word_binary_returns_422_selftest_size_mismatch(self, client):
        """A 1024-word array with a valid 512-word header is rejected before any write."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_SIZE1024_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for 1024-word token-00000600 binary, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_size_mismatch") is True, (
            f"Expected selftest_size_mismatch=True in 422 body; got: {data}"
        )
        assert data.get("actual_lump_size") == 1024, (
            f"Expected actual_lump_size=1024; got: {data}"
        )

    def test_no_lump_written_on_oversized_rejection(self, client):
        """Rejecting a 513-word token-00000600 save must not write any new file."""
        before = set(os.listdir(LUMPS_DIR))
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_SIZE513_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422
        after = set(os.listdir(LUMPS_DIR))
        new_lump_files = [f for f in (after - before) if f.endswith(".lump")]
        assert not new_lump_files, (
            f"Oversized rejection must not write any .lump file; "
            f"found new files: {sorted(new_lump_files)}"
        )

    def test_64word_binary_returns_422_selftest_size_mismatch(self, client):
        """A 64-word token-00000600 binary is rejected before any content check.

        Sending lump_size=64 (n_minus_6=0) for token 00000600 bypasses the
        self-GT injection AND the layout checks, then silently updates the
        manifest chain so the IDE server cannot boot on next restart.  The
        guard rejects any non-512-word size for this token unconditionally.
        """
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_SIZE64_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422, (
            f"Expected 422 for 64-word token-00000600 binary, got {resp.status_code}. "
            f"Body: {resp.get_data(as_text=True)}"
        )
        data = resp.get_json()
        assert data.get("selftest_size_mismatch") is True, (
            f"Expected selftest_size_mismatch=True in 422 body; got: {data}"
        )
        assert data.get("expected_lump_size") == 512, (
            f"Expected expected_lump_size=512; got: {data}"
        )
        assert data.get("actual_lump_size") == 64, (
            f"Expected actual_lump_size=64; got: {data}"
        )

    def test_64word_rejection_leaves_canonical_files_unchanged(self, client):
        """Rejecting a 64-word token-00000600 save must not touch any file on disk.

        This is the primary regression test for the bypass: before the size
        check was added, a non-512-word token-00000600 save skipped all guards
        and wrote a new file + updated the manifest, corrupting the canonical
        chain without any error.
        """
        before_files = set(os.listdir(LUMPS_DIR))
        before_bytes: dict[str, bytes] = {}
        for fn in before_files:
            p = os.path.join(LUMPS_DIR, fn)
            if os.path.isfile(p) and not os.path.islink(p):
                with open(p, "rb") as fh:
                    before_bytes[fn] = fh.read()

        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_SIZE64_BINARY, "metadata": _meta()},
        )
        assert resp.status_code == 422

        after_files = set(os.listdir(LUMPS_DIR))
        new_files = [f for f in (after_files - before_files) if f.endswith(".lump")]
        assert not new_files, (
            f"64-word rejection must not write any .lump file; "
            f"found new files: {sorted(new_files)}"
        )
        for fn, original in before_bytes.items():
            p = os.path.join(LUMPS_DIR, fn)
            if os.path.isfile(p) and not os.path.islink(p):
                with open(p, "rb") as fh:
                    current = fh.read()
                assert current == original, (
                    f"64-word rejection must not modify existing file {fn}"
                )

    def test_existing_canonical_lump_untouched_on_rejection(self, client):
        """Existing SelfTest lump files must be byte-identical after a rejected save.

        Saves a valid canonical lump first to establish an on-disk file, then
        attempts a corrupt save and verifies no existing file was modified.
        """
        # Establish a valid canonical file on disk.
        resp1 = client.post(
            "/api/lumps/save",
            json={"binary": _CANONICAL_BINARY, "metadata": _meta()},
        )
        assert resp1.status_code == 200, (
            f"Setup save failed: {resp1.get_data(as_text=True)}"
        )
        saved_lump = resp1.get_json().get("lump", "")

        # Snapshot all current .lump files.
        snapshots = {}
        for fn in os.listdir(LUMPS_DIR):
            if fn.endswith(".lump"):
                p = os.path.join(LUMPS_DIR, fn)
                if os.path.isfile(p):
                    with open(p, "rb") as fh:
                        snapshots[fn] = fh.read()

        assert snapshots, "No .lump files found after setup save"

        # Attempt corrupt save — must be rejected.
        resp2 = client.post(
            "/api/lumps/save",
            json={"binary": _BAD_W510_BINARY, "metadata": _meta()},
        )
        assert resp2.status_code == 422, (
            f"Expected 422 for corrupt save, got {resp2.status_code}: "
            f"{resp2.get_data(as_text=True)}"
        )

        # Every .lump file that existed before must still have identical bytes.
        for fn, original_bytes in snapshots.items():
            p = os.path.join(LUMPS_DIR, fn)
            assert os.path.isfile(p), (
                f"Rejection must not delete existing lump {fn}"
            )
            with open(p, "rb") as fh:
                current_bytes = fh.read()
            assert current_bytes == original_bytes, (
                f"Rejection must not modify existing lump {fn} — "
                f"bytes changed ({len(original_bytes)} → {len(current_bytes)})"
            )
