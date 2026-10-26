import base64
import json
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

from flask import Flask
import pytest
from server import guarded_runtime_reload as loader

NOW = 1000
TARGET = dict(device_uid="fixture-board", bridge_session="fixture-session")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    receipt = dict(schema="church.guarded-runtime-installation/v1",
                   operator_verified_installation=True, profile=loader.PROFILE,
                   **TARGET, guard18=23971, image_sha256=loader.IMAGE_HASH,
                   bitstream_sha256="a" * 64, hardware_tree_sha256=loader.source_digest(),
                   expires_at=NOW + 120)
    path = tmp_path / "installation.json"
    path.write_text(json.dumps(receipt))
    monkeypatch.setattr(loader, "INSTALLATION_PATH", path)
    monkeypatch.setattr(loader.time, "time", lambda: NOW)
    backend = SimpleNamespace(
        _wukong_control_auth=lambda: (True, None),
        _wukong_target_error=lambda data: (TARGET.copy(), None),
        _wukong_target_rejection=lambda err: ({"error": err[1]}, 409),
        _wukong_pending_cmd=None, _upload_in_flight=False, _wukong_cmd_id=0,
        _wukong_pending_entry_slot=None, _wukong_pending_thread_contexts=[],
        _wukong_upload_ack={"ok": True}, _wukong_run_unlocked=True,
        _wukong_runtime_identity={"old": True},
        _wukong_cmd_delivery=dict(
            cmd="h", write_ok=True, board_halt_confirmed=True,
            board_halt_ts=NOW - 1, board_halt_session=TARGET["bridge_session"],
            target_device_uid=TARGET["device_uid"], target_session_id=TARGET["bridge_session"]))
    for name in ("_wukong_command_lock", "_upload_in_flight_lock",
                 "_wukong_hw_entry_lock", "_wukong_upload_ack_lock"):
        setattr(backend, name, Lock())
    app = Flask(__name__)
    loader.register(app, backend)
    return app.test_client(), backend, receipt, path


def payload(**changes):
    return dict(profile=loader.PROFILE, action="send", image_sha256=loader.IMAGE_HASH,
                confirm_runtime_memory_replacement=True, **changes)


def post(client, data=None):
    return client.post("/hardware/wukong/guarded-reload", json=data or payload())


def test_exact_send_reuses_bridge_framing_and_correlation(setup):
    client, backend, _, _ = setup
    response = post(client)
    assert response.status_code == 200 and response.json["queued"]
    command = backend._wukong_pending_cmd
    assert base64.b64decode(command["data"]) == loader.IMAGE_PATH.read_bytes()
    assert command["reboot"] and command["artifact_size"] == 65536
    assert command["artifact_sha256"] == loader.IMAGE_HASH
    assert command["target_device_uid"] == TARGET["device_uid"]
    assert command["bridge_session"] == TARGET["bridge_session"]
    from hardware.wukong_bridge import _command_target_matches
    assert command["target_session_id"] == TARGET["bridge_session"]
    assert _command_target_matches(command, TARGET["device_uid"], TARGET["bridge_session"])
    assert not _command_target_matches(command, TARGET["device_uid"], "other-session")
    assert backend._upload_in_flight and not backend._wukong_run_unlocked
    assert backend._wukong_pending_entry_slot == 20
    assert backend._wukong_upload_ack == {}
    # Never overwrite a queued transfer with a second request.
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd == command


def test_inspection_cannot_queue(setup):
    client, backend, _, _ = setup
    response = post(client, {"profile": loader.PROFILE})
    assert response.status_code == 200 and response.json["queued"] is False
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


@pytest.mark.parametrize("field,value", [
    ("profile", "legacy"), ("guard18", 0), ("device_uid", "other"),
    ("bridge_session", "old"), ("image_sha256", "b"*64),
    ("operator_verified_installation", False), ("bitstream_sha256", ""),
    ("hardware_tree_sha256", "b"*64), ("expires_at", NOW),
    ("expires_at", NOW+301), ("expires_at", True),
])
def test_unproven_installation_rejected_without_side_effects(setup, field, value):
    client, backend, record, path = setup
    record[field] = value
    path.write_text(json.dumps(record))
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


def test_browser_claim_cannot_create_installation_approval(setup):
    client, backend, record, path = setup
    path.unlink()
    assert post(client, payload(installation=record)).status_code == 409
    assert not path.exists() and backend._wukong_pending_cmd is None


@pytest.mark.parametrize("field,value", [
    ("write_ok", False), ("board_halt_confirmed", False),
    ("board_halt_ts", NOW-11), ("board_halt_ts", NOW+1),
    ("board_halt_session", "old"), ("target_device_uid", "other")])
def test_send_requires_fresh_confirmed_stop(setup, field, value):
    client, backend, _, _ = setup
    backend._wukong_cmd_delivery[field] = value
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


def test_unknown_target_and_unauthorized_requests_cannot_queue(setup):
    client, backend, _, _ = setup
    backend._wukong_target_error = lambda data: (None, ("unidentified_target", "Unknown board"))
    assert post(client).status_code == 409
    backend._wukong_control_auth = lambda: (False, ({"error": "Unauthorized"}, 401))
    assert post(client).status_code == 401
    assert backend._wukong_pending_cmd is None


def test_payload_change_and_missing_confirmation_rejected(setup, monkeypatch, tmp_path):
    client, backend, _, _ = setup
    data = payload()
    data["confirm_runtime_memory_replacement"] = False
    assert post(client, data).status_code == 409
    corrupt = tmp_path / "corrupt.bin"
    corrupt.write_bytes(bytes(65536))
    monkeypatch.setattr(loader, "IMAGE_PATH", corrupt)
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


def test_target_session_rechecked_at_admission(setup):
    client, backend, _, _ = setup
    backend._wukong_target_error = Mock(side_effect=[
        (TARGET.copy(), None), (None, ("session_mismatch", "Reconnected"))])
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


def test_explicit_profile_detected_without_misclassifying_legacy_payload():
    assert loader.is_ascending(loader.IMAGE_PATH.read_bytes())
    assert not loader.is_ascending(bytes(65536))


def test_busy_queue_preserved(setup):
    client, backend, _, _ = setup
    pending = {"cmd": "q", "id": 99}
    backend._wukong_pending_cmd = pending
    assert post(client).status_code == 409
    assert backend._wukong_pending_cmd is pending
    assert not backend._upload_in_flight


def test_existing_upload_preserved(setup):
    client, backend, _, _ = setup
    backend._upload_in_flight = True
    assert post(client).status_code == 409
    assert backend._upload_in_flight and backend._wukong_pending_cmd is None
