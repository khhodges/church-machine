from server.history_retention import expired_archives


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


def test_cleanup_endpoint_deletes_only_unreferenced_old_archives(tmp_path):
    import ast
    import hashlib
    import json
    import os
    import time
    from contextlib import nullcontext
    from pathlib import Path
    from flask import Flask, jsonify

    app = Flask(__name__)
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
               _lump_history_transition_lock=lambda _: nullcontext(),
               get_lump_history=lambda _: jsonify(history=rows),
               _read_manifest_safe=lambda path: json.loads(Path(path).read_text()),
               _atomic_write_json=lambda path, value: Path(path).write_text(json.dumps(value)),
               os=os, hashlib=hashlib, json=json)
    tree = ast.parse(Path("server/app.py").read_text())
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {"prune_lump_history", "_delete_lump_history_revision"}]
    for node in functions:
        node.decorator_list = []
    exec(compile(ast.Module(body=functions, type_ignores=[]), "retention", "exec"), env)
    app.add_url_rule("/cleanup/<token>", view_func=env["prune_lump_history"], methods=["POST"])
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
        raise OSError("injected cleanup failure")
    env = dict(app=app, prune_lump_history=fail)
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
        env["prune_lump_history"] = lambda token: jsonify(ok=True, deleted=["old.lump"])
        saved = {"ok": True, "committed": True, "token": "12345678"}
        run(saved)
        assert saved["history_retention"]["deleted"] == ["old.lump"]