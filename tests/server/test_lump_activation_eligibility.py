"""Read-only activation eligibility is consistent across History and words."""
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
    header = (0x1F << 27) | (7 << 10) | 2
    return struct.pack(">64I", header, *([0] * 63))


def _canonical_fixture(tmp_path, *, historical_record=False):
    raw = _binary()
    number = hashlib.sha256(b"History" + raw).hexdigest()[:8]
    active_filename = f"History.1.{number}.lump"
    archive_filename = (
        "History.legacy.lump"
        if historical_record else f"History.1.{number}_v1.lump")
    token = "aabbccdd"
    record_token = "11223344"
    (tmp_path / active_filename).write_bytes(raw)
    (tmp_path / archive_filename).write_bytes(raw)
    manifest = [{
        "token": token,
        "abstraction": "History",
        "filename": active_filename,
        "lump_version": 2,
    }]
    if historical_record:
        manifest.append({
            "token": record_token,
            "abstraction": "History",
            "filename": archive_filename,
            "lump_version": 1,
            "archived": True,
        })
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    digest = hashlib.sha256(raw).hexdigest()
    app_module._shared_write_approvals(str(tmp_path / "approvals.json"), {
        digest: {
            "binary_hash": digest,
            "abstraction": "History",
            "filename": active_filename,
            "dot_name": "History",
            "issue_n": 1,
        },
    })
    return {
        "token": token,
        "record_token": record_token,
        "active_filename": active_filename,
        "archive_filename": archive_filename,
    }


def _patch_roots(monkeypatch, root):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(root))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(root))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(root / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(root / "ns-state.json"))


def test_bootstrap_identity_failure_is_destination_not_damaged_bytes():
    report = app_module._activation_eligibility(
        validation_errors=[
            "bootstrap T-equals-GT validation failed: sealed row-zero GT "
            "0x4a000006 != expected GT 0x4a00000a",
        ],
        bootstrap_identity={
            "applies": True,
            "valid": False,
            "record_token": "4a000006",
            "row0_gt": "4a000006",
            "expected_gt": "4a00000a",
            "errors": ["sealed row-zero GT differs from expected GT"],
        },
        approved=True,
        binary_available=True,
        binary_valid=False,
        manifest_entry={"abstraction": "CapabilityTest"},
    )

    assert report["status"] == "blocked"
    by_code = {check["code"]: check for check in report["checks"]}
    assert by_code["binary_valid"]["status"] == "pass"
    assert by_code["bootstrap_identity_mismatch"]["status"] == "fail"
    assert "binary_invalid" not in {check["code"] for check in report["reasons"]}


def test_archived_manifest_history_and_words_report_transition_block(
        tmp_path, monkeypatch):
    fixture = _canonical_fixture(tmp_path, historical_record=True)
    _patch_roots(monkeypatch, tmp_path)

    with app_module.app.test_client() as client:
        history_response = client.get(
            f"/api/lumps/{fixture['token']}/history")
        words_response = client.get(
            f"/api/lump/{fixture['record_token']}/words",
            query_string={"archive_filename": fixture["archive_filename"]},
        )

    assert history_response.status_code == 200
    history_entry = next(
        row for row in history_response.get_json()["history"]
        if row.get("record_filename") == fixture["archive_filename"])
    words = words_response.get_json()
    assert words_response.status_code == 200, words
    assert words["historical_record"] is True
    assert history_entry["activation_eligibility"] == words["activation_eligibility"]
    report = words["activation_eligibility"]
    assert report["status"] == "blocked"
    assert any(
        reason["code"] == "historical_record_unsupported"
        and reason["category"] == "transition"
        for reason in report["reasons"])
    assert not any(
        reason["code"] == "binary_invalid" for reason in report["reasons"])


def test_standard_archive_and_live_words_have_expected_statuses(
        tmp_path, monkeypatch):
    fixture = _canonical_fixture(tmp_path, historical_record=False)
    _patch_roots(monkeypatch, tmp_path)

    with app_module.app.test_client() as client:
        live = client.get(f"/api/lump/{fixture['token']}/words")
        archive = client.get(
            f"/api/lump/{fixture['token']}/words",
            query_string={"archive_filename": fixture["archive_filename"]},
        )
        version_archive = client.get(
            f"/api/lumps/{fixture['token']}/words/1",
            query_string={"archive_filename": fixture["archive_filename"]},
        )
        history = client.get(
            f"/api/lumps/{fixture['token']}/history")

    assert live.status_code == 200
    assert live.get_json()["activation_eligibility"]["status"] == "current"
    assert archive.status_code == 200
    assert archive.get_json()["activation_eligibility"]["status"] == "eligible"
    assert version_archive.status_code == 200
    assert version_archive.get_json()["activation_eligibility"] == (
        archive.get_json()["activation_eligibility"])
    history_entry = next(
        row for row in history.get_json()["history"]
        if row.get("archive_filename") == fixture["archive_filename"])
    assert history_entry["activation_eligibility"] == (
        archive.get_json()["activation_eligibility"])