"""Isolated boundary tests: never import the production app or LUMPS_DIR."""
from contextlib import nullcontext
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import ast
import subprocess
import threading
import time
import pytest

from flask import Flask

from server.change_confirmation import (
    AuditCapacityError,
    IntentStore,
    describe_boot_image_generation,
    describe_lump_save_plan,
    install,
    protected_request,
    resolve_saved_lump_versions,
)
import json
import sqlite3
import server.change_confirmation as change_confirmation


def _consume_shared(args):
    path, token, binding = args
    return IntentStore(path).consume(token, binding)


def test_boot_image_review_reports_generation_without_namespace_promotion():
    rows = [
        {
            "slot": 7, "name": "Church.Entry", "filename": "entry-v3.lump",
            "_review_saved_version": 3, "type": "LUMP", "boot": True,
        },
        {"slot": 8, "name": "UART", "type": "Device"},
    ]

    review = "\n".join(describe_boot_image_generation(
        rows, [dict(row) for row in rows], 7))

    assert "Replace boot-image.bin and its provenance" in review
    assert "Namespace image boot target: NS[7]" in review
    assert "Namespace state rows: unchanged." in review
    assert "Saved LUMP catalogue revisions: unchanged" in review
    assert "NS[7] Church.Entry: entry-v3.lump; saved version 3" in review
    assert "selection unchanged" in review
    assert "update source" not in review


def test_boot_image_prepare_review_reports_resolved_namespace_revision_change():
    before = [{
        "slot": 4, "name": "Demo.Main", "filename": "demo-v1.lump",
        "_review_saved_version": 1, "type": "LUMP", "boot": True,
    }]
    after = [{
        "slot": 4, "name": "Demo.Main", "filename": "demo-v2.lump",
        "_review_saved_version": 2, "type": "LUMP", "boot": True,
        "binary_hash": "a" * 64,
    }]

    review = "\n".join(describe_boot_image_generation(
        before, after, 4, prepare_run=True))

    assert "Atomically update resolved Namespace artifact bindings" in review
    assert "Namespace state rows updated by Prepare/Run: NS[4]" in review
    assert "demo-v1.lump saved version 1 → demo-v2.lump saved version 2" in review
    # Selecting a different saved revision does not rewrite that revision.
    assert "Saved LUMP catalogue revisions: unchanged" in review


def test_boot_image_review_does_not_claim_unchanged_revisions_without_evidence():
    review = "\n".join(describe_boot_image_generation(
        [{"slot": 1}], "unresolved", 1))

    assert "could not be resolved" in review
    assert "revision effects unavailable" in review
    assert "revisions: unchanged" not in review


def test_boot_image_saved_version_requires_exact_catalogue_match_not_issue_number():
    rows = [{
        "slot": 2, "name": "Worker", "filename": "worker.lump",
        "token": "0x42", "binary_hash": "a" * 64, "issue_n": 99,
    }]
    manifest = [{
        "filename": "worker.lump", "token": "00000042",
        "binary_hash": "a" * 64, "lump_version": 7,
    }]
    resolved = resolve_saved_lump_versions(rows, manifest)
    assert resolved[0]["_review_saved_version"] == 7

    unresolved = resolve_saved_lump_versions(
        rows, [{**manifest[0], "binary_hash": "b" * 64}])
    review = "\n".join(describe_boot_image_generation(
        unresolved, unresolved, 2))
    assert "saved version unresolved" in review
    assert "saved version 99" not in review


def test_boot_image_confirmation_uses_narrow_route_reason(tmp_path):
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    install(
        app, lambda: [], nullcontext,
        describe=lambda payload: ["Namespace state rows: unchanged."],
        store_path=tmp_path / "reviews.sqlite")

    @app.post("/api/boot-image/generate")
    def generate():
        return {"ok": True}

    response = app.test_client().post(
        "/api/boot-image/generate", json={"entrySlot": 3})

    assert response.status_code == 428
    confirmation = response.json["change_confirmation"]
    assert confirmation["title"] == "Review Namespace image generation"
    assert "Namespace image" in confirmation["reason"]
    assert "boot image/provenance" in confirmation["reason"]
    assert "may update source" not in confirmation["reason"]
    assert "Namespace state rows: unchanged." in confirmation["changes"]


