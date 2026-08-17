"""Regression tests for the R24b broken-.json-symlink guard.

These tests exercise _check_json_symlinks() in isolation using temporary
directories so that the guard's diagnostic logic can be verified without
touching the real server/lumps/ directory.

They confirm that:
  - a dangling manifest.json symlink is detected and returned
  - a dangling sidecar .json symlink is detected and returned
  - a non-symlink .json file is NOT flagged
  - a symlink that resolves to a real file is NOT flagged

This complements the module-level preflight in test_lump_consistency.py
(which runs before _load_manifest() at collection time) and the parametrised
TestR24b_NoBrokenJsonSymlinks class (which provides formal test-result
records for every .json in the real lumps directory).
"""

import os

import pytest

# _check_json_symlinks is the testable core extracted from the preflight.
# We load it via importlib so the import works regardless of whether tests/
# or tests/lump/ are registered as Python packages in sys.path, making the
# regression suite collection-safe in every pytest invocation style.
import importlib.util as _ilu

_CONSISTENCY_PY = os.path.join(os.path.dirname(__file__), "test_lump_consistency.py")
_spec = _ilu.spec_from_file_location("test_lump_consistency", _CONSISTENCY_PY)
_mod  = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_check_json_symlinks = _mod._check_json_symlinks


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_real_json(directory: str, filename: str, content: str = "{}") -> str:
    """Write a real (non-symlink) .json file and return its path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        f.write(content)
    return path


def _make_dangling_symlink(directory: str, link_name: str, missing_target: str) -> str:
    """Create a symlink whose target does not exist and return its path."""
    link_path = os.path.join(directory, link_name)
    os.symlink(missing_target, link_path)
    return link_path


def _make_resolving_symlink(directory: str, link_name: str, target_path: str) -> str:
    """Create a symlink that points at an existing file and return its path."""
    link_path = os.path.join(directory, link_name)
    os.symlink(target_path, link_path)
    return link_path


# ── tests ──────────────────────────────────────────────────────────────────────

class TestR24bGuard:
    """Regression coverage for _check_json_symlinks() guard logic."""

    def test_empty_directory_returns_no_broken(self, tmp_path):
        """An empty directory has no broken symlinks."""
        result = _check_json_symlinks(str(tmp_path))
        assert result == [], (
            "Expected no broken symlinks in an empty directory, "
            f"got: {result!r}"
        )

    def test_real_json_file_not_flagged(self, tmp_path):
        """A real (non-symlink) .json file must not be flagged."""
        _make_real_json(str(tmp_path), "manifest.json")
        result = _check_json_symlinks(str(tmp_path))
        assert result == [], (
            "Real manifest.json must not be flagged as a broken symlink, "
            f"got: {result!r}"
        )

    def test_resolving_symlink_not_flagged(self, tmp_path):
        """A .json symlink whose target exists must not be flagged."""
        real = _make_real_json(str(tmp_path), "real_sidecar.json")
        _make_resolving_symlink(str(tmp_path), "linked_sidecar.json", real)
        result = _check_json_symlinks(str(tmp_path))
        assert result == [], (
            "A resolving .json symlink must not be flagged as broken, "
            f"got: {result!r}"
        )

    def test_dangling_manifest_symlink_detected(self, tmp_path):
        """A dangling manifest.json symlink must be returned with correct details."""
        link_path = _make_dangling_symlink(
            str(tmp_path), "manifest.json", "/nonexistent/target/manifest.json"
        )
        result = _check_json_symlinks(str(tmp_path))
        assert len(result) == 1, (
            f"Expected exactly 1 broken symlink, got {len(result)}: {result!r}"
        )
        fn, target, resolved = result[0]
        assert fn == "manifest.json", (
            f"Expected filename 'manifest.json', got {fn!r}"
        )
        assert target == "/nonexistent/target/manifest.json", (
            f"Expected target '/nonexistent/target/manifest.json', got {target!r}"
        )
        # resolved path must be a non-existent file (realpath of the dangling link)
        assert not os.path.isfile(resolved), (
            f"Resolved path {resolved!r} must not point to a real file for a "
            "dangling symlink."
        )

    def test_dangling_sidecar_symlink_detected(self, tmp_path):
        """A dangling archive sidecar .json symlink must be returned."""
        _make_dangling_symlink(
            str(tmp_path), "NoteG_v4.json", "../elsewhere/NoteG_v4.json"
        )
        result = _check_json_symlinks(str(tmp_path))
        assert len(result) == 1, (
            f"Expected exactly 1 broken symlink, got {len(result)}: {result!r}"
        )
        fn, target, _ = result[0]
        assert fn == "NoteG_v4.json", f"Expected 'NoteG_v4.json', got {fn!r}"
        assert target == "../elsewhere/NoteG_v4.json", (
            f"Expected target '../elsewhere/NoteG_v4.json', got {target!r}"
        )

    def test_multiple_dangling_symlinks_all_detected(self, tmp_path):
        """All dangling .json symlinks in the directory are returned."""
        _make_dangling_symlink(str(tmp_path), "manifest.json", "/gone/manifest.json")
        _make_dangling_symlink(str(tmp_path), "SomeAbstr_v2.json", "/gone/SomeAbstr_v2.json")
        _make_real_json(str(tmp_path), "good_sidecar.json")
        result = _check_json_symlinks(str(tmp_path))
        broken_names = sorted(fn for fn, _, _ in result)
        assert broken_names == ["SomeAbstr_v2.json", "manifest.json"], (
            f"Expected both dangling symlinks to be detected, got: {broken_names!r}\n"
            "  The real file must not appear in the results."
        )

    def test_non_json_dangling_symlink_not_flagged(self, tmp_path):
        """A dangling symlink for a .lump (non-.json) file must not be flagged by R24b."""
        _make_dangling_symlink(
            str(tmp_path), "SomeAbstr_v3.lump", "/gone/SomeAbstr_v3.lump"
        )
        result = _check_json_symlinks(str(tmp_path))
        assert result == [], (
            "A dangling .lump symlink must not be flagged by R24b (_check_json_symlinks), "
            f"got: {result!r}"
        )

    def test_missing_lumps_dir_returns_empty(self, tmp_path):
        """Passing a non-existent directory returns an empty list (not an exception)."""
        missing_dir = str(tmp_path / "does_not_exist")
        result = _check_json_symlinks(missing_dir)
        assert result == [], (
            f"Expected empty list for missing directory, got: {result!r}"
        )
