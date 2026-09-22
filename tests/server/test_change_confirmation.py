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
    IntentStore,
    describe_lump_save_plan,
    install,
    protected_request,
)


def _consume_shared(args):
    path, token, binding = args
    return IntentStore(path).consume(token, binding)


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