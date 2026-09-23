"""Programmer handoff metadata, separate from artifacts and Builder approval."""
import hashlib
import json
import secrets
import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, session


def install(app, resolve, guard, same_origin):
    def database_path():
        return Path(app.config.get(
            "BUILD_HANDOFF_DB", Path(app.instance_path) / "build-handoff.sqlite"))

    def key_for(identity):
        return hashlib.sha256(json.dumps(
            {k: identity[k] for k in ("token", "filename", "binary_hash", "lump_version")},
            sort_keys=True).encode()).hexdigest()

    def read_state(key):
        path = database_path()
        if not path.exists():
            return {"released": False, "revision": 0, "updated_at": None}
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            row = db.execute(
                "SELECT released, revision, updated_at FROM handoffs WHERE identity = ?",
                (key,)).fetchone()
        return {"released": bool(row[0]), "revision": row[1], "updated_at": row[2]} if row else {
            "released": False, "revision": 0, "updated_at": None}

    @app.route("/api/build-handoff", methods=["GET", "POST"])
    def build_handoff():
        if not same_origin():
            return jsonify(error="Same-origin browser session required", committed=False), 403
        try:
            payload = request.args if request.method == "GET" else request.get_json(silent=True)
            if not payload or not hasattr(payload, "get"):
                raise ValueError("Exact saved artifact identity is required")
            if request.method == "POST":
                proof = session.get("_build_handoff_csrf")
                supplied = request.headers.get("X-Build-Handoff-CSRF", "")
                if not proof or not secrets.compare_digest(proof, supplied):
                    return jsonify(error="Handoff session expired; reload its status.", committed=False), 403
                if type(payload.get("released")) is not bool:
                    raise ValueError("released must be a boolean")
            with guard():
                identity = resolve(payload)
                key = key_for(identity)
                state = read_state(key)
                if request.method == "GET":
                    session.setdefault("_build_handoff_csrf", secrets.token_urlsafe(32))
                    response = jsonify(identity=identity, handoff=state,
                                       csrf=session["_build_handoff_csrf"])
                    response.headers["Cache-Control"] = "no-store"
                    return response
                if (type(payload.get("lump_version")) is not int
                        or payload["lump_version"] != identity["lump_version"]):
                    raise ValueError("Saved LUMP version changed; reload its identity.")
                if payload["released"] and not identity["eligible"]:
                    raise ValueError("Only a verified, approved saved binary can be released.")
                path = database_path()
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.is_symlink():
                    raise ValueError("Handoff database cannot be a symbolic link.")
                fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
                os.close(fd)
                with sqlite3.connect(path) as db:
                    db.execute("CREATE TABLE IF NOT EXISTS handoffs (identity TEXT PRIMARY KEY, released INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)")
                    db.execute("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, identity TEXT NOT NULL, artifact TEXT NOT NULL, released INTEGER NOT NULL, occurred_at TEXT NOT NULL, actor TEXT NOT NULL)")
                    db.execute("BEGIN IMMEDIATE")
                    row = db.execute("SELECT released, revision, updated_at FROM handoffs WHERE identity = ?", (key,)).fetchone()
                    revision = row[1] if row else 0
                    if request.headers.get("If-Match") != str(revision):
                        return jsonify(error="Handoff changed in another view; reload its status.", committed=False), 409
                    now = datetime.now(timezone.utc).isoformat()
                    state = {"released": payload["released"], "revision": revision + 1, "updated_at": now}
                    db.execute("INSERT OR REPLACE INTO handoffs VALUES (?, ?, ?, ?)",
                               (key, int(state["released"]), state["revision"], now))
                    db.execute("INSERT INTO events (identity, artifact, released, occurred_at, actor) VALUES (?, ?, ?, ?, ?)",
                               (key, json.dumps(identity, sort_keys=True), int(state["released"]), now,
                                hashlib.sha256(proof.encode()).hexdigest()))
                return jsonify(identity=identity, handoff=state, committed=True)
        except ValueError as exc:
            return jsonify(error=str(exc), committed=False), 409
        except (OSError, sqlite3.Error):
            app.logger.exception("Build handoff metadata unavailable")
            return jsonify(error="Handoff storage unavailable; reload status before retrying.", committed=None), 503