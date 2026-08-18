"""
test_sync_lump_viewer_to_sidecars.py — unit tests for sync_lump_viewer_to_sidecars.py

Covers:
  - Token cross-reference error (Viewer token belongs to a different manifest entry)
  - Sidecar.token vs manifest.token mismatch
  - Missing sidecar preflight error
  - Collision detection (two Viewer entries → same sidecar with conflicting metadata)
  - Clean write mode leaves correct files on disk and does not touch others
  - --check mode exits 0 on aligned state, exits 1 on any violation

In all error cases, write mode must NOT touch any sidecar files.
"""

import json
import os
import sys
import tempfile
import textwrap

import pytest

# Allow running from the repo root
_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import scripts.sync_lump_viewer_to_sidecars as sync_mod


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_lump_file(lumps_dir: str, token: str, name: str = "Alpha") -> str:
    """Write a minimal 4-byte placeholder .lump file and return its filename."""
    import struct
    # Minimal LUMP header: magic=0x1F in bits[31:27], cw=1, cc=0, typ=0
    word = (0x1F << 27) | (1 << 10)
    lump_fn = f"{name}.1.{token}.lump"
    with open(os.path.join(lumps_dir, lump_fn), "wb") as fh:
        fh.write(struct.pack(">I", word))
    return lump_fn


def _make_sidecar(lumps_dir: str, sc_fn: str, token: str,
                  group: str = "Test", doc_refs: list | None = None) -> None:
    data = {"token": token, "group": group, "doc_refs": doc_refs or []}
    with open(os.path.join(lumps_dir, sc_fn), "w") as fh:
        json.dump(data, fh)


def _make_manifest(lumps_dir: str, entries: list) -> str:
    path = os.path.join(lumps_dir, "manifest.json")
    with open(path, "w") as fh:
        json.dump(entries, fh)
    return path


def _make_html(lumps_dir: str, lumps_entries: list) -> str:
    """Write a minimal Lumps Directory HTML containing the given LUMPS[] entries."""
    # Render entries as JS object literals
    def _js_entry(e: dict) -> str:
        parts = []
        for k, v in e.items():
            if isinstance(v, str):
                parts.append(f'  {k}:{json.dumps(v)}')
            elif isinstance(v, list):
                parts.append(f'  {k}:{json.dumps(v)}')
            elif v is None:
                parts.append(f'  {k}:null')
            else:
                parts.append(f'  {k}:{json.dumps(v)}')
        return "{\n" + ",\n".join(parts) + "\n}"

    js_array = "[\n" + ",\n".join(_js_entry(e) for e in lumps_entries) + "\n]"
    html = textwrap.dedent(f"""\
        <html><body><script>
        const LUMPS = {js_array}; // end LUMPS
        </script></body></html>
    """)
    path = os.path.join(lumps_dir, "lumps_dir.html")
    with open(path, "w") as fh:
        fh.write(html)
    return path


def _run(html_path, lumps_dir, manifest_path, extra_argv=None):
    """Call main() in-process and return exit code."""
    return sync_mod.main(
        html_path=html_path,
        lumps_dir=lumps_dir,
        manifest_path=manifest_path,
        argv=(extra_argv or []),
    )


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def td():
    """Temporary directory that acts as our fake lumps_dir."""
    with tempfile.TemporaryDirectory() as d:
        yield d


# ── Happy-path tests ───────────────────────────────────────────────────────────