@pytest.mark.parametrize("index,reason", [
    (0, "session_changed"), (1, "request_changed"), (2, "request_changed"),
    (3, "request_changed"), (4, "saved_state_changed"),
])
def test_safe_rejection_facets(tmp_path, index, reason):
    store = IntentStore(tmp_path / "reviews.sqlite")
    binding = ["private-session", "POST", "/api/boot-config?", "body-hash", "state-hash"]
    token = store.issue(binding, now=100)
    changed = list(binding)
    changed[index] += "-changed"
    assert store.consume_reason(token, changed, now=101) == reason
    assert store.consume_reason(token, binding, now=101) == "missing_or_used"
    # Persist only hashes, never session/request values.
    assert b"private-session" not in store.path.read_bytes()


def test_expiry_and_legacy_schema(tmp_path):
    import sqlite3
    path = tmp_path / "reviews.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE intents (token TEXT PRIMARY KEY, expires REAL NOT NULL, binding TEXT NOT NULL)")
    store = IntentStore(path)
    binding = ["session", "POST", "/api/boot-config?", "body", "state"]
    token = store.issue(binding, now=100)
    assert store.consume_reason(token, binding, now=400) == "expired"
    token = store.issue(binding, now=401)
    assert store.consume_reason(token, binding, now=402) == "accepted"


def test_boot_config_full_reviews_must_be_prepared_after_prior_commit(tmp_path):
    from flask import request
    state = tmp_path / "boot-config.json"
    state.write_text("initial")
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    install(app, lambda: [state], nullcontext, store_path=tmp_path / "reviews.sqlite")

    @app.post("/api/boot-config")
    def save():
        state.write_text(request.get_json()["value"])
        return {"ok": True}

    client = app.test_client()

    def review(value):
        response = client.post("/api/boot-config", json={"value": value})
        assert response.status_code == 428
        return response.json["change_confirmation"]["id"]

    def confirm(value, token):
        return client.post("/api/boot-config", json={"value": value},
                           headers={"X-Change-Confirmation": token})

    first = review("first")
    premature = review("second")
    assert confirm("first", first).status_code == 200
    rejected = confirm("second", premature)
    assert rejected.status_code == 409
    assert rejected.json["rejection_reason"] == "saved_state_changed"
    assert state.read_text() == "first"
    # The browser now waits for the preceding commit before requesting this
    # review, so ordinary sequential actions both succeed without retries.
    second = review("second")
    assert confirm("second", second).status_code == 200
    assert state.read_text() == "second"
    replay = confirm("second", second)
    assert replay.status_code == 409
    assert replay.json["rejection_reason"] == "missing_or_used"


@pytest.mark.parametrize("changed,allowed", [
    (".lump-write-leases.json", True),
    ("example.lump", False),
    ("manifest.json", False),
    ("ns-state.json", False),
    ("boot-image.bin", False),
    ("other.json", False),
])
def test_review_fingerprint_excludes_only_lease_registry(tmp_path, changed, allowed):
    """Exercise production path selection without importing the live app."""
    from flask import request
    root = Path(__file__).parents[2]
    module = ast.parse((root / "server/app.py").read_text())
    function = next(n for n in module.body if isinstance(n, ast.FunctionDef)
                    and n.name == "_change_confirmation_paths")
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name in (".lump-write-leases.json", "example.lump", "manifest.json",
                 "ns-state.json", "boot-image.bin", "other.json"):
        (lumps / name).write_text("before")
    scope = {
        "__file__": str(tmp_path / "server/app.py"),
        "LUMPS_DIR": str(lumps),
        "BOOT_CONFIG_PATH": str(lumps / "boot-config.json"),
        "BOOT_IMAGE_PATH": str(lumps / "boot-image.bin"),
        "BOOT_IMAGE_PROVENANCE_PATH": str(lumps / "boot-image.provenance.json"),
        "NS_STATE_PATH": str(lumps / "ns-state.json"),
        "LUMPS_MANIFEST_PATH": str(lumps / "manifest.json"),
        "_LUMP_LEASE_REGISTRY": ".lump-write-leases.json",
        "request": request,
    }
    exec(compile(ast.Module(body=[function], type_ignores=[]), "<isolated>", "exec"), scope)
    app = Flask(__name__)
    app.secret_key = "test-only"
    calls = []
    install(app, scope[function.name], nullcontext,
            store_path=tmp_path / "private/intents.sqlite")

    @app.post("/api/lumps/save")
    def save():
        calls.append(True)
        return {"ok": True}

    with app.test_client() as client:
        review = client.post("/api/lumps/save", json={"value": 1})
        assert review.status_code == 428
        token = review.json["change_confirmation"]["id"]
        # Simulate a heartbeat or an artifact mutation while review is open.
        (lumps / changed).write_text("after")
        headers = {"X-Change-Confirmation": token}
        response = client.post("/api/lumps/save", json={"value": 1}, headers=headers)
        assert response.status_code == (200 if allowed else 409)
        assert bool(calls) is allowed
        if not allowed:
            assert response.json["error"] == "change_confirmation_invalid"
            assert response.json["committed"] is False
        # Excluding coordination data must not weaken one-use authorization.
        assert client.post("/api/lumps/save", json={"value": 1},
                           headers=headers).status_code == 409


