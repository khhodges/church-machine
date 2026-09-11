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


def test_archived_preview_returns_safe_raw_words_but_stays_invalid(
    tmp_path, monkeypatch
):
    token = "aabbccdd"
    current = _binary()
    invalid_archive = struct.pack(">64I", 0x12345678, *([0] * 63))
    (tmp_path / "Current.lump").write_bytes(current)
    (tmp_path / "Current_v1.lump").write_bytes(invalid_archive)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "token": token,
            "abstraction": "History",
            "filename": "Current.lump",
            "lump_version": 2,
        }
    ]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))

    with app_module.app.test_client() as client:
        response = client.get(f"/api/lumps/{token}/words/1")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["words"] == list(struct.unpack(">64I", invalid_archive))
    assert payload["binary_valid"] is False
    assert payload["validation_errors"]
    assert payload["approved"] is False


def test_historical_preview_uses_recorded_archive_filename(
    tmp_path, monkeypatch
):
    token = "aabbccdd"
    record_token = "11223344"
    current = _binary(cw=7, cc=2)
    historical = _binary(cw=11, cc=3)
    (tmp_path / "History.lump").write_bytes(current)
    (tmp_path / "CapabilityTest_legacy.lump").write_bytes(historical)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {
            "token": token,
            "abstraction": "History",
            "filename": "History.lump",
            "lump_version": 2,
        },
        {
            "token": record_token,
            "abstraction": "History",
            "filename": "CapabilityTest_legacy.lump",
            "lump_version": 1,
            "archived": True,
        },
    ]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))

    with app_module.app.test_client() as client:
        response = client.get(
            f"/api/lump/{record_token}/words",
            query_string={"archive_filename": "CapabilityTest_legacy.lump"},
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["historical_record"] is True
    assert payload["read_only"] is True
    assert payload["archive_filename"] == "CapabilityTest_legacy.lump"
    assert payload["cw"] == 11
    assert payload["cc"] == 3
    assert payload["words"] == list(struct.unpack(">64I", historical))