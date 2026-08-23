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


def _historical_snapshot(name, slot=6, raw_word=0x4A000006, hardware_version=401):
    """Create a server-format snapshot without involving browser state."""
    namespace = {
        "decoded_slots": [{
            "name": name,
            "slot": slot,
            "location": "0x00000200",
            "type": "Inform",
            "token": "00000600",
        }],
        "raw": {
            "total_words": 16384,
            "max_entries": 256,
            "ns_table_base": 15360,
            "entries": [{"slot": slot, "w0": 0x200, "w1": 0, "w2": 0, "w3": raw_word}],
        },
    }
    return {
        "schema_version": _app._NAMESPACE_SNAPSHOT_SCHEMA_VERSION,
        "fingerprint": _app._namespace_snapshot_fingerprint(namespace),
        "captured_at": "2026-08-23T00:00:00Z",
        "authority": "server-committed-namespace",
        "provenance": {"hardware_version": hardware_version, "source_commit": "snapshot-test"},
        "namespace": namespace,
    }


def _seed_snapshot_record(snapshot, hardware_version=401, status="succeeded",
                          bit_hash=""):
    record = _app.BuildRecord(
        version=0,
        timestamp=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        board="wukong-xc7a100t",
        status=status,
        git_commit="snapshot-test",
        hardware_version=hardware_version,
        ns_snapshot=json.dumps(snapshot),
        bit_hash=bit_hash,
    )
    _app.db.session.add(record)
    _app.db.session.flush()
    record.version = record.id
    _app.db.session.commit()
    return record


def test_historical_namespace_detail_stays_at_build_a_after_live_namespace_moves_b():
    """Historical recall returns saved A, not today's live Namespace B."""
    build_a = _seed_snapshot_record(_historical_snapshot("Namespace.A"))
    # This represents a later committed project namespace. It is intentionally
    # not sent to any history endpoint and must not influence build A's recall.
    live_namespace_b = _historical_snapshot("Namespace.B")
    assert live_namespace_b["fingerprint"] != _historical_snapshot("Namespace.A")["fingerprint"]

    with _app.app.test_client() as c:
        response = c.get(f"/api/builds/{build_a.id}/namespace")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["available"] is True
    assert payload["snapshot"]["namespace"]["decoded_slots"][0]["name"] == "Namespace.A"
    assert payload["snapshot"]["fingerprint"] != live_namespace_b["fingerprint"]
    # The detail response is bounded and must not expose artifact locations.
    raw = response.data.decode()
    assert "bit_path" not in raw
    assert "/home/runner" not in raw


def test_namespace_match_is_explicitly_unavailable_or_ambiguous():
    """Reported FPGA versions must never fall back to the current live Namespace."""
    assert _app._namespace_match_for_hardware_version(987654)["state"] == "unavailable"

    _seed_snapshot_record(_historical_snapshot("Namespace.One", raw_word=0x4A000006),
                          hardware_version=402)
    _seed_snapshot_record(_historical_snapshot("Namespace.Two", raw_word=0x4A000007),
                          hardware_version=402)
    result = _app._namespace_match_for_hardware_version(402)
    assert result["state"] == "ambiguous"


def test_build_list_only_advertises_snapshot_and_detail_exposes_it():
    """The list is metadata-only; raw four-word Namespace entries need explicit detail."""
    record = _seed_snapshot_record(_historical_snapshot("Namespace.List"), hardware_version=403)
    with _app.app.test_client() as c:
        listing = c.get("/api/builds").get_json()
    row = next(item for item in listing["builds"] if item["id"] == record.id)
    assert row["namespace_snapshot"] is True
    assert row["hardware_version"] == 403
    assert "ns_snapshot" not in row
    assert "raw" not in row


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


def test_post_builds_cannot_supply_namespace_authority():
    """An external caller's Namespace JSON cannot become a trusted build snapshot."""
    token = _token()
    attacker_snapshot = _historical_snapshot("Attacker.Namespace")
    with _app.app.test_client() as c:
        response = c.post(
            f"/api/builds?token={token}",
            data=json.dumps({
                "board": "wukong-xc7a100t",
                "status": "succeeded",
                "hardware_version": 404,
                "ns_snapshot": attacker_snapshot,
            }),
            content_type="application/json",
        )
    assert response.status_code == 200
    stored = _app.db.session.get(_app.BuildRecord, response.get_json()["id"])
    assert stored.ns_snapshot is None


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


