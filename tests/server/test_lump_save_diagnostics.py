"""Isolated tests for bounded, metadata-only SAVE LUMP diagnostics."""

import json
import pathlib
import subprocess
import sys
import types

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


@pytest.fixture
def diagnostic_store(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "_LUMP_SAVE_DIAGNOSTIC_MAX_BYTES", 2048)
    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_ROTATIONS", 2)
    with app_module._LUMP_SAVE_DIAGNOSTIC_RATE_LOCK:
        app_module._LUMP_SAVE_DIAGNOSTIC_RATE.clear()
        app_module._LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE.clear()
    return tmp_path


def _rows(root):
    paths = [root / "save-runtime-diagnostics.jsonl"]
    paths.extend(sorted(root.glob("save-runtime-diagnostics.jsonl.*")))
    rows = []
    for path in paths:
        if path.exists():
            rows.extend(json.loads(line) for line in path.read_text().splitlines())
    return rows


def test_browser_batch_is_sanitized_and_non_authoritative(diagnostic_store):
    with app_module.app.test_client() as client:
        with client.session_transaction() as saved_session:
            saved_session["_lump_approval_session"] = "test-approval-session"
        response = client.post(
            "/api/lumps/save-diagnostics",
            headers={"Origin": "http://localhost"},
            json={
                "events": [{
                    "event_id": "event-0001",
                    "diagnostic_attempt_id": "browser-attempt-1",
                    "operation_id": "save-op-0001",
                    "stage": "Reload",
                    "event": "exception",
                    "outcome": "unknown",
                    "elapsed_ms": 4,
                    "http_status": 200,
                    "error": {
                        "name": "Error",
                        "message": "reload failed authorization=top-secret",
                        "stack": "Error: reload\n at save (https://example.invalid/app.js)",
                        "cause": {
                            "name": "Cause",
                            "message": "source_text=never-retain-this",
                        },
                    },
                    "timestamp": "2025-01-02T03:04:05.000Z",
                    "source_text": "never-retain-this",
                    "request_body": {"binary": [1, 2, 3]},
                }],
            },
        )

    assert response.status_code == 202
    assert response.get_json() == {
        "accepted": 1,
        "accepted_event_ids": ["event-0001"],
        "ok": True,
        "received": 1,
    }
    rows = _rows(diagnostic_store)
    assert len(rows) == 1
    row = rows[0]
    assert row["source"] == "client"
    assert row["authoritative"] is False
    assert row["attempt_id"] == "browser-attempt-1"
    assert row["event_id"] == "event-0001"
    assert row["client_timestamp"] == "2025-01-02T03:04:05.000Z"
    assert row["error"]["name"] == "Error"
    serialized = json.dumps(row)
    assert "top-secret" not in serialized
    assert "never-retain-this" not in serialized
    assert "request_body" not in serialized


def test_real_frontend_error_shape_retains_code_and_occurred_at(
        diagnostic_store):
    root = pathlib.Path(__file__).resolve().parents[2]
    node_script = r"""
const diagnostics = require('./simulator/save_diagnostics.js');
const storage = {
  value: '',
  getItem() { return this.value; },
  setItem(_key, value) { this.value = value; }
};
const logger = diagnostics.createSaveDiagnostics({
  storage,
  now: () => 1735787045000,
  setTimeout: () => null
});
const metadata = { diagnostic_attempt_id: 'node-attempt-1' };
const event = logger.record(metadata, 'reload', 'exception', {
  outcome: 'committed',
  error: {
    code: 'reload_failed',
    reason: 'client supplied text must not be trusted',
    stack: 'at save (simulator/save_diagnostics.js:201:7)'
  }
});
process.stdout.write(JSON.stringify(event));
"""
    generated = subprocess.run(
        ["node", "-e", node_script], cwd=root, check=True,
        capture_output=True, text=True)
    frontend_event = json.loads(generated.stdout)

    with app_module.app.test_client() as client:
        response = client.post(
            "/api/lumps/save-diagnostics",
            json={"events": [frontend_event]},
        )
    assert response.status_code == 202
    row = _rows(diagnostic_store)[0]
    assert row["event_id"] == frontend_event["event_id"]
    assert row["occurred_at"] == "2025-01-02T03:04:05.000Z"
    assert row["client_timestamp"] == row["occurred_at"]
    assert row["timestamp"] != row["occurred_at"]
    assert row["error"]["code"] == "reload_failed"
    assert row["error"]["reason"] == (
        "The repository committed, but local reload failed.")
    assert "client supplied text" not in json.dumps(row)


