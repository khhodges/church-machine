"""tests/lump/test_lump_source_roundtrip.py

Automated regression test: the ``source`` field supplied to ``/api/lumps/save``
must round-trip exactly through ``/api/lumps/<token>/detail``.

Two complementary assertions are made for every save:

1. **Detail round-trip** — ``GET /api/lumps/<token>/detail`` returns a JSON
   object whose ``source`` value is byte-for-byte identical to what was posted.

2. **Lean-list contract** — ``GET /api/lumps/list`` returns an array of
   objects; *none* of those objects must carry a ``source`` key for the saved
   token.  (The list endpoint is intentionally lean so the IDE can download the
   full catalogue without transmitting potentially large source strings.)

Token ``5c41ce01`` is a reserved test token. The teardown fixture removes all
files written by this test from the lumps directory and manifest.
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

_TEST_TOKEN = "5c41ce01"

_HEADER = (0x1F << 27) | (1 << 10) | 0
_BINARY = [_HEADER, 0x00000000]

_SOURCE_TEXT = """; Round-trip test source
abstraction RoundTripDemo
  method Go
    HALT
  end
end
"""


def _build_meta(source: str = _SOURCE_TEXT):
    return {
        "token":           _TEST_TOKEN,
        "abstraction":     "RoundTripDemo",
        "ns_slot":         None,
        "cw":              1,
        "cc":              0,
        "profile":         "IoT",
        "language":        "assembly",
        "author":          "pytest",
        "version":         "test",
        "methods":         [],
        "capabilities":    [],
        "grants":          ["E"],
        "content_type":    "code",
        "pet_names_dr":    {},
        "pet_names_cr":    {},
        "mtbf_clean_runs": 0,
        "mtbf_total_runs": 0,
        "mtbf_status":     "unknown",
        "source":          source,
    }


_ABS_STEM = "RoundTripDemo"


# ── Module-scoped snapshot/restore ───────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    Tests here POST /api/lumps/save to the real server/lumps/ directory.  The
    per-test clean_test_token fixture performs targeted cleanup, but a
    mid-suite failure could leave stale lump/sidecar files or a corrupt
    manifest.json behind.  This module-scoped autouse fixture holds the
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


def _cleanup():
    """Remove all files and manifest entries created by this test suite.

    Two naming patterns must be covered:
    - Token-prefix files  e.g. 5c41ce01.lump / 5c41ce01.json
    - Abstraction-stem files  e.g. RoundTripDemo_v1.lump / RoundTripDemo_v1.json

    The server derives filenames from the abstraction name, not the token, so
    forgetting the stem pattern causes test artifacts to accumulate on disk.
    """
    manifest_path = os.path.join(LUMPS_DIR, "manifest.json")
    for fn in os.listdir(LUMPS_DIR):
        if fn.startswith(_TEST_TOKEN) or fn.startswith(_ABS_STEM):
            try:
                os.remove(os.path.join(LUMPS_DIR, fn))
            except OSError:
                pass
    try:
        with open(manifest_path) as fh:
            man = json.load(fh)
        with open(manifest_path, "w") as fh:
            json.dump(
                [
                    e for e in man
                    if e.get("token") != _TEST_TOKEN
                    and e.get("abstraction") != _ABS_STEM
                ],
                fh,
                indent=2,
            )
    except Exception:
        pass


@pytest.fixture(autouse=True)
def clean_test_token():
    _cleanup()
    yield
    _cleanup()


@pytest.fixture()
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


class TestSourceRoundTrip:
    """source field must survive save → detail exactly."""

    def test_source_present_in_detail_after_save(self, client):
        """A non-empty source string posted to /api/lumps/save is returned
        verbatim by /api/lumps/<token>/detail."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BINARY, "metadata": _build_meta()},
        )
        data = resp.get_json()
        assert resp.status_code == 200, f"Save returned {resp.status_code}: {data}"
        assert data.get("ok"), f"Save response not ok: {data}"

        detail_resp = client.get(f"/api/lumps/{_TEST_TOKEN}/detail")
        assert detail_resp.status_code == 200, (
            f"Detail returned {detail_resp.status_code}: {detail_resp.get_json()}"
        )
        detail = detail_resp.get_json()
        assert "source" in detail, "Detail response must contain a 'source' key"
        assert detail["source"] == _SOURCE_TEXT, (
            f"Source mismatch.\n"
            f"  Expected: {_SOURCE_TEXT!r}\n"
            f"  Got:      {detail['source']!r}"
        )

    def test_source_empty_string_round_trips(self, client):
        """An empty source string must also round-trip (not become None or be
        dropped)."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BINARY, "metadata": _build_meta(source="")},
        )
        assert resp.get_json().get("ok"), f"Save failed: {resp.get_json()}"

        detail = client.get(f"/api/lumps/{_TEST_TOKEN}/detail").get_json()
        assert "source" in detail, "Detail response must contain 'source' key even when empty"
        assert detail["source"] == "", (
            f"Empty source must round-trip as empty string, got: {detail['source']!r}"
        )

    def test_multiline_source_with_special_chars_round_trips(self, client):
        """Source strings containing Unicode, tabs, and newlines must
        survive JSON serialisation/deserialisation unchanged."""
        special = "λx.x\n\t; unicode λ ∀ ∃\n; emoji 🏁\n"
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BINARY, "metadata": _build_meta(source=special)},
        )
        assert resp.get_json().get("ok"), f"Save failed: {resp.get_json()}"

        detail = client.get(f"/api/lumps/{_TEST_TOKEN}/detail").get_json()
        assert detail.get("source") == special, (
            f"Special-character source mismatch.\n"
            f"  Expected: {special!r}\n"
            f"  Got:      {detail.get('source')!r}"
        )


class TestLeanListContract:
    """GET /api/lumps/list must NOT include the source field for any entry."""

    def test_source_absent_from_list_entry(self, client):
        """After saving a lump with a source field, the list endpoint must
        not include 'source' on any entry."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BINARY, "metadata": _build_meta()},
        )
        assert resp.get_json().get("ok"), f"Save failed: {resp.get_json()}"

        list_resp = client.get("/api/lumps/list")
        assert list_resp.status_code == 200, (
            f"List returned {list_resp.status_code}"
        )
        entries = list_resp.get_json()
        assert isinstance(entries, list), "List endpoint must return a JSON array"

        for entry in entries:
            assert "source" not in entry, (
                f"List entry for token {entry.get('token')!r} must not carry "
                f"'source' (lean-list contract violated).\n"
                f"Keys found: {list(entry.keys())}"
            )

    def test_detail_has_source_while_list_does_not(self, client):
        """Detail endpoint includes source; list endpoint omits it — both
        for the same token."""
        resp = client.post(
            "/api/lumps/save",
            json={"binary": _BINARY, "metadata": _build_meta()},
        )
        assert resp.get_json().get("ok"), f"Save failed: {resp.get_json()}"

        detail = client.get(f"/api/lumps/{_TEST_TOKEN}/detail").get_json()
        assert "source" in detail, "Detail endpoint must include 'source'"
        assert detail["source"] == _SOURCE_TEXT

        entries = client.get("/api/lumps/list").get_json()
        matching = [e for e in entries if e.get("token") == _TEST_TOKEN]
        assert len(matching) == 1, (
            f"Expected exactly 1 list entry for {_TEST_TOKEN}, found {len(matching)}"
        )
        assert "source" not in matching[0], (
            f"List entry for {_TEST_TOKEN} must not carry 'source'; "
            f"keys present: {list(matching[0].keys())}"
        )
