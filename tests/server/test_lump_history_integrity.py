"""History validation derives exclusively from archive bytes and approvals."""
import hashlib
import json
import struct
import sys
import types

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


def _binary(cw=7, cc=2):
    return struct.pack(">64I", (0x1F << 27) | (cw << 10) | cc, *([0] * 63))


def _approve(root, raw):
    digest = hashlib.sha256(raw).hexdigest()
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {digest: {"binary_hash": digest, "abstraction": "History"}},
    }))


def test_snapshot_is_inspectable_without_approval(tmp_path):
    path = tmp_path / "History_v1.lump"
    path.write_bytes(_binary())
    snapshot = app_module._validate_lump_snapshot(str(path))
    assert snapshot["valid"]
    assert snapshot["approved"] is False
    assert snapshot["trusted"] is False
    assert snapshot["errors"] == []


def test_snapshot_binary_facts_and_approval_ignore_archive_json(tmp_path):
    raw = _binary(11, 3)
    path = tmp_path / "History_v1.lump"
    path.write_bytes(raw)
    _approve(tmp_path, raw)
    (tmp_path / "History_v1.json").write_text(json.dumps({"cw": 999}))
    snapshot = app_module._validate_lump_snapshot(str(path))
    assert snapshot["valid"]
    assert snapshot["cw"] == 11
    assert snapshot["cc"] == 3
    assert snapshot["approval"]["abstraction"] == "History"


def test_snapshot_rejects_trailing_binary_even_when_approved(tmp_path):
    raw = _binary() + b"\xff"
    path = tmp_path / "History_v1.lump"
    path.write_bytes(raw)
    _approve(tmp_path, raw)
    snapshot = app_module._validate_lump_snapshot(str(path))
    assert not snapshot["valid"]
    assert any("whole number" in x.lower() for x in snapshot["errors"])