def test_review_rejection_diagnostics_keep_safe_server_code():
    """AST-isolate the production sanitizer to avoid live app initialization."""
    root = Path(__file__).parents[2]
    module = ast.parse((root / "server/app.py").read_text())
    names = {"_LUMP_DIAGNOSTIC_CODES", "_LUMP_DIAGNOSTIC_CODE_REASONS",
             "_lump_diagnostic_error_code", "_sanitize_lump_diagnostic_error"}
    nodes = [n for n in module.body
             if (isinstance(n, ast.FunctionDef) and n.name in names)
             or (isinstance(n, ast.Assign) and any(
                 isinstance(t, ast.Name) and t.id in names for t in n.targets))]
    scope = {
        "_lump_diagnostic_error_name": lambda value: "Error",
        "_lump_diagnostic_stack_locations": lambda value: None,
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "<isolated>", "exec"), scope)
    result = scope["_sanitize_lump_diagnostic_error"]({
        "code": "change_confirmation_invalid", "message": "private payload",
    })
    assert result["code"] == "change_confirmation_invalid"
    assert "saved state changed" in result["reason"]
    assert "private payload" not in str(result)


def test_shared_store_process_restart_and_atomic_one_use(tmp_path):
    path = tmp_path / "private" / "reviews.sqlite"
    secret_binding = ("private-session-value", "private-request-value")
    token = IntentStore(path).issue(secret_binding)
    with ProcessPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(_consume_shared, [(path, token, secret_binding)] * 8))
    assert results.count(True) == 1
    assert not IntentStore(path).consume(token, secret_binding)
    persisted = path.read_bytes()
    assert token.encode() not in persisted
    assert all(value.encode() not in persisted for value in secret_binding)
    assert path.stat().st_mode & 0o777 == 0o600


def test_pending_recovery_blocks_reads_writes_but_not_health(tmp_path):
    journal = tmp_path / ".navana-admission-transaction.json"
    original = b'{"phase":"prepared","entries":[]}'
    journal.write_bytes(original)
    app = Flask(__name__)
    app.secret_key = "test-only"
    calls = []
    install(app, lambda: [journal], nullcontext,
            store_path=tmp_path / "private" / "intents.sqlite",
            recovery_pending=journal.exists)

    @app.route("/api/lumps/catalogue", methods=["GET", "POST"])
    def catalogue():
        calls.append(True)
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"ok": True}

    with app.test_client() as client:
        for method in ("get", "post"):
            response = getattr(client, method)("/api/lumps/catalogue")
            assert response.status_code == 503
            assert response.json["error"] == "recovery_approval_required"
        assert client.get("/health").status_code == 200
    assert journal.read_bytes() == original
    assert not calls


def test_history_recovery_function_is_observational(tmp_path):
    # Extract only the function; importing the production app would initialize
    # databases and may touch live artifacts.
    import os
    module = ast.parse((Path(__file__).parents[2] / "server/app.py").read_text())
    function = next(n for n in module.body if isinstance(n, ast.FunctionDef)
                    and n.name == "_recover_lump_history_transition")
    scope = {"os": os, "_LUMP_TRANSITION_JOURNAL": ".journal.json"}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "<isolated>", "exec"), scope)
    journal = tmp_path / ".journal.json"
    journal.write_text('{"state":"prepared"}')
    with pytest.raises(RuntimeError, match="reviewed offline recovery"):
        scope[function.name](str(tmp_path))
    assert journal.read_text() == '{"state":"prepared"}'