def test_diagnostics_require_same_origin_and_have_no_read_endpoint(diagnostic_store):
    with app_module.app.test_client() as client:
        foreign = client.post(
            "/api/lumps/save-diagnostics",
            headers={"Origin": "https://attacker.invalid"},
            json={"events": []},
        )
        read = client.get("/api/lumps/save-diagnostics")

    assert foreign.status_code == 403
    assert read.status_code == 405
    assert not list(diagnostic_store.glob("save-runtime-diagnostics.jsonl*"))


def test_runtime_stream_does_not_touch_legacy_synthetic_stream(diagnostic_store):
    legacy = diagnostic_store / "save-diagnostics.jsonl"
    legacy.write_text('{"legacy":true}\n')
    with app_module.app.test_client() as client:
        response = client.post(
            "/api/lumps/save-diagnostics",
            json={"events": [{
                "event_id": "runtime-event",
                "stage": "Capture",
                "event": "start",
            }]},
        )
    assert response.status_code == 202
    assert legacy.read_text() == '{"legacy":true}\n'
    assert (diagnostic_store / "save-runtime-diagnostics.jsonl").exists()


def test_browser_origin_requires_origin_but_bootstraps_diagnostic_session(
        diagnostic_store):
    with app_module.app.test_client() as client:
        missing_origin = client.post(
            "/api/lumps/save-diagnostics",
            headers={"User-Agent": "Mozilla/5.0"},
            json={"events": []},
        )
        fresh_same_origin = client.post(
            "/api/lumps/save-diagnostics",
            headers={"Origin": "http://localhost"},
            json={"events": []},
        )
        with client.session_transaction() as saved_session:
            diagnostic_session = saved_session.get(
                app_module._LUMP_SAVE_DIAGNOSTIC_SESSION_KEY)
            approval_session = saved_session.get("_lump_approval_session")
    assert missing_origin.status_code == 403
    assert fresh_same_origin.status_code == 202
    assert isinstance(diagnostic_session, str)
    assert len(diagnostic_session) >= 16
    assert approval_session is None


def test_fresh_diagnostics_session_does_not_authorize_save(
        diagnostic_store):
    with app_module.app.test_client() as client:
        diagnostic = client.post(
            "/api/lumps/save-diagnostics",
            headers={"Origin": "http://localhost"},
            json={"events": []},
        )
        save = client.post(
            "/api/lumps/save",
            json={
                "binary": [0xF8000401, 0],
                "metadata": {
                    "abstraction": "FreshDiagnosticSave",
                    "capabilities": [],
                },
            },
        )

    assert diagnostic.status_code == 202
    # A diagnostic bootstrap is not a save preflight or approval intent.
    assert save.status_code == 403
    assert "save plan" in save.get_json()["error"]


def test_batch_size_and_rate_limits_are_fail_closed(diagnostic_store, monkeypatch):
    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_BYTES", 64)
    with app_module.app.test_client() as client:
        oversized = client.post(
            "/api/lumps/save-diagnostics",
            json={"events": [{"message": "x" * 200}]},
        )
        assert oversized.status_code == 413

    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_BYTES", 64 * 1024)
    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_RATE_LIMIT", 1)
    with app_module.app.test_client() as client:
        assert client.post(
            "/api/lumps/save-diagnostics", json={"events": []}
        ).status_code == 202
        limited = client.post(
            "/api/lumps/save-diagnostics", json={"events": []}
        )
    assert limited.status_code == 429


