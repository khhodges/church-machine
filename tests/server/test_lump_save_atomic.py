"""Atomic binary, history, manifest, and approval transition coverage."""

import hashlib
import json
import os
import struct
import sys
import types
from unittest.mock import patch

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


def _binary(marker):
    return struct.pack(">64I", (0x1F << 27) | (1 << 10), marker, *([0] * 62))


def _approval(raw):
    digest = hashlib.sha256(raw).hexdigest()
    return digest, {
        "binary_hash": digest, "filename": "current.lump",
        "dot_name": "Atomic.Example", "issue_n": 1,
    }


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {},
    }))
    (tmp_path / ".history-transition.lock").write_bytes(b"")
    return tmp_path


def test_transition_commits_binary_manifest_history_and_strict_approval(repo):
    old = _binary(1)
    new = _binary(2)
    (repo / "current.lump").write_bytes(old)
    digest, approval = _approval(new)
    result = app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={"token": "a70f0001", "filename": "current.lump",
                        "abstraction": "Atomic.Example"},
        binary_filename="current.lump", binary_bytes=new,
        approval_hash=digest, approval=approval,
        archive_stem="Atomic.Example", archive_version=1,
        archive_binary_path=str(repo / "current.lump"),
    )
    assert result["lump"].endswith(".lump")
    assert (repo / "current.lump").read_bytes() == new
    assert (repo / "Atomic.Example_v1.lump").read_bytes() == old
    ledger = json.loads((repo / "approvals.json").read_text())
    assert ledger == {"version": 1, "algorithm": "sha256",
                      "approvals": {digest: approval}}
    assert "sidecar_file" not in json.loads((repo / "manifest.json").read_text())[0]


def test_approval_commit_failure_restores_every_file(repo):
    old = _binary(1)
    new = _binary(2)
    (repo / "current.lump").write_bytes(old)
    (repo / "manifest.json").write_text(json.dumps([{
        "token": "a70f0001", "filename": "current.lump",
        "abstraction": "Atomic.Example",
    }]))
    before = {p.name: p.read_bytes() for p in repo.iterdir()}
    digest, approval = _approval(new)
    real_replace = os.replace
    failed = False

    def fail(source, destination):
        nonlocal failed
        if (not failed and
                os.path.abspath(destination) == os.path.abspath(repo / "approvals.json")):
            failed = True
            raise OSError("approval failure")
        return real_replace(source, destination)

    with patch.object(app_module.os, "replace", side_effect=fail):
        with pytest.raises(OSError, match="approval failure"):
            app_module._commit_lump_history_transition(
                lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
                token8="a70f0001",
                manifest_entry={"token": "a70f0001", "filename": "current.lump",
                                "abstraction": "Atomic.Example"},
                binary_filename="current.lump", binary_bytes=new,
                approval_hash=digest, approval=approval,
                archive_stem="Atomic.Example", archive_version=1,
                archive_binary_path=str(repo / "current.lump"),
            )
    assert {p.name: p.read_bytes() for p in repo.iterdir()} == before