"""Isolated authentication tests; never import the server or contact hardware."""
import pytest
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from flask import Flask, request
from server import bridge_pairing as pairing


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("REPORT_TOKEN", "test-only-secret")
    app = Flask(__name__)
    app.config["BRIDGE_PAIRING_STORE"] = str(tmp_path / "pairing" / "grants.sqlite")
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


def test_saved_pairing_validation(app):
    token = redeem(app, issue(app)).json["token"]
    client = app.test_client()
    headers = {"Authorization": "Bearer " + token}
    for uid, status in [("board-test", 200), ("wrong-board", 401)]:
        response = client.post("/api/bridge-pairing/validate",
                               json={"device_uid": uid}, headers=headers)
        assert response.status_code == status
        assert response.headers["Cache-Control"] == "no-store"
        assert token not in response.text
    assert client.post("/api/bridge-pairing/validate",
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


def restarted_authorized(app, token, now=None, uid="board-test"):
    """A fresh interpreter has no module globals from the issuing process."""
    script = """
import json, sys
from flask import Flask
from server import bridge_pairing as pairing
data = json.load(sys.stdin)
app = Flask(__name__)
app.config["BRIDGE_PAIRING_STORE"] = data["path"]
if data["now"] is not None:
    pairing.time.time = lambda: data["now"]
with app.test_request_context("/hardware/wukong/command", headers={
    "Authorization": "Bearer " + data["token"],
    "X-Wukong-Device-UID": data["uid"],
}):
    print(json.dumps(pairing.authorized()))
"""
    result = subprocess.run([sys.executable, "-c", script], input=json.dumps({
        "path": app.config["BRIDGE_PAIRING_STORE"], "token": token, "now": now, "uid": uid,
    }), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_session_survives_process_restart_without_renewing_expiry(app, monkeypatch):
    now = pairing.time.time()
    monkeypatch.setattr(pairing.time, "time", lambda: now)
    token = redeem(app, issue(app)).json["token"]
    assert restarted_authorized(app, token, now + 1)
    assert not restarted_authorized(app, token, now + 1, uid="other-board")
    assert restarted_authorized(app, token, now + pairing.SESSION_SECONDS - 1)
    assert not restarted_authorized(app, token, now + pairing.SESSION_SECONDS)
    # Pruning is durable: rolling the clock back does not resurrect a grant.
    assert not restarted_authorized(app, token, now + 1)


def test_restart_rotation_removal_and_revocation(app, monkeypatch):
    token = redeem(app, issue(app)).json["token"]
    monkeypatch.setenv("REPORT_TOKEN", "new-test-authority")
    assert not restarted_authorized(app, token)
    monkeypatch.setenv("REPORT_TOKEN", "test-only-secret")
    assert not restarted_authorized(app, token)
    token = redeem(app, issue(app)).json["token"]
    monkeypatch.delenv("REPORT_TOKEN")
    assert not restarted_authorized(app, token)
    monkeypatch.setenv("REPORT_TOKEN", "test-only-secret")
    token = redeem(app, issue(app)).json["token"]
    with sqlite3.connect(app.config["BRIDGE_PAIRING_STORE"]) as db:
        db.execute("DELETE FROM grants WHERE digest = ?", (pairing._digest(token),))
    assert not restarted_authorized(app, token)
    with app.test_request_context("/hardware/wukong/command",
            headers={"Authorization": "Bearer " + token}):
        assert not pairing.authorized()


def test_private_store_has_no_credentials_and_rejects_tampering(app):
    code = issue(app)
    token = redeem(app, code).json["token"]
    path = Path(app.config["BRIDGE_PAIRING_STORE"])
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    for file in path.parent.iterdir():
        raw = file.read_bytes()
        for secret in (code, token, "test-only-secret"):
            assert secret.encode() not in raw
    with sqlite3.connect(path) as db:
        db.execute("UPDATE grants SET expires = expires + 10000")
    assert not restarted_authorized(app, token)


def test_storage_failure_is_closed(app):
    code = issue(app)
    token = redeem(app, code).json["token"]
    Path(app.config["BRIDGE_PAIRING_STORE"]).write_bytes(b"not a database")
    assert not restarted_authorized(app, token)
    response = app.test_client().post("/api/bridge-pairing",
        json={"device_uid": "board-test"},
        headers={"Authorization": "Bearer test-only-secret"})
    assert response.status_code == 503
    assert "storage" in response.json["error"]


def test_conflicting_uid_and_malformed_envelope_fail_closed(app):
    token = redeem(app, issue(app)).json["token"]
    headers = {"Authorization": "Bearer " + token, "X-Wukong-Device-UID": "board-test"}
    for data in ({"device_uid": "other-board"}, ["bad"]):
        with app.test_request_context("/hardware/wukong/bridge-status", method="POST",
                                      headers=headers, json=data):
            assert not pairing.authorized()


def test_ticket_restart_and_concurrent_single_redemption(app):
    from concurrent.futures import ThreadPoolExecutor
    code = issue(app)
    # Separate app instances model workers sharing only the private store.
    def worker(_):
        other = Flask(__name__)
        other.config.update(app.config)
        pairing.register(other, lambda: (False, ({"error": "Unauthorized"}, 401)))
        return redeem(other, code).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sorted(pool.map(worker, range(4))) == [200, 401, 401, 401]


def test_expired_ticket_cannot_be_redeemed_after_restart(app, monkeypatch):
    now = pairing.time.time()
    monkeypatch.setattr(pairing.time, "time", lambda: now)
    code = issue(app)
    other = Flask(__name__)
    other.config.update(app.config)
    pairing.register(other, lambda: (True, None))
    monkeypatch.setattr(pairing.time, "time", lambda: now + pairing.TICKET_SECONDS)
    assert redeem(other, code).status_code == 401
