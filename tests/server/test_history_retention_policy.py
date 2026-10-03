from server.history_retention import expired_archives
import pytest


def test_retention_boundaries_and_unknown_dates():
    now = 2_000_000_000
    rows = [
        {"version": n, "compiled_at": now - 40 * 86400,
         "archive_filename": f"Example_v{n}.lump"}
        for n in range(1, 9)
    ]
    rows[0]["current"] = True
    rows[1]["compiled_at"] = None
    rows[2]["compiled_at"] = now - 30 * 86400
    rows[3]["compiled_at"] = now - 29 * 86400
    assert [r["version"] for r in expired_archives(rows, now)] == [5]
    assert len(rows) == 8


def test_ties_iso_dates_and_bad_dates():
    now = 2_000_000_000
    rows = [{"version": n, "compiled_at": "2020-01-01T00:00:00Z",
             "archive_filename": f"x{n}.lump"} for n in (1, 2, 3, 4, 4)]
    assert [r["version"] for r in expired_archives(rows, now)] == [1]
    for invalid in ("nonsense", "2020-01-01", True, float("nan"), float("inf")):
        rows[0]["compiled_at"] = invalid
        assert expired_archives(rows, now) == []

@pytest.fixture
def retention_app(tmp_path):
    import ast
    import hashlib
    import json
    import os
    import time
    from contextlib import contextmanager
    from pathlib import Path
    from flask import Flask, jsonify, request

    app = Flask(__name__)
    locked = []

    @contextmanager
    def transition_lock(_):
        locked.append(True)
        try:
            yield
        finally:
            locked.pop()

    def history(_):
        assert locked
        return jsonify(token="12345678", history=[
            row for row in rows if row.get("current")
            or (tmp_path / row["archive_filename"]).exists()
        ])
    rows = [{"version": n, "compiled_at": time.time() - 40 * 86400,
             "archive_filename": f"Example_v{n}.lump"} for n in range(1, 8)]
    for row in rows:
        (tmp_path / row["archive_filename"]).write_bytes(bytes([row["version"]]) * 256)
    manifest = [{"token": "12345678", "filename": "Example.lump",
                 "abstraction": "Example", "lump_version": 8}]
    (tmp_path / "Example.lump").write_bytes(b"live")
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "ns-state.json").write_text(json.dumps({"filename": "Example_v2.lump"}))
    (tmp_path / "alias.lump").symlink_to("Example_v3.lump")
    rows.append({"version": 8, "current": True})
    env = dict(app=app, jsonify=jsonify, LUMPS_DIR=str(tmp_path),
               _lump_history_transition_lock=transition_lock,
               get_lump_history=history,
               _read_manifest_safe=lambda path: json.loads(Path(path).read_text()),
               _atomic_write_json=lambda path, value: Path(path).write_text(json.dumps(value)),
               os=os, hashlib=hashlib, json=json,
               logging=__import__("logging"), request=request)
    tree = ast.parse(Path("server/app.py").read_text())
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {"prune_lump_history", "_prune_lump_history",
                                   "_post_save_history_retention",
                                   "delete_lump_history_revision",
                                   "_delete_lump_history_revision"}]
    for node in functions:
        node.decorator_list = []
    exec(compile(ast.Module(body=functions, type_ignores=[]), "retention", "exec"), env)
    app.add_url_rule("/cleanup/<token>", view_func=env["prune_lump_history"], methods=["POST"])
    app.add_url_rule("/history/<token>/<int:version>",
                    view_func=env["delete_lump_history_revision"], methods=["DELETE"])
    return app, env, rows
def test_cleanup_endpoint_deletes_only_unreferenced_old_archives(tmp_path, retention_app):
    app, env, rows = retention_app
    response = app.test_client().post("/cleanup/12345678")
    assert response.status_code == 200
    assert response.json["deleted"] == ["Example_v1.lump", "Example_v4.lump", "Example_v5.lump"]
    assert response.json["protected"] == ["Example_v2.lump", "Example_v3.lump"]
    assert (tmp_path / "Example.lump").read_bytes() == b"live"
    assert (tmp_path / "Example_v6.lump").exists()
    # An unreadable reference must prevent all further deletion.
    (tmp_path / "ns-state.json").write_text("{")
    before = set(tmp_path.iterdir())
    assert app.test_client().post("/cleanup/12345678").status_code == 409
    assert set(tmp_path.iterdir()) == before

def test_post_save_protects_frozen_references_links_and_approvals(tmp_path, retention_app):
    import json
    import os
    app, env, rows = retention_app
    frozen = tmp_path.parent / (tmp_path.name + "-frozen")
    frozen.mkdir()
    env["_BUILD_SNAPSHOTS_DIR"] = str(frozen)
    digest = env["hashlib"].sha256((tmp_path / "Example_v1.lump").read_bytes()).hexdigest()
    (frozen / "revision.json").write_text(json.dumps({"binary_hash": digest}))
    os.link(tmp_path / "Example_v4.lump", tmp_path / "linked")
    approval = json.dumps({digest: {"approved": True}})
    (tmp_path / "approvals.json").write_text(approval)
    with app.test_request_context(method="POST"):
        result = env["_post_save_history_retention"]("12345678")
    assert result["ok"]
    assert result["deleted"] == ["Example_v5.lump"]
    ledger = json.loads((tmp_path / "history-retention.json").read_text())
    assert ledger["12345678"][0]["trigger"] == "authorized_save"
    assert ledger["12345678"][0]["binary_hash"]
    assert (tmp_path / "approvals.json").read_text() == approval
    assert (tmp_path / "Example_v1.lump").exists()


