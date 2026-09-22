"""Additional human-review boundary; does not replace admission/permission checks.

Intents are shared across workers in a SQLite database outside artifact storage.
Only hashes of intent tokens and request bindings are persisted.
"""
import hashlib
import json
import secrets
import os
import sqlite3
import tempfile
from contextlib import contextmanager
import time
from pathlib import Path

from flask import g, jsonify, request, session


def protected_request(path, method):
    if method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return False
    exempt = {
        "/api/lumps/save-plan", "/api/lumps/finalize",
        "/api/lumps/save-diagnostics", "/api/lumps/approval-intent",
        "/api/lumps/deploy-authorize",
    }
    if path in exempt or path.startswith("/api/lumps/lease"):
        return False
    return path.startswith((
        "/api/lump/", "/api/lumps/", "/api/boot-config",
        "/api/boot-image/", "/api/namespace/", "/api/source-file/",
    ))


def state_digest(paths):
    digest = hashlib.sha256()
    for path in sorted(set(map(str, paths))):
        item = Path(path)
        digest.update(path.encode())
        digest.update(b"\0")
        if item.is_file():
            with item.open("rb") as source:
                for chunk in iter(lambda: source.read(65536), b""):
                    digest.update(chunk)
        else:
            digest.update(b"<missing>")
    return digest.hexdigest()


class IntentStore:
    def __init__(self, path=None):
        self._temporary = tempfile.TemporaryDirectory() if path is None else None
        self.path = Path(path or Path(self._temporary.name) / "intents.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS intents (token TEXT PRIMARY KEY, expires REAL NOT NULL, binding TEXT NOT NULL)")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _hash(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    def issue(self, binding, now=None):
        now = time.time() if now is None else now
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM intents WHERE expires <= ?", (now,))
            # Never evict a live intent to make room for unbounded requests.
            if db.execute("SELECT count(*) FROM intents").fetchone()[0] >= 1024:
                raise RuntimeError("Too many pending reviews; wait for expiry.")
            token = secrets.token_urlsafe(32)
            db.execute("INSERT INTO intents VALUES (?, ?, ?)",
                       (self._hash(token), now + 300, self._hash(binding)))
            return token

    def consume(self, token, binding, now=None):
        now = time.time() if now is None else now
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            key = self._hash(token)
            intent = db.execute("SELECT expires, binding FROM intents WHERE token = ?", (key,)).fetchone()
            db.execute("DELETE FROM intents WHERE token = ?", (key,))
            return bool(intent and intent[0] > now and intent[1] == self._hash(binding))


def install(app, paths, commit_guard, describe=None, store_path=None, recovery_pending=None):
    """Install ahead of other request hooks; hold commit lock through teardown."""
    store = IntentStore(store_path or Path(app.instance_path) / "change-review" / "intents.sqlite")

    def review():
        # Health and static UI remain available; never serve an inconsistent
        # catalogue or allow unrelated route code to touch it while pending.
        if recovery_pending is not None and request.path not in {"/health", "/api/health"}:
            guard = commit_guard()
            guard.__enter__()
            g._change_confirmation_guard = guard
            if recovery_pending():
                return jsonify(error="recovery_approval_required", committed=False,
                               message="Interrupted artifact transaction retained unchanged. Catalogue access is blocked pending explicitly reviewed offline recovery; automatic recovery is disabled."), 503
        if not protected_request(request.path, request.method):
            # Lease coordination and plan preparation must not hold the global
            # lock for their entire response (some deliberately wait).
            if request.method not in {"GET", "HEAD"} or request.path.startswith(("/simulator/", "/static/", "/api/lumps/lease")) or request.path == "/":
                guard = g.pop("_change_confirmation_guard", None)
                if guard is not None:
                    guard.__exit__(None, None, None)
            return None
        if "_change_confirmation_guard" not in g:
            guard = commit_guard()
            guard.__enter__()
            g._change_confirmation_guard = guard
        session.setdefault("_change_review_session", secrets.token_urlsafe(32))
        body = request.get_data(cache=True)
        body_hash = hashlib.sha256(body).hexdigest()
        fingerprint = state_digest(paths())
        binding = (
            session["_change_review_session"], request.method,
            request.full_path, body_hash, fingerprint,
        )
        token = request.headers.get("X-Change-Confirmation")
        if token:
            if store.consume(token, binding):
                return None
            return jsonify(error="change_confirmation_invalid",
                           message="Review expired, was already used, or the request or saved state changed. Review again.",
                           committed=False), 409
        payload = request.get_json(silent=True)
        # Do not echo credentials, approval proofs, source bodies or binary arrays.
        target = []
        if isinstance(payload, dict):
            for key in ("path", "filename", "abstraction", "slot", "token", "lump_version"):
                if key in payload:
                    target.append(f"{key}: {str(payload[key])[:256]}")
        if describe is not None:
            target.extend(describe(payload))
        reason = "You requested a persisted change. It may update source, repository history, Namespace bindings or the generated boot image."
        if request.path == "/api/lumps/save":
            reason = ("Publish the reviewed LUMP and related repository/Namespace state. "
                      "Existing admission checks still apply. Save processing may add a "
                      "required SELF C-list entry and padding; reject if you do not approve that transformation.")
        try:
            intent = store.issue(binding)
        except RuntimeError as exc:
            return jsonify(error="change_review_busy", message=str(exc), committed=False), 503
        return jsonify(
            error="change_confirmation_required", committed=False,
            change_confirmation={
                "id": intent, "title": "Review protected change",
                "reason": reason,
                "changes": [f"{request.method} {request.path}"] + target + [
                    f"Exact request SHA-256: {body_hash}",
                    f"Current saved-state SHA-256: {fingerprint}",
                    "Confirm authorizes this request once. Reject leaves protected data unchanged.",
                ],
            },
        ), 428

    # Review must run before recovery or route code can mutate protected files.
    app.before_request_funcs.setdefault(None, []).insert(0, review)

    @app.teardown_request
    def release(_error=None):
        guard = g.pop("_change_confirmation_guard", None)
        if guard is not None:
            guard.__exit__(None, None, None)
