"""Browser save callback -> real publication/CAS -> executed private image.

The HTTP server exists only inside this fixture. No existing server, workspace
library, hardware endpoint, network service, or saved boot image is used.
"""
import hashlib
import json
import subprocess
import threading
from pathlib import Path

from flask import jsonify, request
from werkzeug.serving import make_server

from test_artifact_only_publication import app_module, isolated_lumps, publish
from server.artifact_revisions import RevisionStore
from server.simulation_preparation import PreparationStore

ROOT = Path(__file__).resolve().parents[2]


def tree_digest(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in directory.rglob("*") if p.is_file()}


def test_save_callback_reaches_executed_revision(isolated_lumps, monkeypatch):
    root = isolated_lumps
    live_before = tree_digest(ROOT / "server" / "lumps")
    monkeypatch.setenv("CHURCH_TEST_LUMPS_DIR", str(root))
    monkeypatch.setenv("CHURCH_TEST_BOOT_CONFIG_PATH", str(root / "boot-config.json"))
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "private-save-handoff-" + "x" * 40)
    def store():
        return PreparationStore(revision_store=RevisionStore(str(root / "history")))
    monkeypatch.setattr(app_module, "_simulation_preparations", store())
    cfg = {"targetBoard": "wukong-xc7a100t", "step1": {
        "totalNamespaceWords": 16384, "namespaceLumpWords": 64,
        "threadLumpWords": 256, "nsSlotsMax": 64}}
    (root / "boot-config.json").write_text(json.dumps(cfg))
    rows = [{"slot": 0, "name": "Boot.NS", "type": "Inform"},
            {"slot": 1, "name": "Boot.Thread", "type": "Inform"}]
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    (root / "absent-boot.bin").write_bytes(b"do not install shared image")
    client = app_module.app.test_client()

    def compile_publish(name, value):
        source = f"abstraction {name} {{\n method Ping() {{ return({value}) }}\n}}\n"
        result = client.post("/api/compile", json={
            "source": source, "language": "javascript", "tier": 2})
        assert result.status_code == 200 and result.json["ok"], result.json
        compiled = result.json
        record = compiled["compiler_record"]
        saved = publish(client, {"binary": compiled["words"], "metadata": {
            "abstraction": name, "language": "javascript", "content_type": "code",
            "capabilities": compiled["capabilities"], "submitted_source": source,
            "trust_origin": compiled["trust_origin"], "compiler_record": record,
            "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"], "grants": ["E"]}})
        return dict(saved, source=source)

    bootstrap = compile_publish("ide.SelfTest", 7)
    old = compile_publish("ide.CapabilityTest", 11)
    unrelated_old = compile_publish("ide.Unrelated", 31)
    unrelated = compile_publish("ide.Unrelated", 32)
    location = 272
    for slot, saved in [(6, bootstrap), (10, old), (14, unrelated)]:
        name = {6: "SelfTest", 10: "CapabilityTest"}.get(slot, saved["abstraction"])
        rows.append({"slot": slot, "name": name, "type": "Inform",
                     "location": location, "seq": 3, "boot": slot == 10,
                     "resident": slot == 6, "load_policy": "Resident" if slot == 6 else "Lazy",
                     "filename": saved["filename"], "token": saved["token"],
                     "binary_hash": saved["binary_hash"]})
        location += len((root / saved["filename"]).read_bytes()) // 4
    payload = {"namespaceFingerprint": app_module._namespace_state_fingerprint(rows[:2]),
               "ns_state": {"abstractions": rows}}
    response = client.post("/api/namespace/save-table", json=payload)
    assert response.status_code == 428, response.json
    response = client.post("/api/namespace/save-table", json=payload, headers={
        "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    immutable = {p: p.read_bytes() for p in root.glob("*.lump")}
    unrelated_history = client.get(f"/api/lumps/{unrelated['token']}/history").json

    # Only deliberate failure injection: expire reviewed in-memory preparation
    # just before activation. The real activation endpoint must reject it.
    controls = {"expire_activation": False}
    def before_request():
        if request.path == "/__save_alignment_control":
            action = request.json["action"]
            if action == "expire-activation":
                controls["expire_activation"] = True
            elif action == "restart":
                app_module._simulation_preparations = store()
            else:
                return jsonify(error="unknown fixture action"), 400
            return jsonify(ok=True)
        if request.path == "/api/simulation/activate" and controls["expire_activation"]:
            controls["expire_activation"] = False
            app_module._simulation_preparations.records.clear()
        if any(part in request.path.lower() for part in ("wukong", "hardware", "fpga", "serial", "flash")):
            return jsonify(error="hardware forbidden in private regression"), 403

    monkeypatch.setitem(app_module.app.before_request_funcs, None,
                        [before_request, *app_module.app.before_request_funcs.get(None, [])])
    http = make_server("127.0.0.1", 0, app_module.app, threaded=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        run = subprocess.run(
            ["node", "tests/server/save_realignment_browser.cjs"],
            input=json.dumps({"url": f"http://127.0.0.1:{http.server_port}",
                              "old": old, "cfg": cfg}), text=True,
            capture_output=True, cwd=ROOT, timeout=180)
        assert run.returncode == 0, run.stdout + "\n" + run.stderr
        assert "PASS executed saved revision" in run.stdout
        final_rows = json.loads((root / "ns-state.json").read_text())["abstractions"]
        target = next(row for row in final_rows if row["slot"] == 10)
        assert target["name"] == "ide.CapabilityTest"
        assert target["seq"] == 3 and target["boot"] is True
        # A competing CAS changes only the unrelated row's label. No automatic
        # retry is allowed to restore the obsolete row read by the first client.
        other = next(row for row in final_rows if row["slot"] == 14)
        assert other == dict(rows[-1], label="concurrent engineer edit")
        assert final_rows[:3] == rows[:3]
        assert client.get(f"/api/lumps/{unrelated['token']}/history").json == unrelated_history
        assert (root / unrelated_old["filename"]).exists()
        for path, original in immutable.items():
            assert path.read_bytes() == original
        assert len(app_module._simulation_preparations.history()) >= 4
    finally:
        http.shutdown()
        thread.join(timeout=5)
        http.server_close()
        assert (root / "absent-boot.bin").read_bytes() == b"do not install shared image"
        assert tree_digest(ROOT / "server" / "lumps") == live_before
