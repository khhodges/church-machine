"""
tests/server/test_lump_archive_fallback.py

Regression tests for the archive-on-save fallback version-selection logic.

The critical invariant: when a lump's sidecar and manifest entry are both
unreadable (corrupt-metadata scenario), the disk-scan fallback must pick
`max(existing_archive_versions) + 1` — never an existing slot — so no prior
archive is ever overwritten.
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

LUMPS_DIR = os.path.join(os.path.dirname(_app_module.__file__), "lumps")


# ── Module-scoped snapshot/restore ───────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    Tests here POST /api/lumps/save and write archive lump files directly into
    the real server/lumps/ directory.  Per-test try/finally blocks handle the
    nominal case, but a mid-suite failure could leave stale archive files or a
    corrupt manifest.json behind.  This module-scoped autouse fixture holds the
    cross-process lumps_write_lock for the entire snapshot → tests → restore
    span and guarantees full restoration even on unexpected failures.
    """
    from tests.boot.conftest import lumps_write_lock
    import shutil as _shutil

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


_HEADER = (0x1F << 27) | 1
_BINARY_A = [_HEADER] + [0xAAAAAAAA] + [0] * 62
_BINARY_B = [_HEADER] + [0xBBBBBBBB] + [0] * 62


def _pack_lump(words):
    return struct.pack(f">{len(words)}I", *words)


