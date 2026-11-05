"""Short-lived, single-use pairing; never expose the server's REPORT_TOKEN."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from flask import current_app, jsonify, request

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


def _signature(kind, digest, uid, expires, authority):
    payload = json.dumps([kind, digest, uid, expires, authority], separators=(",", ":"))
    return hmac.new(os.environ.get("REPORT_TOKEN", "").strip().encode(),
                    payload.encode(), hashlib.sha256).hexdigest()


@contextmanager
def _store():
    """Private, process-shared state. No bearer credentials are persisted.

    BEGIN IMMEDIATE serializes redemption and capacity checks across workers.
    Read from disk on every request so revocations never depend on a cache.
    Deleting this private directory revokes all grants. It must not be shipped
    with the application or copied to another IDE.
    """
    path = Path(current_app.config.get(
        "BRIDGE_PAIRING_STORE",
        Path(current_app.instance_path) / "bridge-pairing" / "grants.sqlite"))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
    finally:
        os.close(fd)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""CREATE TABLE IF NOT EXISTS grants (
            kind TEXT NOT NULL, digest TEXT PRIMARY KEY, uid TEXT NOT NULL,
            expires REAL NOT NULL, authority TEXT NOT NULL, signature TEXT NOT NULL)""")
        db.execute("DELETE FROM grants WHERE expires <= ? OR authority != ?",
                   (time.time(), _authority()))
        if not os.environ.get("REPORT_TOKEN", "").strip():
            db.execute("DELETE FROM grants")
        yield db
        db.commit()
    finally:
        db.close()


def _get(db, kind, digest):
    row = db.execute("SELECT * FROM grants WHERE kind = ? AND digest = ?",
                     (kind, digest)).fetchone()
    if row and hmac.compare_digest(row["signature"], _signature(
            kind, digest, row["uid"], row["expires"], row["authority"])):
        return row
    return None


def _put(db, kind, token, uid, lifetime):
    digest, expires, authority = _digest(token), time.time() + lifetime, _authority()
    db.execute("INSERT INTO grants VALUES (?, ?, ?, ?, ?, ?)",
               (kind, digest, uid, expires, authority,
                _signature(kind, digest, uid, expires, authority)))


def _count(db, kind):
    return db.execute("SELECT count(*) FROM grants WHERE kind = ?", (kind,)).fetchone()[0]


def authorized():
    """Pairing grants bridge telemetry/polling only, never IDE control/builds."""
    allowed = (request.method == "POST" and request.path in _POST_PATHS) or (
        request.method == "GET" and request.path == "/hardware/wukong/command")
    if not allowed:
        return False
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not token.startswith("bridge-session-"):
        return False
    try:
        with _store() as db:
            record = _get(db, "session", _digest(token))
            if not record:
                return False
            data = request.get_json(silent=True) or {}
            if not isinstance(data, dict):
                return False
            # Legacy envelopes can omit UID; every supplied UID must match.
            return all(not uid or uid == record["uid"] for uid in (
                request.headers.get("X-Wukong-Device-UID"), data.get("device_uid")))
    except (OSError, sqlite3.Error):
        current_app.logger.error("Bridge pairing store unavailable; access denied.")
        return False


def register(app, authenticate):
    @app.errorhandler(PairingStoreUnavailable)
    def pairing_store_unavailable(error):
        return jsonify(error="Pairing storage is unavailable. Check the IDE server's private storage and retry."), 503

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
        with _pairing_store() as db:
            if _count(db, "ticket") >= 64 or _count(db, "session") >= 64:
                return jsonify(error="Too many pairing sessions. Try again later."), 429
            code = secrets.token_urlsafe(32)
            _put(db, "ticket", code, uid, TICKET_SECONDS)
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
        with _pairing_store() as db:
            record = _get(db, "ticket", _digest(code))
            if not record or record["uid"] != data.get("device_uid"):
                return jsonify(error="Pairing expired or does not match this board. Create a new command in the IDE."), 401
            if _count(db, "session") >= 64:
                return jsonify(error="Too many pairing sessions."), 429
            db.execute("DELETE FROM grants WHERE digest = ?", (_digest(code),))
            token = "bridge-session-" + secrets.token_urlsafe(32)
            _put(db, "session", token, record["uid"], SESSION_SECONDS)
        response = jsonify(token=token, expires_in=SESSION_SECONDS)
        response.headers["Cache-Control"] = "no-store"
        return response


class PairingStoreUnavailable(Exception):
    pass


@contextmanager
def _pairing_store():
    try:
        with _store() as db:
            yield db
    except (OSError, sqlite3.Error) as error:
        current_app.logger.error("Bridge pairing store unavailable.")
        raise PairingStoreUnavailable() from error
