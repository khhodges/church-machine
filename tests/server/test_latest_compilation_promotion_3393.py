"""Focused contract regressions for Task #3393 promotion authority."""
from pathlib import Path
import hashlib
import struct
import json
import pytest


ROOT = Path(__file__).resolve().parents[2]


def test_latest_primary_endpoint_is_server_authoritative_and_immutable():
    source = (ROOT / "server" / "app.py").read_text()
    assert '@app.route("/api/lumps/latest-primary/<path:abstraction>")' in source
    assert "def _latest_primary_compilation(abstraction):" in source
    assert 'inspected.get("source")' in source
    assert '"immutable": True' in source
    assert '"intrinsic_source": True' in source


def test_browser_promotion_never_uses_editor_or_sidecar_source():
    source = (ROOT / "simulator" / "app-lumps.js").read_text()
    assert "/api/lumps/latest-primary/" in source
    assert "candidate.source" in source
    assert "_confirmLumpSavePlan" in source
    assert "_latestPromotionRequestId" in source
    assert "No data was changed" in source


def test_server_selection_requires_strictly_newer_valid_intrinsic_revision(
        tmp_path, monkeypatch):
    from server import app as server

    older = tmp_path / "old.lump"
    newer = tmp_path / "new.lump"
    older.write_bytes(struct.pack(">2I", 0xF8000401, 0))
    newer.write_bytes(struct.pack(">2I", 0xF8000401, 0))
    rows = [
        {"token": "00000001", "abstraction": "Demo", "lump_version": 2,
         "filename": "old.lump", "archived": True},
        {"token": "00000002", "abstraction": "Demo", "lump_version": 3,
         "filename": "new.lump"},
    ]
    monkeypatch.setattr(server, "LUMPS_DIR", str(tmp_path))
    (tmp_path / "manifest.json").write_text(json.dumps(rows))
    facts = {
        str(older): {"source": "ARCHIVE", "raw_bytes": older.read_bytes(),
                     "binary_hash": hashlib.sha256(older.read_bytes()).hexdigest()},
        str(newer): {"source": "AUTHORITATIVE", "raw_bytes": newer.read_bytes(),
                     "binary_hash": hashlib.sha256(newer.read_bytes()).hexdigest()},
    }
    monkeypatch.setattr(server, "_inspect_lump_binary",
                        lambda path: dict(facts[path]))
    monkeypatch.setattr(server, "_check_lump_canonical_integrity",
                        lambda *_args: True)
    monkeypatch.setattr(server, "_matching_lump_approval",
                        lambda *_args: {"binary_hash": facts[_args[1] if False else str(newer)]["binary_hash"]})
    row, inspected = server._promotion_candidate_for_view(rows[0])
    assert row["lump_version"] == 3
    assert inspected["source"] == "AUTHORITATIVE"
    assert server._promotion_candidate_for_view(rows[1]) is None


def test_server_issued_binding_rejects_toctou_candidate_change(tmp_path, monkeypatch):
    from server import app as server
    digest = "b" * 64
    row = {"token": "00000002", "abstraction": "Demo", "lump_version": 3}
    inspected = {"binary_hash": digest, "source": "AUTHORITATIVE"}
    binding = {
        "binding_id": "binding-3393", "abstraction": "Demo",
        "token": "00000002", "revision": 3, "binary_hash": digest,
        "ns_slot": 7, "namespace_sequence": 4,
        "bootstrap_snapshot": None,
    }
    monkeypatch.setattr(server, "_latest_primary_compilation",
                        lambda _name: (row, inspected))
    with server._LUMP_PROMOTION_BINDINGS_LOCK:
        server._LUMP_PROMOTION_BINDINGS["binding-3393"] = binding
    assert server._validate_promotion_binding(
        {"promotion_binding": binding}, digest) == binding
    monkeypatch.setattr(server, "_latest_primary_compilation",
                        lambda _name: (
                            {**row, "lump_version": 4},
                            inspected))
    with pytest.raises(ValueError, match="stale"):
        server._validate_promotion_binding({"promotion_binding": binding}, digest)


def test_bootstrap_promotion_requires_one_matching_namespace_binding(monkeypatch):
    from server import app as server

    row = {"token": "4a000007", "abstraction": "Demo", "lump_version": 3}
    inspected = {"binary_hash": "c" * 64}
    monkeypatch.setattr(server, "_bootstrap_snapshot_identity",
                        lambda *_args: {"valid": True, "slot": 7, "sequence": 4})
    monkeypatch.setattr(server.os.path, "isfile", lambda _path: False)

    with pytest.raises(ValueError, match="no unique Namespace binding"):
        server._promotion_binding_for_candidate(row, inspected)


def test_present_but_malformed_promotion_binding_fails_closed():
    from server import app as server

    with pytest.raises(ValueError, match="malformed"):
        server._validate_promotion_binding({"promotion_binding": {}}, "d" * 64)