class TestHappyPath:
    def test_write_mode_updates_sidecar(self, td):
        """Write mode propagates group/doc_refs and exits 0."""
        _make_lump_file(td, "aabb1234")
        _make_sidecar(td, "Alpha.1.aabb1234.json", "aabb1234", group=None, doc_refs=None)
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aabb1234",
             "filename": "Alpha.1.aabb1234.lump",
             "sidecar_file": "Alpha.1.aabb1234.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aabb1234", "group": "System",
             "doc_refs": ["foo.md"], "genotype": "0xAABB1234"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 0
        sc = json.loads(open(os.path.join(td, "Alpha.1.aabb1234.json")).read())
        assert sc["group"] == "System"
        assert sc["doc_refs"] == ["foo.md"]

    def test_check_mode_passes_when_aligned(self, td):
        """--check exits 0 when sidecar group/doc_refs match the Viewer."""
        _make_lump_file(td, "aabb1234")
        _make_sidecar(td, "Alpha.1.aabb1234.json", "aabb1234",
                      group="System", doc_refs=["foo.md"])
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aabb1234",
             "filename": "Alpha.1.aabb1234.lump",
             "sidecar_file": "Alpha.1.aabb1234.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aabb1234", "group": "System",
             "doc_refs": ["foo.md"], "genotype": "0xAABB1234"},
        ])
        rc = _run(html_path, td, manifest_path, ["--check"])
        assert rc == 0

    def test_write_mode_does_not_overwrite_build_fields(self, td):
        """Write mode never touches binary_hash, cw, cc, compiled_at."""
        _make_lump_file(td, "aabb1234")
        original_sc = {
            "token": "aabb1234",
            "group": None,
            "doc_refs": [],
            "binary_hash": "deadbeef",
            "cw": 42,
            "cc": 3,
            "compiled_at": "2025-01-01T00:00:00Z",
        }
        sc_path = os.path.join(td, "Alpha.1.aabb1234.json")
        with open(sc_path, "w") as fh:
            json.dump(original_sc, fh)
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aabb1234",
             "filename": "Alpha.1.aabb1234.lump",
             "sidecar_file": "Alpha.1.aabb1234.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aabb1234", "group": "System",
             "doc_refs": [], "genotype": "0xAABB1234"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 0
        sc = json.loads(open(sc_path).read())
        assert sc["binary_hash"] == "deadbeef"
        assert sc["cw"] == 42
        assert sc["cc"] == 3
        assert sc["compiled_at"] == "2025-01-01T00:00:00Z"


# ── Token cross-reference check ────────────────────────────────────────────────

class TestTokenCrossReference:
    """Viewer token points to a DIFFERENT manifest entry than the name-matched one."""

    def test_cross_ref_error_write_mode(self, td):
        """Write mode exits 1 and does NOT modify any sidecar."""
        _make_lump_file(td, "aaaa0001")                 # Alpha.1.aaaa0001.lump
        _make_lump_file(td, "bbbb0002", name="Beta")    # Beta.1.bbbb0002.lump
        sc_a = "Alpha.1.aaaa0001.json"
        sc_b = "Beta.1.bbbb0002.json"
        _make_sidecar(td, sc_a, "aaaa0001", group="Test")
        _make_sidecar(td, sc_b, "bbbb0002", group="Test")
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump", "sidecar_file": sc_a},
            {"abstraction": "Beta",  "token": "bbbb0002",
             "filename": "Beta.1.bbbb0002.lump",  "sidecar_file": sc_b},
        ])
        # Alpha's Viewer entry has Beta's token — cross-reference error
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "bbbb0002", "group": "NewGroup",
             "doc_refs": ["x.md"], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 1
        # Alpha's sidecar must be untouched
        sc = json.loads(open(os.path.join(td, sc_a)).read())
        assert sc.get("group") == "Test"
        assert sc.get("doc_refs") is None or sc.get("doc_refs") == []

    def test_cross_ref_error_check_mode(self, td):
        """--check exits 1 on token cross-reference."""
        _make_lump_file(td, "aaaa0001")
        _make_lump_file(td, "bbbb0002", name="Beta")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "aaaa0001",
                      group="NewGroup", doc_refs=["x.md"])
        _make_sidecar(td, "Beta.1.bbbb0002.json", "bbbb0002", group="Test")
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
            {"abstraction": "Beta",  "token": "bbbb0002",
             "filename": "Beta.1.bbbb0002.lump",
             "sidecar_file": "Beta.1.bbbb0002.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "bbbb0002", "group": "NewGroup",
             "doc_refs": ["x.md"], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path, ["--check"])
        assert rc == 1


# ── Sidecar token mismatch ─────────────────────────────────────────────────────