def test_frozen_approval_envelope_does_not_pin_unselected_archives(tmp_path, retention_app):
    import hashlib
    import json
    app, env, rows = retention_app
    frozen = tmp_path.parent / (tmp_path.name + "-frozen")
    revision = frozen / "revisions" / "namespace" / ("a" * 64)
    revision.mkdir(parents=True)
    env["_BUILD_SNAPSHOTS_DIR"] = str(frozen)
    hashes = {n: hashlib.sha256(
        (tmp_path / f"Example_v{n}.lump").read_bytes()).hexdigest()
        for n in (1, 4, 5)}
    # Like a production freeze, approval evidence covers the entire registry,
    # while only one old archive is actually selected and retained.
    approvals = json.dumps({"schema_version": 1, "approvals": {
        digest: {"approved": True, "abstraction": "Example"}
        for digest in hashes.values()}})
    approval_path = revision / "approvals.json"
    approval_path.write_text(approvals)
    (tmp_path / "approvals.json").write_text(approvals)
    selected = {"filename": "Example_v1.lump", "binary_hash": hashes[1], "slot": 7}
    (revision / "namespace.json").write_text(json.dumps({"abstractions": [selected]}))
    (revision / (hashes[1] + ".lump")).write_bytes(
        (tmp_path / "Example_v1.lump").read_bytes())
    (revision / "revision.json").write_text(json.dumps({
        "kind": "namespace",
        "metadata": {"selected_lumps": [selected]},
        "files": {
            "approvals.json": hashlib.sha256(approvals.encode()).hexdigest(),
            hashes[1] + ".lump": hashes[1],
        },
    }))
    frozen_before = {p: p.read_bytes() for p in revision.iterdir()}
    with app.test_request_context(method="POST"):
        result = env["_post_save_history_retention"]("12345678")
    assert result["ok"]
    assert result["deleted"] == ["Example_v4.lump", "Example_v5.lump"]
    assert "Example_v1.lump" in result["protected"]
    assert (tmp_path / "Example_v1.lump").exists()
    assert {p: p.read_bytes() for p in revision.iterdir()} == frozen_before
    assert (tmp_path / "approvals.json").read_text() == approvals


def test_pending_cleanup_recovery_and_revalidation(tmp_path):
    import hashlib
    import json
    import pytest
    from server.history_retention import recover_pending

    archive = tmp_path / "Example_v1.lump"
    archive.write_bytes(b"original")
    ledger_path = tmp_path / "history-retention.json"
    entry = {"version": 1, "filename": archive.name, "status": "pending",
             "binary_hash": hashlib.sha256(b"original").hexdigest()}
    ledger_path.write_text(json.dumps({"12345678": [entry]}))
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps([
        {"filename": archive.name, "archived": True},
        {"filename": "Current.lump", "archived": False}]))
    def write(path, value):
        from pathlib import Path
        Path(path).write_text(json.dumps(value))
    # Crash before unlink: recovery alone must not delete anything.
    assert recover_pending(tmp_path, write) == []
    assert archive.read_bytes() == b"original"
    archive.write_bytes(b"replacement")
    with pytest.raises(ValueError, match="changed"):
        recover_pending(tmp_path, write)
    archive.write_bytes(b"original")
    # Crash after unlink: finish manifest/ledger bookkeeping idempotently.
    archive.unlink()
    assert recover_pending(tmp_path, write) == ["Example_v1.lump"]
    assert json.loads(manifest_path.read_text()) == [
        {"filename": "Current.lump", "archived": False}]
    assert json.loads(ledger_path.read_text())["12345678"][0]["status"] == "deleted"
    assert recover_pending(tmp_path, write) == []


def test_post_save_hook_keeps_commit_success_when_cleanup_fails():
    import ast
    from pathlib import Path
    from flask import Flask, jsonify
    app = Flask(__name__)
    source = ast.parse(Path("server/app.py").read_text())
    hook = next(n for n in source.body if isinstance(n, ast.FunctionDef)
                and n.name == "_apply_history_retention_after_save")
    save = next(n for n in source.body if isinstance(n, ast.FunctionDef)
                and n.name == "save_lump")
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
               and n.func.id == hook.name for n in ast.walk(save))
    called = []
    def fail(token):
        called.append(token)
        return {"ok": False, "warning": "Saved; cleanup failed",
                "reason": "injected cleanup failure"}
    env = dict(app=app, _post_save_history_retention=fail)
    exec(compile(ast.Module(body=[hook], type_ignores=[]), "hook", "exec"), env)
    run = env[hook.name]
    run({"ok": False, "committed": False})
    run({"ok": True, "committed": False})
    assert called == []
    with app.app_context():
        saved = {"ok": True, "committed": True, "token": "12345678", "warnings": []}
        run(saved)
        assert saved["ok"] and saved["committed"]
        assert saved["warnings"][0]["code"] == "history_retention_incomplete"
        env["_post_save_history_retention"] = lambda token: dict(ok=True, deleted=["old.lump"])
        saved = {"ok": True, "committed": True, "token": "12345678"}
        run(saved)
        assert saved["history_retention"]["deleted"] == ["old.lump"]

