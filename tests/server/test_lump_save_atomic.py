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


def test_transition_cas_uses_active_row_when_archives_share_token(repo):
    old = _binary(3)
    new = _binary(4)
    (repo / "current.lump").write_bytes(old)
    (repo / "candidate.lump").write_bytes(_binary(9))
    active = {
        "token": "a70f0001", "filename": "current.lump",
        "abstraction": "Atomic.Example", "lump_version": 2,
    }
    (repo / "manifest.json").write_text(json.dumps([
        {
            "token": "a70f0001", "filename": "Atomic.Example_v1.lump",
            "abstraction": "Atomic.Example", "lump_version": 1,
            "archived": True,
        },
        active,
        {
            "token": "bad0cafe", "filename": "candidate.lump",
            "abstraction": "Atomic.Example", "lump_version": 3,
        },
    ]))
    (repo / "Atomic.Example_v1.lump").write_bytes(_binary(1))
    digest, approval = _approval(new)

    result = app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={
            **active, "filename": "candidate.lump", "lump_version": 4,
        },
        binary_filename="candidate.lump", binary_bytes=new,
        approval_hash=digest, approval=approval,
        archive_stem="Atomic.Example", archive_version=2,
        archive_binary_path=str(repo / "current.lump"),
        expected_manifest_entry=active,
    )

    assert result["lump"].endswith(".lump")
    assert (repo / "candidate.lump").read_bytes() == new
    manifest = json.loads((repo / "manifest.json").read_text())
    active_rows = [
        row for row in manifest
        if row.get("abstraction") == "Atomic.Example"
        and row.get("archived") is not True
    ]
    assert active_rows == [{
        **active, "filename": "candidate.lump", "lump_version": 4,
    }]
    assert any(
        row.get("filename") == "Atomic.Example_v1.lump"
        and row.get("archived") is True
        for row in manifest
    )


def test_transition_reconciles_duplicate_live_token_rows_without_deleting_history(repo):
    old = _binary(3)
    stale = _binary(8)
    new = _binary(4)
    (repo / "current.lump").write_bytes(old)
    (repo / "stale.lump").write_bytes(stale)
    active = {
        "token": "a70f0001", "filename": "current.lump",
        "abstraction": "Atomic.Example", "lump_version": 2,
    }
    stale_live = {
        "token": "a70f0001", "filename": "stale.lump",
        "abstraction": "Atomic.Example", "lump_version": 1,
    }
    immutable_history = {
        "token": "a70f0001", "filename": "Atomic.Example_v0.lump",
        "abstraction": "Atomic.Example", "lump_version": 0,
        "archived": True,
    }
    (repo / "manifest.json").write_text(json.dumps([
        immutable_history, active, stale_live,
    ]))
    digest, approval = _approval(new)

    app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={
            **active, "filename": "candidate.lump", "lump_version": 3,
        },
        binary_filename="candidate.lump", binary_bytes=new,
        approval_hash=digest, approval=approval,
        expected_manifest_entry=active,
    )

    manifest = json.loads((repo / "manifest.json").read_text())
    live = [
        row for row in manifest
        if row.get("token") == "a70f0001" and row.get("archived") is not True
    ]
    assert live == [{
        **active, "filename": "candidate.lump", "lump_version": 3,
    }]
    assert immutable_history in manifest
    assert {
        **active, "archived": True,
    } in manifest
    assert {
        **stale_live, "archived": True,
    } in manifest


def test_transition_retires_live_row_that_collides_with_published_destination(repo):
    old = _binary(3)
    new = _binary(4)
    (repo / "current.lump").write_bytes(old)
    (repo / "candidate.lump").write_bytes(old)
    (repo / "manifest.json").write_text(json.dumps([
        {
            "token": "other001", "filename": "candidate.lump",
            "abstraction": "Other.Example", "lump_version": 1,
        },
    ]))
    digest, approval = _approval(new)

    app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={
            "token": "a70f0001", "filename": "candidate.lump",
            "abstraction": "Atomic.Example", "lump_version": 1,
        },
        binary_filename="candidate.lump", binary_bytes=new,
        approval_hash=digest, approval=approval,
    )

    manifest = json.loads((repo / "manifest.json").read_text())
    assert sum(row.get("archived") is not True for row in manifest
               if row.get("filename") == "candidate.lump") == 1
    archived, = [
        row for row in manifest
        if row.get("token") == "other001" and row.get("archived") is True
    ]
    assert archived["filename"] != "candidate.lump"
    assert (repo / archived["filename"]).read_bytes() == old
    assert archived["binary_hash"] == hashlib.sha256(old).hexdigest()
    assert (repo / "candidate.lump").read_bytes() == new


def test_same_token_same_filename_replacement_preserves_old_bytes(repo):
    old = _binary(5)
    new = _binary(6)
    current = {
        "token": "a70f0001", "filename": "current.lump",
        "abstraction": "Atomic.Example", "lump_version": 1,
    }
    (repo / "current.lump").write_bytes(old)
    (repo / "manifest.json").write_text(json.dumps([current]))
    digest, approval = _approval(new)

    app_module._commit_lump_history_transition(
        lumps_dir=str(repo), manifest_path=str(repo / "manifest.json"),
        token8="a70f0001",
        manifest_entry={**current, "lump_version": 2},
        binary_filename="current.lump", binary_bytes=new,
        approval_hash=digest, approval=approval,
        expected_manifest_entry=current,
    )

    manifest = json.loads((repo / "manifest.json").read_text())
    live, = [row for row in manifest if row.get("archived") is not True]
    archived, = [row for row in manifest if row.get("archived") is True]
    assert live["filename"] == "current.lump"
    assert (repo / "current.lump").read_bytes() == new
    assert archived["filename"] != "current.lump"
    assert (repo / archived["filename"]).read_bytes() == old
    assert archived["binary_hash"] == hashlib.sha256(old).hexdigest()


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