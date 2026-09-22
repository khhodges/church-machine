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


def describe_lump_save_plan(plan):
    """Return safe review lines from an authoritative, session-checked plan."""
    unavailable = "unavailable (authoritative save plan could not be resolved)"
    if not isinstance(plan, dict):
        return [f"LUMP: {unavailable}", f"Version: {unavailable}"]

    name = plan.get("lump_name")
    name_text = str(name).strip() if isinstance(name, str) else ""
    current = plan.get("current_version")
    proposed = plan.get("proposed_version")
    new_entry = plan.get("consequence") == "create"

    lines = [f"LUMP: {name_text or unavailable}"]
    if (isinstance(proposed, bool) or not isinstance(proposed, int)
            or proposed < 1):
        lines.append(f"Version: {unavailable}")
    elif new_entry:
        lines.append(f"Version: New Entry \u2192 {proposed}")
    elif (isinstance(current, bool) or not isinstance(current, int)
          or current < 1):
        lines.append(f"Version: unavailable \u2192 {proposed}")
    else:
        lines.append(f"Version: {current} \u2192 {proposed}")
    return lines


def describe_boot_config_change(before, after, rows, manifest, prepare=False,
                                binary_hash_for=None):
    """Describe normalized config changes using exact saved catalogue evidence.

    No name-only/latest-revision lookup: stable tokens can identify many revisions.
    Namespace sequence, issue_n and semantic version are not saved LUMP versions.
    """
    lines = ["Boot configuration review (saved → proposed).",
             "This changes configuration, not saved LUMP revisions; no new LUMP version is created."]
    if prepare:
        lines.append("Explicit Prepare: the committed boot image will also be prepared/patched for the Namespace boot target.")
    else:
        lines.append("No explicit Prepare requested. Existing boot-image inputs may become stale.")
    missing = object()

    def value(item):
        return "(absent)" if item is missing else json.dumps(item, ensure_ascii=False, sort_keys=True)

    def differences(old, new, prefix=""):
        if isinstance(old, dict) and isinstance(new, dict):
            for key in sorted(old.keys() | new.keys()):
                yield from differences(old.get(key, missing), new.get(key, missing),
                                       f"{prefix}.{key}" if prefix else key)
        elif old != new:
            yield f"{prefix}: {value(old)} → {value(new)}"

    # Per-slot Step-2 changes below are more useful than an array dump.
    old_fields = {k: v for k, v in before.items() if k != "step2"}
    new_fields = {k: v for k, v in after.items() if k != "step2"}
    changes = list(differences(old_fields, new_fields))
    lines.extend(changes)
    def placements(cfg):
        return {str(r["nsSlot"]): r for r in (cfg.get("step2") or {}).get("lumps", [])
                if isinstance(r, dict) and "nsSlot" in r}

    old_slots, new_slots = placements(before), placements(after)
    changed_slots = {s for s in old_slots.keys() | new_slots.keys()
                     if old_slots.get(s) != new_slots.get(s)}
    for slot in sorted(changed_slots, key=lambda s: int(s)):
        lines.extend(differences(old_slots.get(slot, {}), new_slots.get(slot, {}),
                                 f"NS[{slot}] placement"))
    for key in ("slotRules", "slotLabels"):
        old, new = before.get(key) or {}, after.get(key) or {}
        changed_slots.update(str(s) for s in old.keys() | new.keys() if old.get(s) != new.get(s))
    authority = {str(r["slot"]): r for r in rows
                 if isinstance(r, dict) and "slot" in r}
    duplicate_slots = {s for s in authority if sum(
        isinstance(r, dict) and str(r.get("slot")) == s for r in rows) > 1}
    # Geometry affects the whole resident layout, not just explicitly sent rows.
    geometry = any(before.get(k) != after.get(k) for k in ("targetBoard", "step1", "step3"))
    affected = set(changed_slots)
    if geometry:
        affected.update(authority)
    for cfg in (before, after):
        if cfg.get("bootEntrySlot") is not None:
            affected.add(str(cfg["bootEntrySlot"]))
    lines.append(f"Namespace boot target: NS[{before.get('bootEntrySlot', 'unresolved')}]"
                 f" → NS[{after.get('bootEntrySlot', 'unresolved')}].")

    def token(raw):
        try:
            return f"{int(str(raw).removeprefix('0x'), 16):08x}"
        except (TypeError, ValueError):
            return None

    def identity(slot, placement):
        row = authority.get(slot, {})
        label = row.get("name") or "(pet name unresolved)"
        if slot in duplicate_slots:
            return "pet name / saved version unresolved (ambiguous Namespace slot)"
        # A placement can select a different LUMP without changing the NS row yet.
        selectors = {}
        if placement and placement.get("lumpToken"):
            selectors["token"] = placement["lumpToken"]
            if (not placement.get("binaryHash")
                    and token(placement["lumpToken"]) == token(row.get("token"))):
                selectors.update({k: row[k] for k in ("filename", "binary_hash") if row.get(k)})
            if placement.get("binaryHash"):
                selectors["binary_hash"] = placement["binaryHash"]
        else:
            selectors = {k: row[k] for k in ("token", "filename", "binary_hash") if row.get(k)}
        if "token" in selectors and token(selectors["token"]) is None:
            return f"pet name {label}; saved version unresolved (invalid token)"
        def matches_selector(record):
            for key, expected in selectors.items():
                actual = record.get(key)
                if key == "token":
                    if token(actual) != token(expected):
                        return False
                elif key == "binary_hash" and actual is None and binary_hash_for:
                    # Many real manifest records intentionally omit binary_hash.
                    # Verify their exact named bytes; never discard the hash pin.
                    if binary_hash_for(record) != expected:
                        return False
                elif actual != expected:
                    return False
            return True

        matches = [r for r in manifest if isinstance(r, dict) and selectors
                   and matches_selector(r)]
        if len(matches) != 1:
            why = "ambiguous saved revision" if len(matches) > 1 else "no exact saved record"
            return f"pet name {label}; saved version unresolved ({why})"
        record = matches[0]
        version = record.get("lump_version")
        version_text = (f"v{version}" if isinstance(version, int) and not isinstance(version, bool)
                        and version >= 0 else "unresolved (missing saved lump_version)")
        return (f"pet name {label}; LUMP {record.get('abstraction') or '(name unresolved)'}; "
                f"saved version {version_text}; file {record.get('filename') or '(unresolved)'}")

    if not changes and not changed_slots:
        lines.append("No persisted configuration field changes.")
    lines.append("Affected saved artifacts / boot target (versions below are not Namespace sequences):")
    for slot in sorted(affected, key=lambda s: int(s)):
        old_identity = identity(slot, old_slots.get(slot))
        new_identity = identity(slot, new_slots.get(slot))
        if old_identity == new_identity:
            lines.append(f"NS[{slot}]: {old_identity} → unchanged saved revision")
        else:
            lines.append(f"NS[{slot}]: {old_identity} → {new_identity}")
        if slot in old_slots and slot not in new_slots:
            lines.append(f"NS[{slot}]: removed from Step-2 configuration; saved binary is not deleted.")
        elif slot in new_slots and slot not in old_slots:
            lines.append(f"NS[{slot}]: added to Step-2 configuration; not a new LUMP revision.")
    if not affected:
        lines.append("No affected slot identity could be resolved.")
    return lines


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
            if "facets" not in {row[1] for row in db.execute("PRAGMA table_info(intents)")}:
                try:
                    db.execute("ALTER TABLE intents ADD COLUMN facets TEXT")
                except sqlite3.OperationalError:
                    # Another worker may have performed the same migration.
                    if "facets" not in {row[1] for row in db.execute("PRAGMA table_info(intents)")}:
                        raise

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
            facets = ([self._hash(value) for value in binding]
                      if isinstance(binding, (tuple, list)) and len(binding) == 5 else None)
            db.execute("INSERT INTO intents (token, expires, binding, facets) VALUES (?, ?, ?, ?)",
                       (self._hash(token), now + 300, self._hash(binding), json.dumps(facets)))
            return token

    def consume(self, token, binding, now=None):
        return self.consume_reason(token, binding, now) == "accepted"

    def consume_reason(self, token, binding, now=None):
        now = time.time() if now is None else now
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            key = self._hash(token)
            intent = db.execute("SELECT expires, binding, facets FROM intents WHERE token = ?", (key,)).fetchone()
            db.execute("DELETE FROM intents WHERE token = ?", (key,))
            if not intent:
                return "missing_or_used"
            if intent[0] <= now:
                return "expired"
            if intent[1] == self._hash(binding):
                return "accepted"
            facets = json.loads(intent[2]) if intent[2] else None
            if facets and isinstance(binding, (tuple, list)) and len(binding) == 5:
                for index, reason in enumerate(("session_changed", "request_changed",
                                               "request_changed", "request_changed",
                                               "saved_state_changed")):
                    if facets[index] != self._hash(binding[index]):
                        return reason
            return "binding_changed"


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
            rejection_reason = store.consume_reason(token, binding)
            if rejection_reason == "accepted":
                return None
            explanation = {
                "missing_or_used": "This review is no longer available or was already used.",
                "expired": "This review expired after five minutes.",
                "session_changed": "The browser session changed after this review was issued.",
                "request_changed": "The submitted request differs from the reviewed request.",
                "saved_state_changed": "Protected saved data changed after this review was issued.",
                "binding_changed": "This older review no longer matches the request or saved state.",
            }[rejection_reason]
            return jsonify(error="change_confirmation_invalid",
                           rejection_reason=rejection_reason,
                           message=explanation + " No change was authorized. Review again.",
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
        if request.path == "/api/boot-config":
            reason = ("Review the boot configuration fields and affected pet names / saved LUMP versions below. "
                      "This does not publish a new LUMP revision. Reject if any identity is unresolved.")
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