def test_cli_output_guards_reject_live_and_aliases_allow_temporary(tmp_path):
    from scripts.live_lump_guard import assert_offline_output
    root = Path(__file__).parents[2]
    live = root / "server/lumps"
    alias = tmp_path / "alias"
    alias.symlink_to(live, target_is_directory=True)
    for destination in (live, live / "file.lump", alias, alias / "file.lump"):
        with pytest.raises(RuntimeError, match="Direct writes"):
            assert_offline_output(destination)
    assert_offline_output(tmp_path / "output")
    result = subprocess.run(["node", "-e", """
      const guard = require(process.argv[1]).assertOfflineOutput;
      for (const target of process.argv.slice(2, 4)) {
        let blocked = false;
        try { guard(target); } catch (e) { blocked = /Direct writes/.test(e.message); }
        if (!blocked) process.exit(1);
      }
      guard(process.argv[4]);
    """, str(root / "scripts/live-lump-guard.js"), str(live),
        str(alias / "file.lump"), str(tmp_path / "output")],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_temporary_output_cannot_hide_live_file_links(tmp_path):
    from scripts.live_lump_guard import assert_offline_output
    root = Path(__file__).parents[2]
    output = tmp_path / "output"
    output.mkdir()
    (output / "manifest.json").symlink_to(root / "server/lumps/manifest.json")
    with pytest.raises(RuntimeError, match="output links"):
        assert_offline_output(output)
    result = subprocess.run(["node", "-e",
        "try { require(process.argv[1]).assertOfflineOutput(process.argv[2]); process.exit(1); } catch(e) { if (!/output links/.test(e.message)) throw e; }",
        str(root / "scripts/live-lump-guard.js"), str(output)],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_legacy_audit_live_write_is_blocked_before_loading(tmp_path, monkeypatch, capsys):
    from scripts import audit_legacy_lump_sidecars as audit
    from scripts import migrate_lumps_filenames as retired
    root = Path(__file__).parents[2]
    loaded = []
    monkeypatch.setattr(audit, "read_approvals", lambda *a, **kw: loaded.append(True))
    with pytest.raises(SystemExit) as exc:
        audit.main(["--write", "--accept", "reviewed.json",
                    "--lumps-dir", str(tmp_path),
                    "--approvals", str(root / "server/lumps/approvals.json")])
    assert exc.value.code == 2
    assert "Direct writes" in capsys.readouterr().err
    assert not loaded
    assert retired.main() == 2
    assert "retired" in capsys.readouterr().err


def test_legacy_audit_temporary_output_and_read_only_still_work(tmp_path):
    from scripts import audit_legacy_lump_sidecars as audit
    # Empty real temporary input is a legitimate no-op, not fabricated data.
    assert audit.main(["--lumps-dir", str(tmp_path)]) == 0
    assert audit.main(["--lumps-dir", str(tmp_path), "--write",
                       "--accept", "absent.json"]) != 0
    assert not (tmp_path / "approvals.json").exists()


def test_intent_consumed_on_mismatch_expiry_and_replay():
    store = IntentStore()
    key = store.issue(("session", "request", "state"), now=0)
    assert not store.consume(key, ("wrong-session", "request", "state"), now=1)
    assert not store.consume(key, ("session", "request", "state"), now=2)
    key = store.issue(("binding",), now=0)
    assert not store.consume(key, ("binding",), now=301)
    key = store.issue(("binding",), now=0)
    assert store.consume(key, ("binding",), now=1)
    assert not store.consume(key, ("binding",), now=2)


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        (
            {
                "lump_name": "Church.Example",
                "current_version": 7,
                "proposed_version": 9,
                "consequence": "replace",
                "session": "must-not-leak",
            },
            ["LUMP: Church.Example", "Version: 7 \u2192 9"],
        ),
        (
            {
                "lump_name": "Church.New",
                "current_version": None,
                "proposed_version": 1,
                "consequence": "create",
            },
            ["LUMP: Church.New", "Version: New Entry \u2192 1"],
        ),
    ],
)
def test_authoritative_lump_plan_review_lines(plan, expected):
    lines = describe_lump_save_plan(plan)
    assert lines == expected
    assert "must-not-leak" not in "\n".join(lines)


def test_lump_plan_review_never_fabricates_unresolved_revision():
    assert describe_lump_save_plan(None) == [
        "LUMP: unavailable (authoritative save plan could not be resolved)",
        "Version: unavailable (authoritative save plan could not be resolved)",
    ]
    assert describe_lump_save_plan({
        "lump_name": "Church.Unknown",
        "current_version": 4,
        "proposed_version": None,
        "consequence": "replace",
    })[1] == "Version: unavailable (authoritative save plan could not be resolved)"