def _meta(token):
    return {
        "token":           token,
        "abstraction":     "FallbackRegressionAbs",
        "ns_slot":         None,
        "cw":              1,
        "cc":              0,
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


def _cleanup(token):
    manifest_path = os.path.join(LUMPS_DIR, "manifest.json")
    for fn in os.listdir(LUMPS_DIR):
        if fn.startswith(token) or fn.startswith("FallbackRegressionAbs.1.") or fn.startswith("FallbackRegressionAbs_v"):
            try:
                os.remove(os.path.join(LUMPS_DIR, fn))
            except OSError:
                pass
    try:
        man = json.load(open(manifest_path))
        json.dump(
            [e for e in man if e.get("token") != token],
            open(manifest_path, "w"),
            indent=2,
        )
    except Exception:
        pass


@pytest.fixture()
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


class TestArchiveFallbackVersionSelection:
    """Fallback: corrupt sidecar+manifest → disk scan → max+1 (never overwrite)."""

    def test_fallback_skips_existing_versions(self, client):
        """Pre-existing archives v1,v2,v3 on disk → fallback must create v4, not v3."""
        token = "fa110001"
        try:
            raw_a = _pack_lump(_BINARY_A)
            for v in [1, 2, 3]:
                with open(os.path.join(LUMPS_DIR, f"FallbackRegressionAbs_v{v}.lump"), "wb") as f:
                    f.write(raw_a)
                with open(os.path.join(LUMPS_DIR, f"FallbackRegressionAbs_v{v}.json"), "w") as f:
                    json.dump({"lump_version": v}, f)
            with open(os.path.join(LUMPS_DIR, f"{token}.lump"), "wb") as f:
                f.write(raw_a)

            resp = client.post("/api/lumps/save", json={"binary": _BINARY_B, "metadata": _meta(token)})
            data = resp.get_json()
            assert data.get("ok"), f"Save failed: {data}"

            assert os.path.isfile(os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v4.lump")), \
                "Fallback must create immutable abstraction archive v4"

            with open(os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v3.lump"), "rb") as f:
                v3_bytes = f.read()
            assert v3_bytes == raw_a, "-v3.lump must not be overwritten by the fallback"
        finally:
            _cleanup(token)

    def test_fallback_no_existing_archives_creates_v0(self, client):
        """When no archives exist at all, fallback must start at v0."""
        token = "fa110002"
        try:
            raw_a = _pack_lump(_BINARY_A)
            with open(os.path.join(LUMPS_DIR, f"{token}.lump"), "wb") as f:
                f.write(raw_a)

            resp = client.post("/api/lumps/save", json={"binary": _BINARY_B, "metadata": _meta(token)})
            data = resp.get_json()
            assert data.get("ok"), f"Save failed: {data}"

            assert os.path.isfile(os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v0.lump")), \
                "With no prior archives, fallback must create immutable abstraction archive v0"
        finally:
            _cleanup(token)

    def test_sidecar_missing_lump_version_falls_through_to_manifest(self, client):
        """Sidecar exists but lacks lump_version → must fall through to manifest/disk, not archive as v0."""
        token = "fa110005"
        try:
            raw_a = _pack_lump(_BINARY_A)
            # Write current lump + sidecar WITHOUT lump_version key
            with open(os.path.join(LUMPS_DIR, f"{token}.lump"), "wb") as f:
                f.write(raw_a)
            with open(os.path.join(LUMPS_DIR, f"{token}.json"), "w") as f:
                json.dump({"abstraction": "NoVerField", "cw": 1, "cc": 0}, f)

            # Pre-seed manifest with a known lump_version so the fallback picks it up
            manifest_path = os.path.join(LUMPS_DIR, "manifest.json")
            man = json.load(open(manifest_path))
            man.append({"token": token, "lump_version": 7, "abstraction": "NoVerField"})
            json.dump(man, open(manifest_path, "w"), indent=2)

            resp = client.post("/api/lumps/save", json={"binary": _BINARY_B, "metadata": _meta(token)})
            data = resp.get_json()
            assert data.get("ok"), f"Save failed: {data}"

            # Fallback should have used manifest's v7, so archive is -v7.lump
            assert os.path.isfile(os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v7.lump")), \
                "Fallback must use manifest lump_version (v7) when sidecar lacks lump_version"
            # And NOT create -v0.lump
            assert not os.path.isfile(os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v0.lump")), \
                "-v0.lump must NOT be created when manifest provides a valid version"
        finally:
            _cleanup(token)

    def test_words_endpoint_rejects_missing_sidecar(self, client):
        """words/<version> must reject archives that cannot prove metadata integrity."""
        token = "fa110004"
        try:
            # Build a header with known cw=5, cc=3 using canonical layout:
            # bits[22:10] = cw, bits[7:0] = cc
            cw_expected = 5
            cc_expected = 3
            h0 = (0x1F << 27) | (cw_expected << 10) | cc_expected
            binary = [h0] + [0] * 63
            raw = _pack_lump(binary)

            # Write only the archive lump — no sidecar — so fallback header decode fires
            arch_lump = os.path.join(LUMPS_DIR, f"{token}-v1.lump")
            with open(arch_lump, "wb") as f:
                f.write(raw)

            resp = client.get(f"/api/lumps/{token}/words/1")
            assert resp.status_code == 409, f"Unexpected status: {resp.status_code}"
            data = resp.get_json()
            assert "sidecar is missing" in data["error"]
        finally:
            _cleanup(token)

    def test_normal_path_monotonic_increment(self, client):
        """Normal path (sidecar present): version numbers increase 1 → 2 → 3."""
        token = "fa110003"
        try:
            results = []
            for binary in [_BINARY_A, _BINARY_B, _BINARY_A]:
                resp = client.post("/api/lumps/save", json={"binary": binary, "metadata": _meta(token)})
                data = resp.get_json()
                assert data.get("ok"), f"Save failed: {data}"
                results.append(data.get("lump_version"))
            assert results == [1, 2, 3], f"Expected [1,2,3], got {results}"
        finally:
            _cleanup(token)

    def test_archive_sidecar_field_completeness_normal_path(self, client):
        """Archive sidecar written on normal save must contain essential metadata fields."""
        token = "fa110006"
        try:
            resp = client.post("/api/lumps/save", json={"binary": _BINARY_A, "metadata": _meta(token)})
            assert resp.get_json().get("ok"), "First save failed"
            resp2 = client.post("/api/lumps/save", json={"binary": _BINARY_B, "metadata": _meta(token)})
            assert resp2.get_json().get("ok"), "Second save failed"

            sc_path = os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v1.json")
            assert os.path.isfile(sc_path), "Archive sidecar -v1.json must exist after second save"
            sc = json.load(open(sc_path))
            for field in ("lump_version", "cw", "cc", "abstraction"):
                assert field in sc, f"Archive sidecar missing required field: {field}"
        finally:
            _cleanup(token)


class TestArchiveFilesCreatedOnSave:
    """Two saves for the same token must produce exactly one archived v1 pair on disk,
    with the current file reflecting the second binary."""

    def test_archive_pair_created_and_history_correct(self, client):
        """POST binary A then binary B for same token.

        After two saves:
        - history endpoint returns exactly one entry at version 1
        - <token>-v1.lump and <token>-v1.json exist on disk
        - <token>.lump contains binary B, not binary A
        """
        token = "fa110007"
        raw_a = _pack_lump(_BINARY_A)
        raw_b = _pack_lump(_BINARY_B)
        try:
            resp1 = client.post("/api/lumps/save", json={"binary": _BINARY_A, "metadata": _meta(token)})
            data1 = resp1.get_json()
            assert data1.get("ok"), f"First save failed: {data1}"

            resp2 = client.post("/api/lumps/save", json={"binary": _BINARY_B, "metadata": _meta(token)})
            data2 = resp2.get_json()
            assert data2.get("ok"), f"Second save failed: {data2}"

            hist_resp = client.get(f"/api/lumps/{token}/history")
            assert hist_resp.status_code == 200, f"History endpoint returned {hist_resp.status_code}"
            hist_data = hist_resp.get_json()
            history = hist_data.get("history", [])
            assert len(history) == 2, (
                f"Expected current plus archived history entries, got {len(history)}: {history}"
            )
            archived = next(row for row in history if row["version"] == 1)
            assert archived["current"] is False
            assert archived["preview_enabled"] is True
            assert next(row for row in history if row["version"] == 2)["current"] is True

            v1_lump = os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v1.lump")
            v1_json = os.path.join(LUMPS_DIR, "FallbackRegressionAbs_v1.json")
            assert os.path.isfile(v1_lump), f"Archived lump {token}-v1.lump must exist on disk"
            assert os.path.isfile(v1_json), f"Archived sidecar {token}-v1.json must exist on disk"

            manifest = json.load(open(os.path.join(LUMPS_DIR, "manifest.json")))
            current_entry = next(e for e in manifest if e.get("token") == token)
            current_lump = os.path.join(LUMPS_DIR, current_entry["filename"])
            with open(current_lump, "rb") as fh:
                current_words = struct.unpack(">64I", fh.read())
            assert current_words[1] == _BINARY_B[1], (
                "Current lump must contain binary B's payload marker"
            )
            with open(v1_lump, "rb") as fh:
                archived_words = struct.unpack(">64I", fh.read())
            assert archived_words[1] == _BINARY_A[1], (
                "Archived v1.lump must contain binary A's payload marker"
            )
        finally:
            _cleanup(token)
