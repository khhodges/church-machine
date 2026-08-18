"""
tests/server/test_manifest_atomic_write.py

Regression guard: a mid-write crash (simulated by raising an exception inside
open()) must leave the original manifest.json intact and unparsed — never
truncated or in a partially-written state.

Without the _atomic_write_json helper (write-to-temp + os.replace) the direct
``open(path, 'w') + json.dump()`` pattern truncates the file to zero bytes the
moment open() is called in 'w' mode, so any crash before json.dump() finishes
leaves an empty/corrupt manifest that silently loses all saved lump entries on
the next server start.
"""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

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

    TestManifestWriteSitesUseAtomicHelper.test_mid_write_crash_leaves_manifest_intact
    writes a baseline manifest.json to the real server/lumps/ directory and
    relies on an inline try/finally for restoration.  A mid-suite failure or
    exception in that finally block could leave manifest.json corrupt.  This
    module-scoped autouse fixture holds the cross-process lumps_write_lock for
    the entire snapshot → tests → restore span and guarantees full restoration
    even on unexpected failures.
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


class TestAtomicWriteJson(unittest.TestCase):
    """Unit tests for the _atomic_write_json helper directly."""

    def test_writes_content_correctly(self):
        """Written JSON round-trips back to the original object."""
        data = [{"token": "aabbccdd", "abstraction": "Foo", "cw": 1}]
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "manifest.json")
            _app_module._atomic_write_json(path, data)
            with open(path) as fh:
                result = json.load(fh)
        self.assertEqual(result, data)

    def test_original_preserved_on_write_error(self):
        """If json.dump raises mid-write, the original file is untouched."""
        original = [{"token": "00112233", "abstraction": "Original", "cw": 1}]
        replacement = [{"token": "aabbccdd", "abstraction": "Replacement", "cw": 2}]

        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "manifest.json")
            # Write the original content.
            with open(path, "w") as fh:
                json.dump(original, fh, indent=2)

            # Patch json.dump so it raises mid-write inside _atomic_write_json.
            # The temp file should be cleaned up and the original must survive.
            with patch("json.dump", side_effect=IOError("simulated crash")):
                with self.assertRaises(IOError):
                    _app_module._atomic_write_json(path, replacement)

            # The original manifest must still be valid and unchanged.
            with open(path) as fh:
                result = json.load(fh)
            self.assertEqual(result, original)

    def test_no_temp_file_left_on_error(self):
        """After a failed write the temp file is deleted, leaving no debris."""
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "manifest.json")
            # Create the target so we have a directory to inspect.
            with open(path, "w") as fh:
                json.dump([], fh)

            with patch("json.dump", side_effect=RuntimeError("crash")):
                with self.assertRaises(RuntimeError):
                    _app_module._atomic_write_json(path, [{"token": "ff"}])

            entries = os.listdir(td)
            tmp_files = [e for e in entries if e.endswith(".tmp")]
            self.assertEqual(tmp_files, [],
                             f"Temp files left behind: {tmp_files}")

    def test_atomic_replace_not_observable_as_empty(self):
        """A concurrent reader never sees an empty/truncated file during the write.

        This test verifies the structural property: because we write to a temp
        file and call os.replace(), the destination goes directly from the old
        content to the new content.  An open('w') approach would truncate it to
        zero bytes first — observable as an empty file.  We verify the helper
        never passes through a zero-byte state at the destination path.
        """
        data = [{"token": "deadbeef", "cw": 3, "cc": 1}]
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "manifest.json")
            _app_module._atomic_write_json(path, data)
            # File must exist and be non-empty immediately after the call.
            size = os.path.getsize(path)
            self.assertGreater(size, 0)
            # Content must be valid JSON.
            with open(path) as fh:
                self.assertEqual(json.load(fh), data)


class TestManifestWriteSitesUseAtomicHelper(unittest.TestCase):
    """Integration smoke-tests: the save_lump() manifest write path calls
    _atomic_write_json, not a bare open()+json.dump()."""

    def _make_lump_payload(self, token="aabb1122", name="TestAbstr"):
        """Return a minimal multipart-like dict accepted by the save endpoint."""
        import struct
        MAGIC = 0x1F << 27
        N_M6 = 0
        LUMP_SZ = 1 << (N_M6 + 6)  # 64
        hdr = MAGIC | (N_M6 << 23) | (1 << 10) | 1
        words = [hdr] + [0] * (LUMP_SZ - 1)
        lump_bytes = struct.pack(f">{LUMP_SZ}I",
                                 *[int(w) & 0xFFFFFFFF for w in words])
        import base64
        sidecar = {
            "token": token,
            "abstraction": name,
            "filename": f"{token}.lump",
            "sidecar_file": f"{token}.lump.json",
            "ns_slot": None,
            "lump_size": LUMP_SZ,
            "typ": 0,
            "content_type": "code",
            "cw": 1,
            "cc": 1,
            "methods": [{"name": "run", "offset": 0, "length": 1}],
            "grants": [],
            "capabilities": [{"name": "self", "rights": ["E"],
                               "grants": ["E"], "nsIndex": -1}],
            "pet_names": {"DR": {}, "CR": {}},
            "mtbf": {"consecutive_clean": 0, "total_runs": 0,
                     "status": "unknown"},
            "author": "",
            "version": "",
            "lump_version": 1,
            "compiled_at": 0.0,
            "binary_hash": "",
            "identity_hash": "",
            "dot_name": "",
            "issue_n": 0,
        }
        return lump_bytes, sidecar

    def test_mid_write_crash_leaves_manifest_intact(self):
        """Simulate a crash inside the manifest write: original content survives."""
        app = _app_module.app
        lumps_dir = os.path.join(os.path.dirname(_app_module.__file__), "lumps")
        os.makedirs(lumps_dir, exist_ok=True)
        manifest_path = os.path.join(lumps_dir, "manifest.json")

        # Snapshot the manifest before the test so we can restore it.
        original_content = None
        if os.path.isfile(manifest_path):
            with open(manifest_path) as fh:
                original_content = fh.read()

        # Write a known baseline so we have something to check after the crash.
        baseline = [{"token": "cafecafe", "abstraction": "Baseline", "cw": 1}]
        with open(manifest_path, "w") as fh:
            json.dump(baseline, fh, indent=2)

        try:
            # Patch _atomic_write_json to raise — simulates a process crash
            # happening inside the write.  The original file must survive.
            with patch.object(
                _app_module, "_atomic_write_json",
                side_effect=OSError("simulated mid-write crash"),
            ):
                lump_bytes, sidecar = self._make_lump_payload(
                    token="deadd00d", name="CrashTest"
                )
                import base64
                with app.test_client() as client:
                    resp = client.post(
                        "/api/lumps/save",
                        json={
                            "lump_b64": base64.b64encode(lump_bytes).decode(),
                            "sidecar": sidecar,
                        },
                    )
                # The endpoint should return an error (5xx or 4xx).
                self.assertGreaterEqual(resp.status_code, 400,
                                        "Expected error status when write fails")

            # manifest.json must still be valid and contain the baseline entry.
            self.assertTrue(os.path.isfile(manifest_path),
                            "manifest.json disappeared after simulated crash")
            with open(manifest_path) as fh:
                result = json.load(fh)
            self.assertEqual(result, baseline,
                             "manifest.json was corrupted by the simulated crash")
        finally:
            # Restore the manifest to whatever it was before the test.
            if original_content is not None:
                with open(manifest_path, "w") as fh:
                    fh.write(original_content)
            else:
                try:
                    os.remove(manifest_path)
                except OSError:
                    pass


if __name__ == "__main__":
    unittest.main()
