"""Tests for the /api/builds build-history endpoints.

These are integration tests that run against the same DB the server uses.
They do NOT attempt to override SQLALCHEMY_DATABASE_URI after import (which
has no effect once the engine is created).

Covers:
  - GET /api/builds response shape: no server paths, no notes field
  - GET /api/builds never leaks path-bearing notes even when stored in DB
  - POST /api/builds: 401 without REPORT_TOKEN
  - POST /api/builds: 401/503 without REPORT_TOKEN configured
  - POST /api/builds: 200 with valid token, version == id (atomic)
  - POST /api/builds: ignores caller-supplied bit_path / mcs_path
  - _record_build_event: stored notes never contain filesystem separators
  - Yosys exception path: synth_warning uses fixed string, not str(exception)
"""
import json
import os
import sys
import datetime
import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app

_flask_client = _app.app.test_client()
_ctx = _app.app.app_context()


@pytest.fixture(scope="module", autouse=True)
def app_context():
    """Push an application context for the whole module."""
    with _app.app.app_context():
        yield


def _token():
    t = os.environ.get("REPORT_TOKEN", "")
    if not t:
        pytest.skip("REPORT_TOKEN not configured")
    return t


# ── GET /api/builds response shape ───────────────────────────────────────────

def test_get_builds_returns_ok():
    with _app.app.test_client() as c:
        resp = c.get("/api/builds")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert isinstance(data["builds"], list)


def test_get_builds_no_server_paths_or_notes():
    """Every record in the public listing must omit bit_path, mcs_path, and notes."""
    # Seed one record directly so we have something to inspect.
    br = _app.BuildRecord(
        version=0,
        timestamp=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        board="wukong-xc7a100t",
        status="succeeded",
        bit_path="/home/runner/workspace/build/church_wukong.bit",
        mcs_path="/home/runner/workspace/build/church_wukong.mcs",
        bit_hash="cafebabe",
        notes="internal_error",
    )
    _app.db.session.add(br)
    _app.db.session.flush()
    br.version = br.id
    _app.db.session.commit()
    seeded_id = br.id

    with _app.app.test_client() as c:
        resp = c.get("/api/builds")
    assert resp.status_code == 200
    payload = resp.get_json()

    row = next((b for b in payload["builds"] if b["id"] == seeded_id), None)
    assert row is not None, "Seeded build record was not returned by GET /api/builds"
    assert "bit_path" not in row, "bit_path must not appear in public response"
    assert "mcs_path" not in row, "mcs_path must not appear in public response"
    assert "notes" not in row, "notes must not appear in public response"


def test_get_builds_no_path_in_raw_response():
    """Even if notes contain a filesystem path, the raw JSON response must not expose it."""
    br = _app.BuildRecord(
        version=0,
        timestamp=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        board="wukong-xc7a100t",
        status="failed",
        notes="FileNotFoundError: /home/runner/workspace/build/church.bit",
    )
    _app.db.session.add(br)
    _app.db.session.flush()
    br.version = br.id
    _app.db.session.commit()

    with _app.app.test_client() as c:
        resp = c.get("/api/builds")
    assert resp.status_code == 200
    raw = resp.data.decode()
    assert "/home/runner" not in raw, (
        "Server filesystem path leaked into public response via notes or other field"
    )


# ── POST /api/builds auth ─────────────────────────────────────────────────────

def test_post_builds_requires_token_unauthenticated():
    """POST without a token must return 401 (token present) or 503 (no token configured)."""
    with _app.app.test_client() as c:
        resp = c.post(
            "/api/builds",
            data=json.dumps({"board": "wukong-xc7a100t", "status": "succeeded"}),
            content_type="application/json",
        )
    assert resp.status_code in (401, 503), (
        f"Expected 401 or 503 without auth, got {resp.status_code}"
    )