def test_save_plan_binding_includes_reviewed_versions():
    """Exercise only the extracted validator; never import the production app."""
    module = ast.parse((Path(__file__).parents[2] / "server/app.py").read_text())
    function = next(
        node for node in module.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "_check_lump_save_plan"
    )
    record = {
        "expires": time.time() + 60,
        "session": "isolated-session",
        "digest": "digest",
        "action": "replace",
        "token": "token",
        "filename": "name.lump",
        "consequence": "replace",
        "replacement_identity": ("identity",),
        "generation": "generation",
        "current_version": 4,
        "proposed_version": 6,
        "save_as_latest": False,
    }
    scope = {
        "_LUMP_SAVE_PLANS": {"plan": record},
        "_LUMP_SAVE_PLANS_LOCK": threading.RLock(),
        "session": {"_lump_approval_session": "isolated-session"},
        "time": time,
    }
    exec(compile(ast.Module(body=[function], type_ignores=[]),
                 "<isolated>", "exec"), scope)
    common = {
        "digest": "digest",
        "action": "replace",
        "token": "token",
        "filename": "name.lump",
        "consequence": "replace",
        "replacement_identity": ("identity",),
        "generation": "generation",
        "current_version": 4,
        "proposed_version": 6,
    }
    assert scope[function.name]("plan", **common) is record
    with pytest.raises(ValueError, match="proposed version does not match"):
        scope[function.name]("plan", **dict(common, proposed_version=7))


def test_protected_route_inventory():
    for path in (
        "/api/lumps/save", "/api/source-file/save", "/api/boot-image/save-ns",
        "/api/boot-config/slot-label", "/api/namespace/boot-marker",
        "/api/lumps/abc/history/1", "/api/lump/abc/fork-version",
    ):
        assert protected_request(path, "POST")
        assert not protected_request(path, "GET")
    for path in ("/api/lumps/save-plan", "/api/lumps/save-diagnostics",
                 "/api/lumps/lease/renew", "/api/compile"):
        assert not protected_request(path, "POST")


def test_review_confirm_reject_stale_body_session_replay(tmp_path):
    source = tmp_path / "source.cloomc"
    source.write_text("original")
    app = Flask(__name__)
    app.secret_key = "isolated-test-key"
    calls = []
    install(app, lambda: [source], nullcontext,
            store_path=tmp_path / "private" / "reviews.sqlite")

    @app.post("/api/source-file/save")
    def save():
        calls.append("write")
        source.write_text("changed")
        return {"ok": True}

    client = app.test_client()
    body = {"path": "source.cloomc", "content": "changed"}
    response = client.post("/api/source-file/save", json=body)
    assert response.status_code == 428
    assert not calls and source.read_text() == "original"  # reject: do not retry
    token = response.json["change_confirmation"]["id"]
    response = client.post("/api/source-file/save", json=body,
                           headers={"X-Change-Confirmation": token})
    assert response.status_code == 200 and len(calls) == 1
    assert client.post("/api/source-file/save", json=body,
                       headers={"X-Change-Confirmation": token}).status_code == 409
    token = client.post("/api/source-file/save", json=body).json["change_confirmation"]["id"]
    source.write_text("concurrent edit")
    assert client.post("/api/source-file/save", json=body,
                       headers={"X-Change-Confirmation": token}).status_code == 409
    assert source.read_text() == "concurrent edit" and len(calls) == 1
    token = client.post("/api/source-file/save", json=body).json["change_confirmation"]["id"]
    assert client.post("/api/source-file/save", json={"content": "other"},
                       headers={"X-Change-Confirmation": token}).status_code == 409
    token = client.post("/api/source-file/save", json=body).json["change_confirmation"]["id"]
    other = app.test_client()
    assert other.post("/api/source-file/save", json=body,
                      headers={"X-Change-Confirmation": token}).status_code == 409
    assert len(calls) == 1