class TestSidecarTokenMismatch:
    """sidecar.token disagrees with manifest.token."""

    def test_mismatch_exits_1_write_mode(self, td):
        """Write mode exits 1 when sidecar.token != manifest.token."""
        _make_lump_file(td, "aaaa0001")
        # Sidecar has wrong token inside
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "deadbeef", group=None)
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aaaa0001", "group": "System",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 1

    def test_mismatch_no_file_written(self, td):
        """Write mode does not update the sidecar when token is mismatched."""
        _make_lump_file(td, "aaaa0001")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "deadbeef", group=None)
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aaaa0001", "group": "System",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        sc_path = os.path.join(td, "Alpha.1.aaaa0001.json")
        mtime_before = os.path.getmtime(sc_path)
        _run(html_path, td, manifest_path)
        assert os.path.getmtime(sc_path) == mtime_before


# ── Missing sidecar ────────────────────────────────────────────────────────────

class TestMissingSidecar:
    def test_missing_sidecar_exits_1(self, td):
        """Write mode exits 1 when the sidecar file is absent."""
        _make_lump_file(td, "aaaa0001")
        # No sidecar file written
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aaaa0001", "group": "System",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 1

    def test_missing_sidecar_check_exits_1(self, td):
        """--check exits 1 when the sidecar is absent."""
        _make_lump_file(td, "aaaa0001")
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aaaa0001", "group": "System",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path, ["--check"])
        assert rc == 1


# ── Collision detection ────────────────────────────────────────────────────────

class TestCollisionDetection:
    def test_collision_conflicting_group_exits_1(self, td):
        """Write mode exits 1 when two Viewer entries target the same sidecar with
        different group values; no sidecar is modified."""
        _make_lump_file(td, "aaaa0001")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "aaaa0001", group=None, doc_refs=[])
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        # Both Alpha and Alpha.2 resolve to the same manifest entry but differ in group
        html_path = _make_html(td, [
            {"id": "Alpha",   "token": "aaaa0001", "group": "System",
             "doc_refs": [], "genotype": "0xAAAA0001"},
            {"id": "Alpha.2", "token": "aaaa0001", "group": "Hardware",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        sc_path = os.path.join(td, "Alpha.1.aaaa0001.json")
        mtime_before = os.path.getmtime(sc_path)
        rc = _run(html_path, td, manifest_path)
        assert rc == 1
        assert os.path.getmtime(sc_path) == mtime_before

    def test_collision_identical_metadata_passes(self, td):
        """Two Viewer entries targeting the same sidecar with identical group/doc_refs
        is allowed — write mode exits 0."""
        _make_lump_file(td, "aaaa0001")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "aaaa0001", group=None, doc_refs=[])
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha",   "token": "aaaa0001", "group": "System",
             "doc_refs": ["a.md"], "genotype": "0xAAAA0001"},
            {"id": "Alpha.2", "token": "aaaa0001", "group": "System",
             "doc_refs": ["a.md"], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path)
        assert rc == 0


# ── --check mode catches drift ─────────────────────────────────────────────────

class TestCheckMode:
    def test_check_exits_1_on_group_drift(self, td):
        """--check exits 1 when sidecar.group differs from viewer."""
        _make_lump_file(td, "aaaa0001")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "aaaa0001",
                      group="OldGroup", doc_refs=[])
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        html_path = _make_html(td, [
            {"id": "Alpha", "token": "aaaa0001", "group": "NewGroup",
             "doc_refs": [], "genotype": "0xAAAA0001"},
        ])
        rc = _run(html_path, td, manifest_path, ["--check"])
        assert rc == 1

    def test_check_exits_1_on_missing_viewer_entry_for_manifest(self, td):
        """--check exits 1 when a manifest entry with a .lump on disk has no
        corresponding Lump Viewer entry."""
        _make_lump_file(td, "aaaa0001")
        _make_sidecar(td, "Alpha.1.aaaa0001.json", "aaaa0001",
                      group="System", doc_refs=[])
        manifest_path = _make_manifest(td, [
            {"abstraction": "Alpha", "token": "aaaa0001",
             "filename": "Alpha.1.aaaa0001.lump",
             "sidecar_file": "Alpha.1.aaaa0001.json"},
        ])
        # Viewer is empty — no entries for Alpha
        html_path = _make_html(td, [])
        rc = _run(html_path, td, manifest_path, ["--check"])
        assert rc == 1