def test_post_builds_with_token_creates_record():
    """POST with a valid REPORT_TOKEN must create a record and return version == id."""
    token = _token()
    with _app.app.test_client() as c:
        resp = c.post(
            f"/api/builds?token={token}",
            data=json.dumps({
                "board": "wukong-xc7a100t",
                "status": "succeeded",
                "bit_hash": "deadbeef",
                "notes": "ci-test-record",
            }),
            content_type="application/json",
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert isinstance(data["id"], int)
    # Version must equal id (atomic allocation via flush)
    assert data["version"] == data["id"], (
        f"version {data['version']} != id {data['id']} — atomic allocation broken"
    )


def test_post_builds_ignores_caller_supplied_paths():
    """POST body must not allow callers to write server paths into bit_path or mcs_path."""
    token = _token()
    with _app.app.test_client() as c:
        resp = c.post(
            f"/api/builds?token={token}",
            data=json.dumps({
                "board": "wukong-xc7a100t",
                "status": "succeeded",
                "bit_path": "/home/runner/workspace/build/evil.bit",
                "mcs_path": "/home/runner/workspace/build/evil.mcs",
            }),
            content_type="application/json",
        )
    assert resp.status_code == 200
    rec_id = resp.get_json()["id"]

    # Verify the record does not store caller-supplied paths
    stored = _app.db.session.get(_app.BuildRecord, rec_id)
    assert stored is not None
    assert stored.bit_path == "", f"bit_path must be empty, got {stored.bit_path!r}"
    assert stored.mcs_path == "", f"mcs_path must be empty, got {stored.mcs_path!r}"


# ── _record_build_event safe notes ───────────────────────────────────────────

def test_record_build_event_no_path_in_notes():
    """_record_build_event with 'internal_error' must store no filesystem separators."""
    rec_id = _app._record_build_event(
        board="wukong-xc7a100t",
        status="failed",
        notes="internal_error",
    )
    assert rec_id is not None
    stored = _app.db.session.get(_app.BuildRecord, rec_id)
    assert stored is not None
    assert "/" not in stored.notes, f"Filesystem separator in notes: {stored.notes!r}"
    assert "\\" not in stored.notes, f"Filesystem separator in notes: {stored.notes!r}"


def test_record_build_event_version_equals_id():
    """_record_build_event must allocate version = id (no MAX+1 race)."""
    rec_id = _app._record_build_event(
        board="wukong-xc7a100t",
        status="succeeded",
        notes="",
    )
    assert rec_id is not None
    stored = _app.db.session.get(_app.BuildRecord, rec_id)
    assert stored is not None
    assert stored.version == stored.id, (
        f"version {stored.version} != id {stored.id}"
    )


# ── Upload recording ─────────────────────────────────────────────────────────

def test_upload_requires_token_fail_closed():
    """Upload endpoint must fail closed (503) when REPORT_TOKEN is absent."""
    import io
    # Temporarily unset REPORT_TOKEN to test fail-closed behaviour
    original = os.environ.pop("REPORT_TOKEN", None)
    try:
        with _app.app.test_client() as c:
            resp = c.post(
                "/upload/wukong-bit",
                data={"file": (io.BytesIO(b"\x00" * 4), "church.bit")},
                content_type="multipart/form-data",
            )
        assert resp.status_code == 503, (
            f"Expected 503 when REPORT_TOKEN absent, got {resp.status_code}"
        )
    finally:
        if original is not None:
            os.environ["REPORT_TOKEN"] = original


def test_upload_mkdir_failure_records_failed_event(tmp_path, monkeypatch):
    """An os.makedirs failure must produce a failed BuildRecord, not an unrecorded 500."""
    import io

    token = _token()
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))

    import os as _os
    original_makedirs = _os.makedirs

    def _bad_makedirs(path, *args, **kwargs):
        raise PermissionError("read-only filesystem")

    monkeypatch.setattr(_os, "makedirs", _bad_makedirs)

    count_before = _app.BuildRecord.query.filter_by(
        board="wukong-xc7a100t", status="failed"
    ).count()

    with _app.app.test_client() as c:
        resp = c.post(
            f"/upload/wukong-bit?token={token}",
            data={"file": (io.BytesIO(b"\xff" * 64), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 500, (
        f"Expected 500 on mkdir failure, got {resp.status_code}"
    )
    count_after = _app.BuildRecord.query.filter_by(
        board="wukong-xc7a100t", status="failed"
    ).count()
    assert count_after > count_before, (
        "No failed BuildRecord was persisted after an os.makedirs failure"
    )
    latest_failed = (
        _app.BuildRecord.query
        .filter_by(board="wukong-xc7a100t", status="failed")
        .order_by(_app.BuildRecord.id.desc())
        .first()
    )
    assert latest_failed.notes == "save_error"
    assert "/" not in (latest_failed.notes or ""), "Filesystem path in failure notes"


def test_upload_save_failure_records_failed_event(tmp_path, monkeypatch):
    """A filesystem error during save must record a failed BuildRecord, not be silently dropped."""
    import io

    token = _token()
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))

    # Make FileStorage.save raise so the write step fails
    from werkzeug.datastructures import FileStorage
    original_save = FileStorage.save

    def _bad_save(self, dst, buffer_size=None):
        raise OSError("disk full")

    monkeypatch.setattr(FileStorage, "save", _bad_save)

    count_before = _app.BuildRecord.query.filter_by(
        board="wukong-xc7a100t", status="failed"
    ).count()

    with _app.app.test_client() as c:
        resp = c.post(
            f"/upload/wukong-bit?token={token}",
            data={"file": (io.BytesIO(b"\xff" * 64), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 500, (
        f"Expected 500 on write failure, got {resp.status_code}"
    )
    count_after = _app.BuildRecord.query.filter_by(
        board="wukong-xc7a100t", status="failed"
    ).count()
    assert count_after > count_before, (
        "No failed BuildRecord was persisted after a save error"
    )
    latest_failed = (
        _app.BuildRecord.query
        .filter_by(board="wukong-xc7a100t", status="failed")
        .order_by(_app.BuildRecord.id.desc())
        .first()
    )
    assert latest_failed.notes == "save_error", (
        f"Expected 'save_error' notes, got {latest_failed.notes!r}"
    )
    # No filesystem path must be stored
    assert "/" not in (latest_failed.notes or ""), "Filesystem path in failure notes"


def test_upload_recording_version_equals_id(tmp_path, monkeypatch):
    """Successful upload must record version == id; caller-supplied version must not override it.

    Uses a temporary directory for the build output so the real bitstream
    artifact on disk is never touched.
    """
    import io

    token = _token()
    caller_version = 999999  # must NOT appear as BuildRecord.version

    # Redirect the build directory to tmp_path so no real artifact is overwritten
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))

    with _app.app.test_client() as c:
        resp = c.post(
            f"/upload/wukong-bit?token={token}&version={caller_version}&approver=ci-test",
            data={
                "file": (io.BytesIO(b"\xff" * 256), "church_wukong_xc7a100t.bit"),
            },
            content_type="multipart/form-data",
        )

    assert resp.status_code == 200, (
        f"Upload failed: {resp.get_json()}"
    )

    # Find the most recent build record created by this upload
    latest = (
        _app.BuildRecord.query
        .filter_by(board="wukong-xc7a100t", status="succeeded")
        .order_by(_app.BuildRecord.id.desc())
        .first()
    )
    assert latest is not None
    assert latest.version == latest.id, (
        f"Upload build record version {latest.version} != id {latest.id} — "
        "caller-supplied version used instead of atomic id"
    )
    assert latest.version != caller_version, (
        "Caller-supplied version was incorrectly stored as BuildRecord.version"
    )


# ── Yosys exception sanitization ─────────────────────────────────────────────

def test_yosys_exception_synth_warning_is_fixed_string():
    """The Yosys exception branch must produce a fixed safe string, not str(exception)."""
    import server.app as _m
    import inspect
    src = inspect.getsource(_m.build_fpga)
    # The old unsafe pattern interpolated synth_exc into the warning.
    # Verify it is no longer present.
    assert "f\"Yosys synthesis error: {synth_exc}" not in src, (
        "Yosys exception still interpolates synth_exc — filesystem paths can leak into notes"
    )
    # The safe fixed string must be present.
    assert '"Yosys synthesis error (RTLIL still available)"' in src, (
        "Expected fixed safe Yosys error string not found in build_fpga source"
    )