def test_verified_upload_inherits_only_matching_approved_snapshot(tmp_path, monkeypatch):
    """A verified artifact gets its exact approved Namespace, never the live one."""
    import hashlib
    import io

    token = _token()
    artifact = b"\xff" * 128
    snapshot = _historical_snapshot("Approved.Namespace", hardware_version=405)
    approved = _seed_snapshot_record(
        snapshot, hardware_version=405, bit_hash=hashlib.md5(artifact).hexdigest())
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))

    with _app.app.test_client() as c:
        response = c.post(
            f"/upload/wukong-bit?token={token}&version=405&commit=snapshot-test"
            f"&build_record_id={approved.id}",
            data={"file": (io.BytesIO(artifact), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
    assert response.status_code == 200
    assert response.get_json()["namespace_snapshot"] is True
    upload = (
        _app.BuildRecord.query.filter_by(
            board="wukong-xc7a100t", hardware_version=405, notes="upload"
        ).order_by(_app.BuildRecord.id.desc()).first()
    )
    assert upload is not None
    assert json.loads(upload.ns_snapshot)["fingerprint"] == snapshot["fingerprint"]
    refreshed_approved = _app.db.session.get(_app.BuildRecord, approved.id)
    assert refreshed_approved.bit_hash == response.get_json()["md5"]


def test_upload_without_exact_build_binding_keeps_namespace_unavailable(tmp_path, monkeypatch):
    """Version-only or mismatched-commit uploads must not borrow an approved snapshot."""
    import io

    token = _token()
    snapshot = _historical_snapshot("Bound.Namespace", hardware_version=406)
    approved = _seed_snapshot_record(snapshot, hardware_version=406,
                                     bit_hash="0" * 32)
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))

    with _app.app.test_client() as c:
        version_only = c.post(
            f"/upload/wukong-bit?token={token}&version=406&commit=snapshot-test",
            data={"file": (io.BytesIO(b"\xaa" * 64), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
        wrong_commit = c.post(
            f"/upload/wukong-bit?token={token}&version=406&commit=wrong"
            f"&build_record_id={approved.id}",
            data={"file": (io.BytesIO(b"\xbb" * 64), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
    assert version_only.status_code == 200
    assert version_only.get_json()["namespace_snapshot"] is False
    assert wrong_commit.status_code == 409
    assert wrong_commit.get_json()["namespace_snapshot"] is False
    unavailable = (
        _app.BuildRecord.query.filter_by(
            board="wukong-xc7a100t", hardware_version=406,
            notes="upload_namespace_unavailable",
        ).all()
    )
    assert unavailable
    assert unavailable[-1].ns_snapshot is None
    rejected = _app.BuildRecord.query.filter_by(
        board="wukong-xc7a100t", hardware_version=406,
        notes="build_binding_rejected",
    ).all()
    assert rejected


def test_bound_upload_rejects_wrong_digest_and_replay(tmp_path, monkeypatch):
    """Only the remote-produced bytes may bind once to an approved snapshot."""
    import hashlib
    import io

    token = _token()
    approved_bytes = b"APPROVED REMOTE ARTIFACT"
    snapshot = _historical_snapshot("Digest.Namespace", hardware_version=407)
    approved = _seed_snapshot_record(
        snapshot,
        hardware_version=407,
        bit_hash=hashlib.md5(approved_bytes).hexdigest(),
    )
    monkeypatch.setattr(_app, "_wukong_build_dir", lambda: str(tmp_path))
    previous_path = tmp_path / "church_wukong_xc7a100t.bit"
    previous_path.write_bytes(b"PREVIOUS")

    url = (
        f"/upload/wukong-bit?token={token}&version=407&commit=snapshot-test"
        f"&build_record_id={approved.id}"
    )
    with _app.app.test_client() as c:
        mismatch = c.post(
            url,
            data={"file": (io.BytesIO(b"WRONG"), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
        accepted = c.post(
            url,
            data={"file": (io.BytesIO(approved_bytes), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
        replay = c.post(
            url,
            data={"file": (io.BytesIO(approved_bytes), "church_wukong_xc7a100t.bit")},
            content_type="multipart/form-data",
        )
    assert mismatch.status_code == 409
    assert previous_path.read_bytes() == approved_bytes
    assert accepted.status_code == 200
    assert accepted.get_json()["namespace_snapshot"] is True
    assert replay.status_code == 409


def test_historical_recall_ui_is_read_only_and_build_keyed():
    """Historical hardware context must not become browser Namespace authority."""
    with open(os.path.join(ROOT, "simulator", "app-run.js"), encoding="utf-8") as handle:
        run_js = handle.read()
    recall_body = run_js.split("async function recallBuildNamespace", 1)[1].split(
        "function openHistoricalFpgaNamespaceContext", 1
    )[0]
    assert "sim._nsState =" not in recall_body
    assert "sim._nsState." not in recall_body
    assert "/api/boot-image/save-ns" not in recall_body
    assert "localStorage" not in recall_body
    assert "String(nsMatch.build_id) + ':' + String(nsMatch.fingerprint)" in run_js


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
