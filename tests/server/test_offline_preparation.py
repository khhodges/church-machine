"""Exercise offline preparation in a fresh process, without test startup flags."""
import os
from pathlib import Path
import subprocess
import sys
import pytest

from test_design_simulation import setup_design, isolated_lumps, app_module
from test_development_image_prepare import identity, snapshots


PROBE = r"""
import hashlib
import os
from pathlib import Path
import socket
import sqlite3
import sys
import threading
from unittest.mock import patch
from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.base import BaseScheduler

source = Path(sys.argv[1]).resolve()
identifier = sys.argv[2]
events = []
def forbidden(*args, **kwargs):
    events.append("live service startup")
    raise AssertionError("Offline preparation attempted live service startup")

# Catch attempted writes as well as net changes, including create/delete pairs.
# Temporary compiler/binding outputs are allowed; project files are not.
repo = Path.cwd().resolve()
def audit(event, args):
    if event == "open":
        path, mode, flags = args
        if isinstance(path, (str, bytes)):
            path = Path(os.fsdecode(path)).resolve()
            writing = flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writing and (path.is_relative_to(repo) or path.is_relative_to(source)):
                events.append("protected write")
                raise AssertionError("Offline preparation attempted protected write: " + str(path))
sys.dont_write_bytecode = True
sys.addaudithook(audit)
with patch.object(socket.socket, "bind", forbidden), \
     patch.object(socket.socket, "connect", forbidden), \
     patch.object(threading.Thread, "start", forbidden), \
     patch.object(SQLAlchemy, "init_app", forbidden), \
     patch.object(SQLAlchemy, "create_all", forbidden), \
     patch.object(BaseScheduler, "add_job", forbidden), \
     patch.object(BaseScheduler, "start", forbidden), \
     patch.object(sqlite3, "connect", forbidden):
    from server.offline_preparation import offline_backend
    from server.development_image_prepare import build_saved_design
    from server.development_latest import latest_build
    from server.development_image_view import retained_document
    with offline_backend(source) as backend:
        assert "sqlalchemy" not in backend.app.extensions
        saved = retained_document(backend, identifier, None)
        with latest_build(backend, saved, Path(backend.LUMPS_DIR)) as (_, private, inputs):
            import json, struct
            approvals = json.loads((private / "approvals.json").read_text())["approvals"]
            assert approvals
            for approval in approvals.values():
                raw = (private / approval["filename"]).read_bytes()
                words = struct.unpack(f">{len(raw)//4}I", raw)
                assert backend._verify_compiler_attestation(
                    approval["compiler_record"], hashlib.sha256(raw).hexdigest(), words)
                damaged = dict(approval["compiler_record"], source_hash="0" * 64)
                assert not backend._verify_compiler_attestation(
                    damaged, hashlib.sha256(raw).hexdigest(), words)
        raw, prepared = build_saved_design(backend, identifier)
        assert len(raw) == 65536
        assert prepared["freshness_policy"] == "latest-every-lump"
        assert prepared["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
        assert not prepared["saved_namespace_changed"]
        # Missing signing configuration must fail, never emit unsigned output.
        os.environ.pop("COMPILER_SIGNING_SECRET", None)
        with backend.app.app_context():
            response = backend.app.make_response(backend._compile_development_source(
                {"source": "HALT", "language": "assembly"}))
        assert response.status_code == 503
assert not events, events
assert "server.app" not in sys.modules
print("offline preparation verified")
"""


def test_fresh_process_prepares_without_live_side_effects(setup_design):
    root, _, _, path, _ = setup_design
    before = snapshots(root)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("CHURCH_TEST_")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", PROBE, str(root), identity(path)],
        cwd=Path(__file__).resolve().parents[2], env=env,
        capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "offline preparation verified" in result.stdout
    assert snapshots(root) == before


def test_offline_uses_newest_source_and_rejects_invalid_newest(setup_design):
    from server.offline_preparation import prepare_saved_design
    root, _, document, path, save = setup_design
    latest = save("abstraction ide.SelfTest {\ncapabilities { SELF E }\nmethod Run {\n"
                  "IADD DR1, DR0, #91\nHALT\n}\n}")
    before = snapshots(root)
    _, prepared = prepare_saved_design(identity(path), lumps_directory=root)
    selected = next(row for row in prepared["build_inputs"] if row["kind"] == "lump")
    assert selected["revision"] == latest["lump_version"]
    assert selected["sourceArtifact"] == latest["filename"]
    assert selected["sourceArtifact"] != document["rows"][-1]["selection"]["filename"]
    assert snapshots(root) == before
    (root / latest["filename"]).write_bytes(b"invalid newest binary")
    before = snapshots(root)
    with pytest.raises(ValueError, match="No older copy"):
        prepare_saved_design(identity(path), lumps_directory=root)
    assert snapshots(root) == before


def test_offline_detects_input_changes_and_removes_private_copy(setup_design):
    from server.offline_preparation import offline_backend
    root, _, _, path, _ = setup_design
    with pytest.raises(ValueError, match="inputs changed"):
        with offline_backend(root) as backend:
            private = Path(backend.LUMPS_DIR)
            path.write_bytes(path.read_bytes() + b"\n")
    assert not private.exists()
