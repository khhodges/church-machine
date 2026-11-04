"""Isolated authentication tests; never import the server or contact hardware."""
import pytest
from flask import Flask, request
from server import bridge_pairing as pairing


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("REPORT_TOKEN", "test-only-secret")
    pairing._tickets.clear()
    pairing._sessions.clear()
    app = Flask(__name__)
    def auth():
        return (True, None) if request.headers.get("Authorization") == "Bearer test-only-secret" else (
            False, ({"error": "Unauthorized"}, 401))
    pairing.register(app, auth)
    return app


def issue(app):
    client = app.test_client()
    response = client.post("/api/bridge-pairing", json={"device_uid": "board-test"},
                           headers={"Authorization": "Bearer test-only-secret"})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "test-only-secret" not in response.text
    return response.json["code"]


def redeem(app, code, uid="board-test"):
    return app.test_client().post("/api/bridge-pairing/redeem",
                                 json={"code": code, "device_uid": uid})


def test_requires_auth(app):
    assert app.test_client().post("/api/bridge-pairing",
        json={"device_uid": "board-test"}).status_code == 401


def test_single_use_scoped_session(app):
    code = issue(app)
    assert redeem(app, code, "wrong-board").status_code == 401
    response = redeem(app, code)
    assert response.status_code == 200
    assert "test-only-secret" not in response.text
    assert redeem(app, code).status_code == 401
    headers = {"Authorization": "Bearer " + response.json["token"]}
    for method, path, allowed in [
        ("GET", "/hardware/wukong/command", True),
        ("POST", "/hardware/wukong/bridge-status", True),
        ("POST", "/hardware/wukong/halt-state", True),
        ("POST", "/hardware/wukong/skip-fault-completion", True),
        ("POST", "/hardware/wukong/command", False),
        ("POST", "/api/namespace-image/install", False),
        ("POST", "/api/bridge-pairing", False),
    ]:
        with app.test_request_context(path, method=method, headers=headers):
            assert pairing.authorized() is allowed
    with app.test_request_context("/hardware/wukong/bridge-status", method="POST",
                                  headers=headers, json={"device_uid": "wrong"}):
        assert not pairing.authorized()


def test_expiration_and_rotation(app, monkeypatch):
    code = issue(app)
    now = pairing.time.time()
    monkeypatch.setattr(pairing.time, "time", lambda: now + 301)
    assert redeem(app, code).status_code == 401
    code = issue(app)
    token = redeem(app, code).json["token"]
    monkeypatch.setenv("REPORT_TOKEN", "rotated-test-secret")
    with app.test_request_context("/hardware/wukong/command",
            headers={"Authorization": "Bearer " + token}):
        assert not pairing.authorized()


def test_missing_server_auth_and_bad_json(app, monkeypatch):
    assert app.test_client().post("/api/bridge-pairing/redeem", json=["bad"]).status_code == 400
    monkeypatch.delenv("REPORT_TOKEN")
    assert app.test_client().post("/api/bridge-pairing", json={}).status_code == 503