def test_references_are_read_after_lock_acquisition(tmp_path, retention_app):
    from contextlib import contextmanager
    app, env, rows = retention_app
    original_lock = env["_lump_history_transition_lock"]

    @contextmanager
    def competing_namespace_commit(root):
        with original_lock(root):
            (tmp_path / "ns-state.json").write_text('{"filename":"Example_v1.lump"}')
            yield

    env["_lump_history_transition_lock"] = competing_namespace_commit
    response = app.test_client().post("/cleanup/12345678")
    assert response.status_code == 200
    assert "Example_v1.lump" in response.json["protected"]
    assert (tmp_path / "Example_v1.lump").exists()

def test_corrupt_frozen_reference_fails_closed(tmp_path, retention_app):
    app, env, rows = retention_app
    frozen = tmp_path.parent / (tmp_path.name + "-frozen")
    frozen.mkdir()
    (frozen / "revision.json").write_text("{")
    env["_BUILD_SNAPSHOTS_DIR"] = str(frozen)
    before = set(tmp_path.glob("*.lump"))
    assert app.test_client().post("/cleanup/12345678").status_code == 409
    assert set(tmp_path.glob("*.lump")) == before

@pytest.mark.parametrize("failure", ["before_unlink", "after_unlink", "after_manifest", "after_ledger"])
def test_interrupted_retention_recovers_idempotently(tmp_path, retention_app, monkeypatch, failure):
    import json
    from server import history_retention as retention
    app, env, rows = retention_app
    manifest_path = tmp_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.append({"archived": True, "filename": "Example_v1.lump",
                     "abstraction": "Example", "lump_version": 1})
    manifest_path.write_text(json.dumps(manifest))
    original_remove = env["os"].remove
    original_write = retention.durable_json

    def interrupted_remove(path):
        if failure == "before_unlink":
            raise OSError("interrupted before unlink")
        original_remove(path)
        if failure == "after_unlink":
            raise OSError("interrupted after unlink")

    def interrupted_write(path, value):
        original_write(path, value)
        if ((failure == "after_manifest" and path.name == "manifest.json")
                or (failure == "after_ledger" and path.name == retention.LEDGER)):
            raise OSError("interrupted durable write")

    monkeypatch.setattr(env["os"], "remove", interrupted_remove)
    monkeypatch.setattr(retention, "durable_json", interrupted_write)
    with app.test_request_context(method="POST"):
        result = env["_post_save_history_retention"]("12345678")
    assert not result["ok"]
    assert "saved successfully" in result["warning"]
    assert (tmp_path / retention.JOURNAL).exists()
    monkeypatch.setattr(env["os"], "remove", original_remove)
    monkeypatch.setattr(retention, "durable_json", original_write)
    with env["_lump_history_transition_lock"](str(tmp_path)):
        retention.recover_retention(tmp_path)
        retention.recover_retention(tmp_path)
    assert not (tmp_path / retention.JOURNAL).exists()
    if failure == "before_unlink":
        assert (tmp_path / "Example_v1.lump").exists()
        # Newly referenced archives must be rechecked, not blindly replayed.
        (tmp_path / "new-reference.json").write_text('{"filename":"Example_v1.lump"}')
    else:
        ledger = json.loads((tmp_path / retention.LEDGER).read_text())
        assert len(ledger["12345678"]) == 1
        assert not any(r.get("filename") == "Example_v1.lump"
                       for r in json.loads(manifest_path.read_text()))
    assert app.test_client().post("/cleanup/12345678").status_code == 200
    if failure == "before_unlink":
        assert (tmp_path / "Example_v1.lump").exists()

def test_get_never_deletes_or_recovers(tmp_path, retention_app):
    app, env, rows = retention_app
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}
    assert app.test_client().get("/cleanup/12345678").status_code == 405
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()} == before

def test_save_trigger_is_only_after_commit_not_preflight():
    import ast
    from pathlib import Path
    tree = ast.parse(Path("server/app.py").read_text())
    save = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "save_lump")
    calls = [n for n in ast.walk(save) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name) and n.func.id == "_apply_history_retention_after_save"]
    assert len(calls) == 1
    # The last statement before returning the success payload; all rejection
    # and preflight returns precede it, after the actual transition commit.
    assert save.body[-2].value is calls[0]
    assert isinstance(save.body[-1], ast.Return)
