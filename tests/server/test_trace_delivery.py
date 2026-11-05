from flask import Flask, jsonify
from server.trace_delivery import reliable_trace


def test_retry_is_idempotent_and_authentication_is_not_cached():
    app = Flask(__name__)
    state = dict(allowed=True, events=0)

    def auth():
        return state["allowed"], (jsonify(ok=False), 401)

    @app.post("/trace")
    @reliable_trace(auth)
    def trace():
        state["events"] += 1
        return jsonify(accepted=True, seq=state["events"])

    client = app.test_client()
    payload = dict(delivery_id="event-one", bridge_session="session", nia=4)
    assert client.post("/trace", json=payload).json["seq"] == 1
    assert client.post("/trace", json=payload).json["seq"] == 1
    assert state["events"] == 1
    assert client.post("/trace", json={**payload, "nia": 8}).status_code == 409
    state["allowed"] = False
    assert client.post("/trace", json=payload).status_code == 401
    assert state["events"] == 1
