"""
tests/server/test_manifest_corruption_guard.py

Regression guard: POST /api/lumps/save must return HTTP 500 and must NOT
overwrite manifest.json when that file exists but contains corrupt (invalid)
JSON.

Without the _read_manifest_safe() guard introduced in this task, the old
``except Exception: manifest = []`` fallback would silently replace the entire
LUMP library with a single-entry list, discarding every previously-saved lump.
"""

import json
import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

LUMPS_DIR = os.path.join(os.path.dirname(_app_module.__file__), "lumps")


# ── Module-scoped snapshot/restore ───────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    TestManifestCorruptionGuard.setup_method installs a corrupt manifest.json
    into the real server/lumps/ directory and relies on teardown_method for
    per-test restoration.  If pytest terminates the process between setup and
    teardown (e.g. keyboard interrupt, OOM kill), the corrupt manifest is left
    in place and breaks every subsequent server start.  This module-scoped
    autouse fixture holds the cross-process lumps_write_lock for the entire
    snapshot → tests → restore span and guarantees full restoration even on
    unexpected failures.
    """
    from tests.boot.conftest import lumps_write_lock
    import shutil as _shutil

    os.makedirs(LUMPS_DIR, exist_ok=True)
    with lumps_write_lock():
        snap_dir = str(tmp_path_factory.mktemp("lumps_snapshot"))
        entries = {}
        for name in os.listdir(LUMPS_DIR):
            p = os.path.join(LUMPS_DIR, name)
            if os.path.islink(p):
                entries[name] = ("link", os.readlink(p))
            elif os.path.isfile(p):
                dst = os.path.join(snap_dir, name)
                _shutil.copy2(p, dst)
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


# ── Lump construction helpers (same pattern as test_concurrent_lump_save) ────

_MAGIC   = 0x1F << 27
_N_M6    = 0                      # lump_size = 1 << (0 + 6) = 64 words
_LUMP_SZ = 1 << (_N_M6 + 6)      # 64


def _make_binary(cw=1, cc=1):
    hdr = _MAGIC | (_N_M6 << 23) | (cw << 10) | cc
    return [hdr] + [0] * (_LUMP_SZ - 1)


def _meta(token, abstraction):
    return {
        "token":           token,
        "abstraction":     abstraction,
        "ns_slot":         None,
        "cw":              1,
        "cc":              1,
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


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestManifestCorruptionGuard:
    """save_lump() must refuse to overwrite a corrupt manifest.json."""

    TOKEN   = "dd000001"
    ABS     = "CorruptManifestGuardTest"

    MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")

    # Content we write as the "corrupt" manifest — clearly not valid JSON.
    CORRUPT_CONTENT = b'{"this is truncated and broken'

    def setup_method(self):
        """Back up any real manifest.json and install a corrupt one."""
        os.makedirs(LUMPS_DIR, exist_ok=True)
        self._original_manifest = None
        if os.path.isfile(self.MANIFEST_PATH):
            with open(self.MANIFEST_PATH, 'rb') as _f:
                self._original_manifest = _f.read()
        with open(self.MANIFEST_PATH, 'wb') as _f:
            _f.write(self.CORRUPT_CONTENT)

    def teardown_method(self):
        """Restore original manifest.json (or remove it if it didn't exist)."""
        if self._original_manifest is not None:
            with open(self.MANIFEST_PATH, 'wb') as _f:
                _f.write(self._original_manifest)
        else:
            try:
                os.remove(self.MANIFEST_PATH)
            except OSError:
                pass
        # Also remove any lump/sidecar files that might have been written
        # before the manifest guard triggered (Phase 1 fires early, so no
        # per-token files should have been written, but clean up to be safe).
        for _fn in list(os.listdir(LUMPS_DIR)):
            if _fn.startswith(self.TOKEN) or _fn.startswith(self.ABS):
                try:
                    os.remove(os.path.join(LUMPS_DIR, _fn))
                except OSError:
                    pass

    def _do_save(self):
        _app_module.app.config["TESTING"] = True
        with _app_module.app.test_client() as client:
            return client.post(
                "/api/lumps/save",
                json={
                    "binary":   _make_binary(),
                    "metadata": _meta(self.TOKEN, self.ABS),
                },
            )

    def test_returns_500_on_corrupt_manifest(self):
        """POST /api/lumps/save must return HTTP 500 when manifest.json is corrupt."""
        resp = self._do_save()
        assert resp.status_code == 500, (
            f"Expected 500 but got {resp.status_code}; body: {resp.data!r}"
        )

    def test_error_body_is_json_with_error_key(self):
        """The 500 response body must be JSON with an 'error' key."""
        resp = self._do_save()
        body = resp.get_json(silent=True)
        assert body is not None, (
            f"Response body is not valid JSON: {resp.data!r}"
        )
        assert "error" in body, (
            f"Response JSON has no 'error' key: {body}"
        )

    def test_manifest_not_overwritten(self):
        """manifest.json must still contain the original corrupt bytes after the 500."""
        self._do_save()
        with open(self.MANIFEST_PATH, 'rb') as _f:
            content_after = _f.read()
        assert content_after == self.CORRUPT_CONTENT, (
            "manifest.json was overwritten even though it was corrupt. "
            f"Expected {self.CORRUPT_CONTENT!r} but found {content_after!r}"
        )

    def test_read_manifest_safe_raises_on_corrupt(self):
        """_read_manifest_safe() must raise ValueError for a corrupt file."""
        import pytest as _pytest
        with _pytest.raises(ValueError, match="not valid JSON"):
            _app_module._read_manifest_safe(self.MANIFEST_PATH)

    def test_read_manifest_safe_returns_empty_for_missing_file(self):
        """_read_manifest_safe() must return [] when the file does not exist."""
        missing = self.MANIFEST_PATH + ".does_not_exist"
        result = _app_module._read_manifest_safe(missing)
        assert result == [], (
            f"Expected [] for missing file but got {result!r}"
        )
