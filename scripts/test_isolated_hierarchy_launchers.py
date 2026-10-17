"""Execute shell launcher setup, replacing only the browser with real API probes.

The probe imports the actual Flask application with the launcher's environment.
Opening the real hierarchy (even read-only) raises before access.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHERS = ("run-task3430-e2e.sh", "run-namespace-clear-tunnel-e2e.sh",
             "run-all-tests.sh", "run_test_suite_isolated.sh")
PROBE = r'''
import json, os, sys
from pathlib import Path
root = Path(os.environ["PROBE_ROOT"])
live = (root / "server/ide-hierarchy.json").resolve()
private = Path(os.environ["CHURCH_TEST_IDE_HIERARCHY_PATH"]).resolve()
assert not private.is_relative_to(root / "server")
expected = json.loads(os.environ["PROBE_EXPECTED"])
assert json.loads(private.read_bytes()) == expected
def guard(event, args):
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        assert Path(os.fsdecode(args[0])).resolve() != live, "Live hierarchy access"
sys.addaudithook(guard)
# The general per-suite wrapper does not start a Flask server; give this probe
# its other required private roots, while retaining its hierarchy environment.
os.environ["CHURCH_TEST_ISOLATED_MODE"] = "1"
os.environ.setdefault("CHURCH_TEST_DB_PATH", str(private.parent / "probe.db"))
os.environ.setdefault("CHURCH_TEST_BUILD_SNAPSHOTS_DIR", str(private.parent / "snapshots"))
sys.path.insert(0, str(root))
from server import app as server
client = server.app.test_client()
assert client.get("/api/ide-hierarchy").json == expected
for language, source in [
    ("assembly", "abstraction test.IsolationProbe {\ncapabilities { SELF E }\nmethod Run() {\nIADD DR1, DR0, #42\nRETURN\n}\n}"),
    ("javascript", "abstraction test.IsolationProbe {\nmethod Run() {\nreturn(42)\n}\n}"),
]:
    result = client.post("/api/compile", json={"language": language, "source": source})
    assert result.status_code == 200 and result.json["ok"], result.json
result = client.put("/api/ide-hierarchy", json={
    "node":"privatechanged", "expected":expected, "confirmed":True},
    headers={"X-Requested-With":"NamespaceDesign"})
assert result.status_code == 200, result.json
assert json.loads(private.read_bytes())["node"] == "privatechanged"
assert client.get("/api/ide-hierarchy").json == result.json
Path(os.environ["PROBE_MARKER"]).write_text("compiled and saved privately")
'''


@pytest.mark.parametrize("launcher", LAUNCHERS)
@pytest.mark.parametrize("provisioned", [True, False])
def test_launcher_hierarchy_is_private_and_compiles(tmp_path, launcher, provisioned):
    project = tmp_path / "project"
    scripts = project / "scripts"
    scripts.mkdir(parents=True)
    for name in (launcher, "check_lumps_dir_clean.py"):
        shutil.copy2(ROOT / "scripts" / name, scripts / name)
    # The all-suite registry sync is unrelated to this sandbox wiring probe.
    (scripts / "check-run-all-tests-sync.js").write_text("process.exit(0);\n")
    server = project / "server"
    (server / "lumps").mkdir(parents=True)
    (server / "lumps/manifest.json").write_text("[]")
    (server / "lumps/ns-state.json").write_text('{"abstractions":[]}')
    (server / "boot-config.json").write_text("{}")
    (server / "church_machine.db").touch()
    expected = {"node":"launchfixture", "aliases":{}, "definitions":{}} if provisioned else None
    if provisioned:
        (server / "ide-hierarchy.json").write_text(json.dumps(expected))
    fake_before = (server / "ide-hierarchy.json").read_bytes() if provisioned else None
    real = ROOT / "server/ide-hierarchy.json"
    real_hash = lambda: hashlib.sha256(real.read_bytes()).hexdigest() if real.exists() else None
    before = real_hash()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    probe = tmp_path / "probe.py"
    probe.write_text(PROBE)
    (bin_dir / "npx").write_text(f'#!/usr/bin/env bash\nexec "{sys.executable}" "{probe}"\n')
    (bin_dir / "npx").chmod(0o755)
    marker = tmp_path / "done"
    # Drop inherited storage overrides, not the runtime's secret values.
    env = {key: value for key, value in os.environ.items() if not key.startswith("CHURCH_TEST_")}
    env.update(PATH=str(bin_dir) + os.pathsep + env["PATH"], PROBE_ROOT=str(ROOT),
               PROBE_EXPECTED=json.dumps(expected), PROBE_MARKER=str(marker))
    command = ["bash", str(scripts / launcher)]
    if launcher == "run-all-tests.sh":
        command += ["e2e-tests"]
    elif launcher == "run_test_suite_isolated.sh":
        command += [str(tmp_path / "sandbox"), "probe", "npx"]
    try:
        result = subprocess.run(command, cwd=project, env=env, capture_output=True,
                                text=True, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr
        assert marker.read_text() == "compiled and saved privately"
        assert ((server / "ide-hierarchy.json").read_bytes() if provisioned else None) == fake_before
        if not provisioned:
            assert not (server / "ide-hierarchy.json").exists()
    finally:
        assert real_hash() == before