def test_ack_lists_only_event_ids_that_were_persisted(
        diagnostic_store, monkeypatch):
    persisted = []

    def append(event, **_kwargs):
        if event.get("event_id") == "event-failed":
            return False
        persisted.append(event["event_id"])
        return True

    monkeypatch.setattr(app_module, "_append_lump_diagnostic_event", append)
    with app_module.app.test_client() as client:
        response = client.post(
            "/api/lumps/save-diagnostics",
            json={"events": [
                {"event_id": "event-ok", "stage": "Capture", "event": "start"},
                {"event_id": "event-failed", "stage": "Commit",
                 "event": "exception"},
            ]},
        )
    assert response.status_code == 202
    assert response.get_json()["accepted"] == 1
    assert response.get_json()["accepted_event_ids"] == ["event-ok"]
    assert persisted == ["event-ok"]


def test_rotation_bounds_retained_files_and_logger_failure_is_best_effort(
        diagnostic_store, monkeypatch):
    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_MAX_BYTES", 512)
    with app_module.app.test_client() as client:
        for index in range(8):
            response = client.post(
                "/api/lumps/save-diagnostics",
                json={"events": [{
                    "attempt_id": f"attempt-{index}",
                    "stage": "Capture",
                    "event": "start",
                    "outcome": "unknown",
                    "message": "not an allowlisted field",
                }]},
            )
            assert response.status_code == 202

    paths = list(diagnostic_store.glob("save-runtime-diagnostics.jsonl*"))
    assert len(paths) <= 2
    assert all(path.stat().st_size <= 512 for path in paths)

    monkeypatch.setattr(
        app_module, "_append_lump_diagnostic_event", lambda *_a, **_k: False)
    with app_module.app.test_client() as client:
        response = client.post(
            "/api/lumps/save-diagnostics",
            json={"events": [{"attempt_id": "logger-failure", "event": "start"}]},
        )
    assert response.status_code == 202
    assert response.get_json()["accepted"] == 0


def test_sanitizer_and_logger_failures_cannot_escape(diagnostic_store, monkeypatch):
    def broken_sanitizer(*_args, **_kwargs):
        raise RuntimeError("sanitizer failure")

    monkeypatch.setattr(
        app_module, "_sanitize_lump_diagnostic_event", broken_sanitizer)
    monkeypatch.setattr(
        app_module.logging, "exception",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("logger failure")))
    assert app_module._append_lump_diagnostic_event({
        "event_id": "event-sanitizer-failure",
    }) is False


def test_rotation_preserves_event_that_triggers_rotation(
        diagnostic_store, monkeypatch):
    monkeypatch.setattr(app_module, "_LUMP_SAVE_DIAGNOSTIC_MAX_BYTES", 500)
    assert app_module._append_lump_diagnostic_event({
        "event_id": "event-before",
        "attempt_id": "attempt-before",
        "stage": "Capture",
        "event": "start",
        "outcome": "unknown",
    }, source="client")
    assert app_module._append_lump_diagnostic_event({
        "event_id": "event-trigger",
        "attempt_id": "attempt-trigger",
        "stage": "Commit",
        "event": "complete",
        "outcome": "committed",
        "error": {"message": "x" * 96},
    }, source="client")
    active = (diagnostic_store / "save-runtime-diagnostics.jsonl").read_text()
    rotated = (diagnostic_store / "save-runtime-diagnostics.jsonl.1").read_text()
    assert "event-trigger" in active
    assert "event-before" in rotated


def test_boot_image_save_records_authoritative_outcome(diagnostic_store):
    with app_module.app.test_client() as client:
        with client.session_transaction() as saved_session:
            saved_session["_lump_approval_session"] = "boot-session"
        response = client.post(
            "/api/boot-image/save-ns",
            headers={"Origin": "http://localhost"},
            json={
                "diagnostic_attempt_id": "browser-boot-attempt",
                "data_b64": "not-base64",
                "ns_state": {},
            },
        )
    assert response.status_code == 400
    rows = _rows(diagnostic_store)
    assert any(
        row.get("entry_point") == "/api/boot-image/save-ns"
        and row.get("authoritative") is True
        and row.get("outcome") == "rejected"
        and row.get("client_diagnostic_attempt_id") == "browser-boot-attempt"
        for row in rows
    )