def test_rejection_audit_is_durable_session_bound_sanitized_and_revokes(tmp_path):
    state = tmp_path / "protected"
    state.write_text("before")
    database = tmp_path / "reviews.sqlite"
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    install(
        app, lambda: [state], nullcontext, store_path=database,
        describe=lambda _payload: [
            "LUMP: SafePet",
            "Version: 2 → 3",
            "--- current\n+++ proposed\n+credential=must-not-persist",
        ])

    @app.post("/api/boot-config")
    def mutate():
        state.write_text("after")
        return {"ok": True}

    owner = app.test_client()
    issued = owner.post("/api/boot-config", json={
        "source": "must-not-persist", "approval": "must-not-persist",
    }).json["change_confirmation"]
    assert isinstance(issued["review_id"], str)
    assert isinstance(issued["expires_at"], int)

    stranger = app.test_client()
    assert stranger.post("/api/change-reviews/reject", json={
        "review_id": issued["review_id"], "outcome": "rejected",
    }).status_code == 403
    rejected = owner.post("/api/change-reviews/reject", json={
        "review_id": issued["review_id"], "outcome": "rejected",
        "ignored_source": "must-not-persist",
    })
    assert rejected.status_code == 200
    assert owner.post("/api/change-reviews/reject", json={
        "review_id": issued["review_id"], "outcome": "rejected",
    }).json["idempotent"] is True
    assert owner.post("/api/boot-config", json={
        "source": "must-not-persist", "approval": "must-not-persist",
    }, headers={"X-Change-Confirmation": issued["id"]}).status_code == 409
    assert state.read_text() == "before"

    with sqlite3.connect(database) as db:
        row = db.execute(
            "SELECT outcome, proposed_changes, affected_artifacts "
            "FROM change_reviews WHERE review_id = ?",
            (issued["review_id"],)).fetchone()
    assert row[0] == "rejected"
    assert json.loads(row[1]) == [
        "POST /api/boot-config", "LUMP: SafePet", "Version: 2 → 3"]
    assert "must-not-persist" not in database.read_bytes().decode(
        "utf-8", errors="ignore")

def test_config_audit_allowlist_rejects_arbitrary_nested_keys():
    proposed, _affected = change_confirmation._audit_descriptions([
        "step1.threadCount: 1 → 2",
        "step1.credentials.password: absent → hunter2",
        "slotRules.7: Lazy → Resident",
    ])
    assert "step1.threadCount: 1 → 2" in proposed
    assert "slotRules.7: Lazy → Resident" in proposed
    assert "hunter2" not in str(proposed)

def test_audit_quota_retains_terminal_rows_then_reuses_after_retention(tmp_path):
    database = tmp_path / "bounded.sqlite"
    retention = 100
    store = IntentStore(
        database, max_reviews=2, retention_seconds=retention,
        max_metadata_bytes=1024)

    def binding(number):
        return ("session", "POST", "/api/boot-config?",
                f"request-{number}", "state")

    approved_token, approved_id, _ = store.issue_review(
        binding(1), "POST", "/api/boot-config", ["change"], [], now=1)
    assert store.consume_reason(
        approved_token, binding(1), now=2) == "accepted"
    _rejected_token, rejected_id, _ = store.issue_review(
        binding(2), "POST", "/api/boot-config", ["change"], [], now=3)
    assert store.reject(rejected_id, "session", "rejected", now=4) == "recorded"

    with pytest.raises(AuditCapacityError):
        store.issue_review(
            binding(3), "POST", "/api/boot-config", ["change"], [], now=50)
    with sqlite3.connect(database) as db:
        rows = db.execute(
            "SELECT review_id, outcome FROM change_reviews ORDER BY issued_at"
        ).fetchall()
    assert rows == [(approved_id, "approved"), (rejected_id, "rejected")]

    # Both terminal records have completed their full retention period.
    _token, replacement_id, _ = store.issue_review(
        binding(3), "POST", "/api/boot-config", ["change"], [],
        now=retention + 5)
    with sqlite3.connect(database) as db:
        rows = db.execute(
            "SELECT review_id FROM change_reviews ORDER BY issued_at").fetchall()
    assert rows == [(replacement_id,)]

def test_review_expiry_swept_after_reopen(tmp_path):
    database = tmp_path / "reviews.sqlite"
    store = IntentStore(database)
    issued_at = time.time() - 301
    _token, review_id, _expires = store.issue_review(
        ("session", "POST", "/api/boot-config?", "request", "state"),
        "POST", "/api/boot-config", [], [], now=issued_at)
    # Constructor performs the startup sweep, independently of client delivery.
    IntentStore(database)
    with sqlite3.connect(database) as db:
        outcome = db.execute(
            "SELECT outcome FROM change_reviews WHERE review_id = ?",
            (review_id,)).fetchone()[0]
    assert outcome == "expired"

