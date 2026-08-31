import hashlib
import json
import struct

import server.app as app_module


def _binary(*, words=64, cw=7, cc=2):
    n_minus_6 = words.bit_length() - 7
    header = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc
    values = [header] + [0] * (words - 1)
    return struct.pack(f">{words}I", *values)


def _write_snapshot(root, stem, *, version, binary, compiled_at=1234):
    (root / f"{stem}.lump").write_bytes(binary)
    sidecar = {
        "token": "abcdef12",
        "abstraction": "HistoryIntegrity",
        "filename": f"{stem}.lump",
        "sidecar_file": f"{stem}.json",
        "lump_version": version,
        "archived_version": version,
        "compiled_at": compiled_at,
        "cw": (struct.unpack(">I", binary[:4])[0] >> 10) & 0x1FFF,
        "cc": struct.unpack(">I", binary[:4])[0] & 0xFF,
        "lump_size": len(binary) // 4,
        "binary_hash": hashlib.sha256(binary).hexdigest(),
        "mtbf": {"status": "unknown", "total_runs": 0, "consecutive_clean": 0},
    }
    (root / f"{stem}.json").write_text(json.dumps(sidecar))
    return sidecar


def test_history_enriches_current_from_validated_canonical_binary(tmp_path, monkeypatch):
    current = _binary(words=512, cw=21, cc=5)
    current_sc = _write_snapshot(
        tmp_path, "HistoryIntegrity.1.current", version=10, binary=current
    )
    _write_snapshot(
        tmp_path, "HistoryIntegrity_v9", version=9,
        binary=_binary(words=128, cw=19, cc=4),
    )
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "abcdef12",
        "abstraction": "HistoryIntegrity",
        "filename": current_sc["filename"],
        "sidecar_file": current_sc["sidecar_file"],
        "lump_version": 10,
    }]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    response = app_module.app.test_client().get("/api/lumps/abcdef12/history")

    assert response.status_code == 200
    body = response.get_json()
    current_row = body["history"][0]
    assert current_row == {
        **current_row,
        "version": 10,
        "current": True,
        "cw": 21,
        "cc": 5,
        "lump_size": 512,
        "binary_valid": True,
        "preview_enabled": False,
        "restore_enabled": False,
    }
    assert body["missing_versions"] == []


def test_history_disables_mismatched_archive_and_reports_missing_versions(
        tmp_path, monkeypatch):
    current = _binary(words=64, cw=7, cc=2)
    current_sc = _write_snapshot(
        tmp_path, "HistoryIntegrity.1.current", version=4, binary=current
    )
    bad_sc = _write_snapshot(
        tmp_path, "HistoryIntegrity_v2", version=2,
        binary=_binary(words=128, cw=9, cc=3),
        compiled_at=None,
    )
    bad_sc["lump_size"] = 64
    (tmp_path / "HistoryIntegrity_v2.json").write_text(json.dumps(bad_sc))
    (tmp_path / "HistoryIntegrity_v1.json").write_text(json.dumps({
        "abstraction": "HistoryIntegrity",
        "archived_version": 1,
        "compiled_at": None,
    }))
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "abcdef12",
        "abstraction": "HistoryIntegrity",
        "filename": current_sc["filename"],
        "sidecar_file": current_sc["sidecar_file"],
        "lump_version": 4,
    }]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    client = app_module.app.test_client()

    body = client.get("/api/lumps/abcdef12/history").get_json()
    by_version = {row["version"]: row for row in body["history"]}
    assert body["missing_versions"] == [3]
    assert by_version[1]["metadata_only"] is True
    assert by_version[1]["preview_enabled"] is False
    assert by_version[2]["lump_size"] == 128
    assert by_version[2]["preview_enabled"] is False
    assert "sidecar lump_size declares 64 but binary has 128" in \
        by_version[2]["validation_errors"]

    rejected = client.get("/api/lumps/abcdef12/words/2")
    assert rejected.status_code == 409
    assert "failed integrity validation" in rejected.get_json()["error"]


def test_history_rejects_non_object_current_sidecar_without_crashing(
        tmp_path, monkeypatch):
    current = _binary(words=64, cw=7, cc=2)
    (tmp_path / "HistoryIntegrity.1.current.lump").write_bytes(current)
    (tmp_path / "HistoryIntegrity.1.current.json").write_text("[]")
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "abcdef12",
        "abstraction": "HistoryIntegrity",
        "filename": "HistoryIntegrity.1.current.lump",
        "sidecar_file": "HistoryIntegrity.1.current.json",
        "lump_version": 4,
    }]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    response = app_module.app.test_client().get("/api/lumps/abcdef12/history")

    assert response.status_code == 200
    current_row = response.get_json()["history"][0]
    assert current_row["version"] == 4
    assert current_row["current"] is True
    assert current_row["binary_valid"] is False
    assert "sidecar root is not a JSON object" in \
        current_row["validation_errors"]


def test_archive_words_rejects_trailing_bytes_and_missing_sidecar(
        tmp_path, monkeypatch):
    current_sc = _write_snapshot(
        tmp_path, "HistoryIntegrity.1.current", version=4,
        binary=_binary(words=64, cw=7, cc=2),
    )
    trailing = _binary(words=64, cw=8, cc=2) + b"\xff"
    (tmp_path / "HistoryIntegrity_v3.lump").write_bytes(trailing)
    (tmp_path / "HistoryIntegrity_v3.json").write_text(json.dumps({
        "abstraction": "HistoryIntegrity",
        "archived_version": 3,
        "cw": 8,
        "cc": 2,
        "lump_size": 64,
        "binary_hash": hashlib.sha256(trailing).hexdigest(),
    }))
    (tmp_path / "HistoryIntegrity_v2.lump").write_bytes(
        _binary(words=64, cw=6, cc=2)
    )
    malformed_sidecar_binary = _binary(words=64, cw=5, cc=2)
    (tmp_path / "HistoryIntegrity_v1.lump").write_bytes(malformed_sidecar_binary)
    (tmp_path / "HistoryIntegrity_v1.json").write_text("[]")
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "abcdef12",
        "abstraction": "HistoryIntegrity",
        "filename": current_sc["filename"],
        "sidecar_file": current_sc["sidecar_file"],
        "lump_version": 4,
    }]))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    client = app_module.app.test_client()

    history = client.get("/api/lumps/abcdef12/history").get_json()["history"]
    by_version = {row["version"]: row for row in history}
    assert by_version[3]["preview_enabled"] is False
    assert "binary length is not a non-empty whole number of words" in \
        by_version[3]["validation_errors"]
    assert by_version[2]["preview_enabled"] is False
    assert "sidecar is missing" in by_version[2]["validation_errors"]
    assert by_version[1]["preview_enabled"] is False
    assert "sidecar root is not a JSON object" in \
        by_version[1]["validation_errors"]

    trailing_response = client.get("/api/lumps/abcdef12/words/3")
    assert trailing_response.status_code == 409
    assert "whole number of words" in trailing_response.get_json()["error"]

    missing_sidecar_response = client.get("/api/lumps/abcdef12/words/2")
    assert missing_sidecar_response.status_code == 409
    assert "sidecar is missing" in missing_sidecar_response.get_json()["error"]

    malformed_sidecar_response = client.get("/api/lumps/abcdef12/words/1")
    assert malformed_sidecar_response.status_code == 409
    assert "sidecar root is not a JSON object" in \
        malformed_sidecar_response.get_json()["error"]