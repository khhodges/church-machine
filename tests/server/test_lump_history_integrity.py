"""History validation derives exclusively from archive bytes and approvals."""
import hashlib
import json
import struct
import sys
import types
from pathlib import Path

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


@pytest.mark.parametrize("filename,token,version,digest", [
    ("CapabilityTest.2.225da6fc.lump", "4a00000a", 2,
     "7f36b8a385f82a7b1548deb37b7b25999492b58934b0905fadf06b83d3f659f0"),
    ("SelfTest.1.b5182a3d.lump", "3b466efc", 80,
     "e655c01275799838cbaca5e84c0899a93eb42b42119392b63829bda85d5feba4"),
    ("WukongCallHome.1.8965def2.lump", "4a000007", 1,
     "968706ae6010d58966a78ed35345608a8997c2192e86f8e1bfb8d4068983edbc"),
])
def test_restored_catalog_history_is_exact_and_read_only(
    tmp_path, monkeypatch, filename, token, version, digest
):
    """Real catalog archives remain inspectable, never implicit activation."""
    root = Path(__file__).resolve().parents[2] / "server" / "lumps"
    manifest = json.loads((root / "manifest.json").read_text())
    rows = [row for row in manifest if row.get("filename") == filename]
    assert len(rows) == 1
    archived = rows[0]
    assert archived["archived"] is True
    assert archived["token"] == token
    assert archived["lump_version"] == version
    assert not any(archived.get(key) for key in
                   ("ns_slot", "boot", "boot_resident", "resident"))
    raw = (root / filename).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == digest
    ns = json.loads((root / "ns-state.json").read_text())
    live = next(row for row in ns["abstractions"]
                if row["name"] == archived["abstraction"])
    assert live["filename"] != filename
    # Copy all inputs; neither requests nor server helpers may write live state.
    for path in root.iterdir():
        if path.is_file() and path.suffix in (".lump", ".json"):
            (tmp_path / path.name).write_bytes(path.read_bytes())
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    monkeypatch.setitem(app_module.LAZY_LUMPS, token, raw)
    # Read-side Namespace validation takes the normal coordination lock.
    (tmp_path / ".namespace-commit.lock").touch()
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    without_archive = [row for row in manifest if row is not archived]

    def primary_choice():
        try:
            row, _ = app_module._latest_primary_compilation(archived["abstraction"])
            return row["filename"]
        except LookupError as exc:
            return str(exc)

    selected = primary_choice()
    (tmp_path / "manifest.json").write_text(json.dumps(without_archive))
    assert primary_choice() == selected
    (tmp_path / "manifest.json").write_bytes(before["manifest.json"])
    with app_module.app.test_client() as client:
        history = client.get(f"/api/lumps/{live['token']}/history")
        assert history.status_code == 200
        record, = [row for row in history.get_json()["history"]
                   if row.get("archive_filename") == filename]
        assert record["binary_hash"] == digest
        assert record["current"] is False
        assert record["preview_enabled"] is True
        assert record["restore_enabled"] is False
        response = client.get(
            f"/api/lumps/{live['token']}/words/{version}",
            query_string={"archive_filename": filename})
        assert response.status_code == 200
        assert response.get_json()["words"] == list(
            struct.unpack(f">{len(raw) // 4}I", raw))
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before


def _binary(cw=7, cc=2):
    return struct.pack(">64I", (0x1F << 27) | (cw << 10) | cc, *([0] * 63))


def _approve(root, raw):
    digest = hashlib.sha256(raw).hexdigest()
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {digest: {"binary_hash": digest, "abstraction": "History"}},
    }))


