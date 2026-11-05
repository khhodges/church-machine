"""Offline recovery of an already-running bridge; never touch the physical board."""
import pytest
from tests.server.test_bridge_pairing import app
from server import bridge_pairing as pairing

TOKEN = "bridge-session-" + "offline-lost-session" * 2
OWNER = {"Authorization": "Bearer test-only-secret"}


def rejected_heartbeat(app, uid="board-test", token=TOKEN):
    with app.test_request_context("/hardware/wukong/bridge-status", method="POST",
                                 headers={"Authorization": "Bearer " + token},
                                 json={"device_uid": uid}):
        return pairing.authorized()


def pending(app):
    response = app.test_client().get("/api/bridge-pairing/reconnect", headers=OWNER)
    assert response.status_code == 200
    assert TOKEN not in response.text
    return response.json["requests"]


def test_restore_same_credential_only_after_explicit_owner_approval(app):
    assert not rejected_heartbeat(app)
    assert not rejected_heartbeat(app)
    rows = pending(app)
    assert len(rows) == 1
    client = app.test_client()
    assert client.get("/api/bridge-pairing/reconnect").status_code == 401
    assert client.post("/api/bridge-pairing/reconnect", json=rows[0]).status_code == 401
    assert not rejected_heartbeat(app)
    assert client.post("/api/bridge-pairing/reconnect", json=rows[0], headers=OWNER).status_code == 200
    assert pending(app) == []
    assert rejected_heartbeat(app)
    assert not rejected_heartbeat(app, uid="another-board")
    with app.test_request_context("/hardware/wukong/command", method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN}):
        assert not pairing.authorized()
    assert client.post("/api/bridge-pairing/reconnect", json=rows[0], headers=OWNER).status_code == 409


def test_expired_candidate_and_wrong_board_cannot_be_approved(app, monkeypatch):
    assert not rejected_heartbeat(app)
    row = pending(app)[0]
    client = app.test_client()
    assert client.post("/api/bridge-pairing/reconnect",
                       json={**row, "device_uid": "other"}, headers=OWNER).status_code == 409
    now = pairing.time.time()
    monkeypatch.setattr(pairing.time, "time", lambda: now + 301)
    assert client.post("/api/bridge-pairing/reconnect", json=row, headers=OWNER).status_code == 409


@pytest.mark.parametrize("uid,token", [
    ("", TOKEN), ("bad/uid", TOKEN), ("board-test", "wrong-report-token"),
    ("board-test", "bridge-session-short"), ("board-test", "bridge-session-" + "x" * 150),
])
def test_only_bounded_paired_bridge_candidates(app, uid, token):
    assert not rejected_heartbeat(app, uid, token)
    assert pending(app) == []


def test_recovery_does_not_extend_itself_and_survives_store_reopen(app, monkeypatch):
    assert not rejected_heartbeat(app)
    row = pending(app)[0]
    assert app.test_client().post("/api/bridge-pairing/reconnect", json=row, headers=OWNER).status_code == 200
    with app.app_context(), pairing._store() as db:
        expiry = pairing._get(db, "session", pairing._digest(TOKEN))["expires"]
    assert rejected_heartbeat(app)
    with app.app_context(), pairing._store() as db:
        assert pairing._get(db, "session", pairing._digest(TOKEN))["expires"] == expiry
    monkeypatch.setattr(pairing.time, "time", lambda: expiry + 1)
    assert not rejected_heartbeat(app)
