"""Real compiler/admission + real toolbar, served only from disposable state.

Run: python3 -m pytest tests/server/test_design_simulation_browser.py -q
No normal webServer, production selection, saved image, or board is used.
"""
import copy
import hashlib
import json
import subprocess
import threading
from pathlib import Path

from flask import jsonify, request
from werkzeug.serving import make_server

from test_design_simulation import setup_design, app_module, isolated_lumps
from server.namespace_design_v1 import PHASE1_FORMAT, digest

ROOT = Path(__file__).resolve().parents[2]


def test_selected_design_toolbar_in_browser(setup_design, monkeypatch):
    root, client, document, path, save = setup_design
    # Long enough for multiple Walk ticks, deterministic final state for Run.
    source = ("abstraction ide.ToolbarTest {\ncapabilities { SELF E }\nmethod Run {\n"
              + "IADD DR1, DR1, #1\n" * 80 + "HALT\n}\n}")
    saved = save(source, name="ide.ToolbarTest")
    document["rows"][-1].update(name="ide.ToolbarTest", selection={
        "filename": saved["filename"], "binaryHash": saved["binary_hash"],
        "token": saved["token"], "revision": saved["lump_version"]})
    path.write_text(json.dumps(document))
    phase1 = copy.deepcopy(document)
    phase1.update(format=PHASE1_FORMAT, slotCount=256)
    (path.parent / "phase1.json").write_text(json.dumps(phase1))
    expected = {}
    for profile, doc in (("ascending", document), ("phase1", phase1)):
        response = client.post(f"/api/simulation/design/{profile}/prepare",
            json={"namespaceFingerprint": digest(doc)},
            headers={"X-Requested-With": "NamespaceDesign"})
        assert response.status_code == 200, response.json
        expected[profile] = response.json["imageHash"]
    assert expected["ascending"] != expected["phase1"]
    run_private_browser(root, path, monkeypatch, "design_simulation_browser.cjs",
                        {"hashes": expected}, "PASS selected-design toolbar")


def test_saved_design_trace_identity_in_browser(setup_design, monkeypatch):
    root, client, document, path, _ = setup_design
    document["rows"][-1]["slot"] = 10
    document.update(format=PHASE1_FORMAT, slotCount=256)
    path = path.parent / "phase1.json"
    path.write_text(json.dumps(document))
    run_private_browser(root, path, monkeypatch, "design_trace_identity_browser.cjs",
                        {"selection": document["rows"][-1]["selection"]},
                        "PASS saved-design trace identity")


def run_private_browser(root, path, monkeypatch, script, inputs, marker):
    # All catalog bytes, approvals, selections, and the installed-image sentinel
    # stay identical. Only private simulation history is allowed to grow.
    protected = [*root.glob("*.lump"), root / "manifest.json", root / "approvals.json",
                 root / "absent-boot.bin", root / "ns-state.json",
                 root / "boot-config.json", *path.parent.glob("*.json")]
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    forbidden = []

    def guard():
        url = request.path.lower()
        if any(part in url for part in ("wukong", "hardware", "fpga", "serial", "flash")):
            return jsonify(error="hardware disabled in private browser fixture"), 403
        if request.method not in ("GET", "HEAD", "OPTIONS") and not (
                url.startswith("/api/simulation/design/")):
            forbidden.append((request.method, request.path))
            return jsonify(error="only private simulation writes allowed"), 403

    monkeypatch.setitem(app_module.app.before_request_funcs, None,
        [guard, *app_module.app.before_request_funcs.get(None, [])])
    http = make_server("127.0.0.1", 0, app_module.app, threaded=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        run = subprocess.run(["node", f"tests/server/{script}"],
            input=json.dumps({"url": f"http://127.0.0.1:{http.server_port}", **inputs}),
            text=True, capture_output=True, cwd=ROOT, timeout=150)
        assert run.returncode == 0, run.stdout + run.stderr
        assert marker in run.stdout
        assert not forbidden, forbidden
        assert {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in protected} == before
    finally:
        http.shutdown()
        http.server_close()
        thread.join(timeout=5)