def test_token_lookup_diagnoses_namespace_selected_archived_only(
    tmp_path, monkeypatch
):
    token = "aabbccdd"
    filename = "History_v4.lump"
    raw = _binary()
    (tmp_path / filename).write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "abstraction": "History", "filename": filename,
        "lump_version": 4, "archived": True,
    }]))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [
        {"name": "Boot.NS", "slot": 0, "boot": True},
        {"name": "History", "slot": 7, "token": token, "filename": filename},
    ]}))
    _approve(tmp_path, raw)
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))

    with app_module.app.test_client() as client:
        raw_missing = client.get(f"/api/lump/{token}")
        missing = client.get(f"/api/lump/{token}/words")
        archive = client.get(
            f"/api/lump/{token}/words",
            query_string={"archive_filename": filename},
        )

    assert raw_missing.status_code == 409
    assert raw_missing.get_json()["code"] == "namespace_selected_archived_lump"
    assert missing.status_code == 409
    assert missing.get_json() == {
        "error": f"Namespace slot 7 selects {filename}, but its only manifest record is archived.",
        "code": "namespace_selected_archived_lump",
        "archived_only": True,
        "token": token,
        "ns_slot": 7,
        "filename": filename,
        "version": 4,
        "recovery": {
            "action": "restore",
            "label": "Restore archived LUMP as a new active revision",
            "archive_filename": filename,
        },
        "committed": False,
    }
    assert archive.status_code == 200
    assert archive.get_json()["words"] == list(struct.unpack(">64I", raw))


def test_archived_only_recovery_creates_new_active_revision(
    tmp_path, monkeypatch
):
    token = "00000700"
    filename = "History_v4.lump"
    raw = _binary()
    (tmp_path / filename).write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "abstraction": "History", "filename": filename,
        "lump_version": 4, "archived": True,
    }]))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [
        {"name": "Boot.NS", "slot": 0, "boot": True},
        {"name": "History", "slot": 7, "seq": 0, "token": token,
         "filename": filename, "lump_version": 4, "resident": True},
    ]}))
    _approve(tmp_path, raw)
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "ns-state.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "absent-boot.bin"))

    candidate = {
        "binary": list(struct.unpack(">64I", raw)),
        "metadata": {
            "token": token, "abstraction": "History", "content_type": "code",
            "language": "assembly", "ns_slot": 7, "capabilities": [],
            "methods": [], "grants": ["E"], "issue_number": 1,
        },
    }
    with app_module.app.test_client() as client:
        plan_response = client.post("/api/lumps/save-plan", json=candidate)
        assert plan_response.status_code == 201, plan_response.get_data(as_text=True)
        plan = plan_response.get_json()
        intent_response = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"],
            "plan_id": plan["plan_id"], "confirmation": True,
            "approval": {"grants": ["E"], "capability_type": "inform"},
        })
        assert intent_response.status_code == 201
        candidate["binary"] = plan["final_binary"]
        candidate["metadata"].update({
            "save_plan_id": plan["plan_id"],
            "approval_intent": intent_response.get_json()["intent"],
        })
        saved_response = client.post("/api/lumps/save", json=candidate)

    assert saved_response.status_code == 200, saved_response.get_data(as_text=True)
    saved = saved_response.get_json()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    active, = [row for row in manifest if row.get("archived") is not True]
    assert active["filename"] == saved["filename"]
    assert active["lump_version"] > 4
    assert (tmp_path / filename).read_bytes() == raw
    archived, = [row for row in manifest if row.get("filename") == filename]
    assert archived["archived"] is True


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


def test_delete_historical_revision_removes_exact_archive_only(
    tmp_path, monkeypatch
):
    token = "aabbccdd"
    record_token = "11223344"
    current = _binary(cw=7, cc=2)
    historical = _binary(cw=11, cc=3)
    (tmp_path / "History.lump").write_bytes(current)
    (tmp_path / "CapabilityTest_legacy.lump").write_bytes(historical)
    manifest = [
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
    ]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))

    with app_module.app.test_client() as client:
        response = client.delete(
            f"/api/lumps/{token}/history/1",
            json={"archive_filename": "CapabilityTest_legacy.lump"},
        )

    assert response.status_code == 200
    assert response.get_json()["deleted"] == ["CapabilityTest_legacy.lump"]
    assert (tmp_path / "History.lump").read_bytes() == current
    assert not (tmp_path / "CapabilityTest_legacy.lump").exists()
    remaining = json.loads((tmp_path / "manifest.json").read_text())
    assert remaining == [manifest[0]]