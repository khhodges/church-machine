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


def _binary():
    return struct.pack(">64I", (0x1F << 27), *([0] * 63))


def test_portable_catalog_trust_is_exact_hash_bound(tmp_path):
    raw = _binary()
    digest = hashlib.sha256(raw).hexdigest()
    (tmp_path / "11223344.lump").write_bytes(raw)
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {
            digest: {
                "binary_hash": digest,
                "dot_name": "Floating.Tool",
                "issue_n": 4,
                "portable_binding": {"owner": "Floating.Tool#4"},
            },
        },
    }))

    approval = app_module._matching_lump_approval(str(tmp_path), digest)
    assert approval["binary_hash"] == digest
    assert approval["portable_binding"]["owner"] == "Floating.Tool#4"


def test_portable_catalog_rejects_unapproved_bytes(tmp_path):
    raw = _binary()
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {},
    }))
    assert app_module._matching_lump_approval(
        str(tmp_path), hashlib.sha256(raw).hexdigest()) is None


def test_catalog_ignores_manifest_fact_and_placement_lies(tmp_path, monkeypatch):
    raw = _binary()
    digest = hashlib.sha256(raw).hexdigest()
    (tmp_path / "11223344.lump").write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "11223344", "filename": "11223344.lump",
        "abstraction": "Manifest.Lie", "lump_size": 999, "cw": 999, "cc": 99,
        "methods": [], "binary_hash": "0" * 64, "identity_hash": "1" * 64,
        "grants": ["L", "S"], "ns_slot": 31, "ns_slot_policy": "static",
    }]))
    identity = hashlib.sha256(b"Approved.Name#2").hexdigest()
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {
            digest: {"binary_hash": digest, "dot_name": "Approved.Name",
                     "issue_n": 2, "identity_hash": identity, "grants": ["E"]},
        },
    }))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [{
        "name": "Approved.Name", "slot": 12, "token": "11223344",
    }]}))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH",
                        str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    monkeypatch.setattr(app_module, "BASE_NAMED_NS_COUNT", 20)

    row = app_module._load_lump_catalog()[0]
    assert row["nsSlot"] == 12
    assert row["nsSlotPolicy"] == "static"
    assert row["lumpSize"] == 64 and row["cw"] == 0 and row["cc"] == 0
    assert row["binaryHash"] == digest
    assert row["identityHash"] == identity
    assert row["grants"] == ["E"]
    assert row["abstraction"] == "Approved.Name"