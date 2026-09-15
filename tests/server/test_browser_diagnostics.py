"""Standalone tests for privacy-preserving browser diagnostics."""

import json
import logging

import pytest
from flask import Flask

from server import browser_diagnostics


@pytest.fixture
def diagnostics_app(tmp_path):
    (tmp_path / "simulator.js").write_text("console.log('ok');")
    (tmp_path / "styles.css").write_text("body {}")
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "not-served.js").write_text("secret")

    app = Flask(__name__)
    app.secret_key = "test"
    browser_diagnostics.reset_rate_limits_for_tests()
    browser_diagnostics.register_browser_diagnostics(
        app,
        simulator_dir=str(tmp_path),
        server_version=lambda: "abc1234",
    )
    yield app
    browser_diagnostics.reset_rate_limits_for_tests()


def _report(**overrides):
    report = {
        "kind": "script",
        "error_type": "Error",
        "occurred_at": "2025-01-02T03:04:05.000Z",
        "page": "editor",
        "interaction": "scroll",
        "browser": "chromium",
        "viewport": {"width": 1280, "height": 720},
        "frames": [{"file": "simulator.js", "line": 10, "column": 2}],
        "resource": "styles.css",
        "version": "abc1234",
    }
    report.update(overrides)
    return report


def test_report_is_reduced_to_safe_allowlist(diagnostics_app, caplog):
    with caplog.at_level(logging.WARNING, logger="browser_diagnostics"):
        with diagnostics_app.test_client() as client:
            response = client.post(
                "/api/browser-diagnostics",
                json={
                    **_report(),
                    "message": "do not retain this",
                    "url": "https://user:password@example.invalid/?token=secret",
                    "user_id": "person-123",
                    "headers": {"Cookie": "secret"},
                    "frames": [
                        {
                            "file": "simulator.js",
                            "line": 10,
                            "column": 2,
                            "source": "never retain",
                        }
                    ],
                },
            )

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert len(body["report_id"]) == 32
    records = [
        record.message
        for record in caplog.records
        if record.name == "browser_diagnostics"
    ]
    assert len(records) == 1
    assert records[0].startswith("BROWSER_DIAGNOSTIC ")
    logged = json.loads(records[0].split(" ", 1)[1])
    assert logged["server_version"] == "abc1234"
    assert logged["client_report"] == _report()
    assert "do not retain" not in records[0]
    assert "token=secret" not in records[0]
    assert "person-123" not in records[0]


def test_origin_and_fetch_site_are_rejected(diagnostics_app):
    with diagnostics_app.test_client() as client:
        foreign = client.post(
            "/api/browser-diagnostics",
            headers={"Origin": "https://attacker.invalid"},
            json=_report(),
        )
        cross_site = client.post(
            "/api/browser-diagnostics",
            headers={"Sec-Fetch-Site": "cross-site"},
            json=_report(),
        )
    assert foreign.status_code == 403
    assert cross_site.status_code == 403


def test_unknown_filenames_and_bad_schema_are_rejected(diagnostics_app):
    with diagnostics_app.test_client() as client:
        nested = client.post(
            "/api/browser-diagnostics",
            json={
                **_report(),
                "frames": [
                    {"file": "nested/not-served.js", "line": 1, "column": 1}
                ],
            },
        )
        bad_content_type = client.post(
            "/api/browser-diagnostics",
            data=json.dumps(_report()),
            content_type="text/plain",
        )
    assert nested.status_code == 400
    assert bad_content_type.status_code == 400


def test_large_body_is_rejected_even_without_content_length(diagnostics_app):
    raw = json.dumps(_report()).encode() + b"x" * 9000
    with diagnostics_app.test_client() as client:
        response = client.open(
            "/api/browser-diagnostics",
            method="POST",
            data=raw,
            content_type="application/json",
            environ_overrides={"CONTENT_LENGTH": "", "wsgi.input_terminated": True},
        )
    assert response.status_code == 413


def test_global_and_per_source_caps(diagnostics_app, monkeypatch):
    monkeypatch.setattr(browser_diagnostics, "SOURCE_RATE_LIMIT", 2)
    monkeypatch.setattr(browser_diagnostics, "GLOBAL_RATE_LIMIT", 3)
    with diagnostics_app.test_client() as client:
        assert client.post(
            "/api/browser-diagnostics", json=_report()
        ).status_code == 200
        assert client.post(
            "/api/browser-diagnostics", json=_report()
        ).status_code == 200
        assert client.post(
            "/api/browser-diagnostics", json=_report()
        ).status_code == 429
        assert client.post(
            "/api/browser-diagnostics", json=_report(),
            environ_overrides={"REMOTE_ADDR": "192.0.2.2"},
        ).status_code == 200
        assert client.post(
            "/api/browser-diagnostics", json=_report(),
            environ_overrides={"REMOTE_ADDR": "192.0.2.3"},
        ).status_code == 429


def test_real_frontend_payload_reaches_log(tmp_path, caplog):
    import subprocess
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    payload = json.loads(subprocess.check_output(
        ["node", "simulator/test_browser_diagnostics.js", "--emit"], cwd=root))
    app = Flask(__name__)
    browser_diagnostics.reset_rate_limits_for_tests()
    browser_diagnostics.register_browser_diagnostics(
        app, simulator_dir=str(root / "simulator"), server_version="abc12345")
    with caplog.at_level(logging.WARNING, logger="browser_diagnostics"):
        response = app.test_client().post("/api/browser-diagnostics", json=payload)
    assert response.status_code == 200
    record = json.loads(next(r.message for r in caplog.records
                            if r.name == "browser_diagnostics").split(" ", 1)[1])
    assert record["client_report"] == payload
    assert record["report_id"] == response.json["report_id"]
    assert record["untrusted_client_report"] is True
    assert "PRIVATE" not in json.dumps(record)
    browser_diagnostics.reset_rate_limits_for_tests()