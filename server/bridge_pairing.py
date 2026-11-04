"""Short-lived, single-use pairing; never expose the server's REPORT_TOKEN."""
import hashlib
import os
import secrets
import threading
import time

from flask import jsonify, request

_lock = threading.Lock()
_tickets = {}
_sessions = {}
TICKET_SECONDS = 300
SESSION_SECONDS = 12 * 60 * 60
_POST_PATHS = {
    "/hardware/wukong/" + name for name in (
        "bridge-status", "trace", "snapshot", "console", "command-ack",
        "upload-ack", "boot-info", "halt-state", "skip-fault-completion",
        "recovery-authorization",
    )
}


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _authority():
    return _digest(os.environ.get("REPORT_TOKEN", "").strip())


def _prune(now):
    for store in (_tickets, _sessions):
        for key, record in list(store.items()):
            if record["expires"] <= now or record["authority"] != _authority():
                del store[key]


def authorized():
    """Pairing grants bridge telemetry/polling only, never IDE control/builds."""
    allowed = (request.method == "POST" and request.path in _POST_PATHS) or (
        request.method == "GET" and request.path == "/hardware/wukong/command")
    if not allowed:
        return False
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not token.startswith("bridge-session-"):
        return False
    with _lock:
        _prune(time.time())
        record = _sessions.get(_digest(token))
        if not record:
            return False
        data = request.get_json(silent=True) or {}
        uid = request.headers.get("X-Wukong-Device-UID") or data.get("device_uid")
        # Existing bridge envelopes do not all include a UID. Where supplied,
        # it must match the board selected at pairing.
        return not uid or uid == record["uid"]


def register(app, authenticate):
    @app.post("/api/bridge-pairing")
    def create_bridge_pairing():
        if not os.environ.get("REPORT_TOKEN", "").strip():
            return jsonify(error="IDE authentication is not configured. Pairing is unavailable."), 503
        ok, error = authenticate()
        if not ok:
            return error
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error="Expected a pairing request object."), 400
        uid = data.get("device_uid", "")
        if not isinstance(uid, str) or not uid or len(uid) > 128 or not all(
                c.isalnum() or c in "-_." for c in uid):
            return jsonify(error="Enter the physical board UID."), 400
        with _lock:
            _prune(time.time())
            if len(_tickets) >= 64 or len(_sessions) >= 64:
                return jsonify(error="Too many pairing sessions. Try again later."), 429
            code = secrets.token_urlsafe(32)
            _tickets[_digest(code)] = dict(
                uid=uid, expires=time.time() + TICKET_SECONDS, authority=_authority())
        response = jsonify(code=code, expires_in=TICKET_SECONDS, device_uid=uid)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/bridge-pairing/redeem")
    def redeem_bridge_pairing():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error="Expected a pairing request object."), 400
        code = data.get("code", "")
        if not isinstance(code, str) or len(code) > 128:
            return jsonify(error="Invalid pairing code."), 400
        with _lock:
            _prune(time.time())
            record = _tickets.get(_digest(code))
            if not record or record["uid"] != data.get("device_uid"):
                return jsonify(error="Pairing expired or does not match this board. Create a new command in the IDE."), 401
            if len(_sessions) >= 64:
                return jsonify(error="Too many pairing sessions."), 429
            del _tickets[_digest(code)]
            token = "bridge-session-" + secrets.token_urlsafe(32)
            _sessions[_digest(token)] = dict(
                record, expires=time.time() + SESSION_SECONDS)
        response = jsonify(token=token, expires_in=SESSION_SECONDS)
        response.headers["Cache-Control"] = "no-store"
        return response
