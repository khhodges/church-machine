"""Archive history is binary+approval based; archive sidecars do not exist."""
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


def _binary(marker):
    words = [(0x1F << 27)] + [marker] + [0] * 62
    return struct.pack(">64I", *words)


def _approval(raw):
    digest = hashlib.sha256(raw).hexdigest()
    return digest, {"binary_hash": digest, "abstraction": "Archive"}


def test_archive_snapshot_is_inspectable_without_exact_approval(tmp_path):
    raw = _binary(1)
    path = tmp_path / "Archive_v1.lump"
    path.write_bytes(raw)
    snapshot = app_module._validate_lump_snapshot(str(path))
    assert snapshot["valid"] is True
    assert snapshot["approved"] is False
    assert snapshot["trusted"] is False
    assert snapshot["errors"] == []


def test_archive_snapshot_ignores_json_sidecar_and_uses_approval(tmp_path):
    raw = _binary(2)
    digest, approval = _approval(raw)
    path = tmp_path / "Archive_v1.lump"
    path.write_bytes(raw)
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {digest: approval}
    }))
    (tmp_path / "Archive_v1.json").write_text(json.dumps({"author": "attacker"}))
    snapshot = app_module._validate_lump_snapshot(str(path))
    assert snapshot["valid"] is True
    assert snapshot["approval"]["abstraction"] == "Archive"
    assert "sidecar" not in snapshot