def test_audit_failure_fails_closed_before_protected_route(tmp_path, monkeypatch):
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    calls = []
    database = tmp_path / "reviews.sqlite"
    install(app, lambda: [], nullcontext, store_path=database)

    @app.post("/api/boot-config")
    def mutate():
        calls.append(True)
        return {"ok": True}

    client = app.test_client()
    issued = client.post("/api/boot-config", json={"value": 1})
    assert issued.status_code == 428

    def unavailable(*_args, **_kwargs):
        raise sqlite3.OperationalError("audit unavailable")

    monkeypatch.setattr(change_confirmation.sqlite3, "connect", unavailable)
    response = client.post(
        "/api/boot-config", json={"value": 1},
        headers={"X-Change-Confirmation":
                 issued.json["change_confirmation"]["id"]})
    assert response.status_code == 503
    assert response.json["error"] == "change_review_audit_unavailable"
    assert not calls

def test_server_records_validation_failure_and_reject_type_is_safe(tmp_path):
    state = tmp_path / "state"
    state.write_text("before")
    database = tmp_path / "reviews.sqlite"
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    calls = []
    install(app, lambda: [state], nullcontext, store_path=database)

    @app.post("/api/boot-config")
    def mutate():
        calls.append(True)
        return {"ok": True}

    client = app.test_client()
    confirmation = client.post(
        "/api/boot-config", json={"value": 1}).json["change_confirmation"]
    assert client.post("/api/change-reviews/reject", json={
        "review_id": confirmation["review_id"], "outcome": [],
    }).status_code == 400
    state.write_text("concurrent")
    response = client.post(
        "/api/boot-config", json={"value": 1},
        headers={"X-Change-Confirmation": confirmation["id"]})
    assert response.status_code == 409
    assert not calls
    with sqlite3.connect(database) as db:
        row = db.execute(
            "SELECT outcome, failure_reason FROM change_reviews "
            "WHERE review_id = ?", (confirmation["review_id"],)).fetchone()
    assert row == ("validation_failed", "saved_state_changed")

def test_namespace_audit_helper_uses_exact_selector_and_fixed_fields(tmp_path):
    module = ast.parse((Path(__file__).parents[2] / "server/app.py").read_text())
    function = next(
        node for node in module.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "_describe_namespace_review_changes")

    class BootImage:
        _MMIO_SLOT_SPECS = {}

    scope = {
        "re": __import__("re"),
        "hashlib": __import__("hashlib"),
        "LUMPS_DIR": str(tmp_path),
        "_boot_image_gen": BootImage(),
    }
    exec(compile(ast.Module(body=[function], type_ignores=[]),
                 "<isolated>", "exec"), scope)
    before = [{
        "slot": 9, "name": "Clock", "location": "0x100",
        "token": "0x12", "filename": "clock-v4.lump",
    }]
    proposed = [{"slot": 9, "name": "Clock", "location": "0x120"}]
    manifest = [
        {"token": "0x12", "filename": "other.lump", "lump_version": 99},
        {"token": "0x12", "filename": "clock-v4.lump", "lump_version": 4},
    ]
    lines = scope[function.name](before, proposed, manifest)
    assert "NS[9] location: 0x100 → 0x120" in lines
    assert "NS[9]: pet name Clock; saved version v4" in lines
    assert "v99" not in str(lines)

def test_full_audit_quota_returns_safe_503_without_route_invocation(tmp_path):
    app = Flask(__name__)
    app.secret_key = "isolated-only"
    calls = []
    install(
        app, lambda: [], nullcontext,
        store_path=tmp_path / "bounded.sqlite",
        store_options={"max_reviews": 1, "retention_seconds": 1000})

    @app.post("/api/boot-config")
    def mutate():
        calls.append(True)
        return {"ok": True}

    client = app.test_client()
    first = client.post("/api/boot-config", json={"value": 1})
    review = first.json["change_confirmation"]
    assert client.post("/api/change-reviews/reject", json={
        "review_id": review["review_id"], "outcome": "rejected",
    }).status_code == 200
    blocked = client.post("/api/boot-config", json={"value": 2})
    assert blocked.status_code == 503
    assert blocked.json == {
        "committed": False,
        "error": "change_review_busy",
        "message": "Review audit capacity is unavailable; no change was authorized.",
    }
    assert not calls
