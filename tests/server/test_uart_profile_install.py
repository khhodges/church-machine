"""Offline only: fake command queue, fake serial port, private installation proof."""
import base64
import hashlib
import json
from pathlib import Path
import struct
from threading import Lock
from types import SimpleNamespace

from flask import Flask
import pytest

from server import boot_image as boot
from server import uart_profile_install as loader
from server.namespace_ascending_image import FORMAT, generate_image

REVISION = "a" * 64
TARGET = dict(device_uid="offline-board", bridge_session="offline-session")
NOW = 1000


def native_image(instruction=0):
    words = [boot.pack_lump_header(0, 1, 1, 0), instruction] + [0] * 61
    words.append(boot.create_gt(0, 3, {"E": 1}, 1))
    lump = struct.pack(">64I", *words)
    state = dict(namespaceFormat=FORMAT, abstractions=[
        dict(slot=1, name="Boot.NS", seq=0, type="Inform", location=0),
        dict(slot=2, name="Boot.Thread", seq=0, type="Thread", allocationWords=256, stackWords=32),
        dict(slot=3, name="Entry", seq=0, type="Inform", filename="Entry.lump",
             binary_hash=hashlib.sha256(lump).hexdigest(), limit=1, boot=True),
    ])
    config = dict(step1=dict(totalNamespaceWords=16384, nsSlotsMax=64,
                            threadLumpWords=256, threadStackWords=32))
    raw, _ = generate_image(state, config, None, image_format=FORMAT,
                            artifacts={"Entry.lump": lump})
    return raw


@pytest.fixture
def setup(tmp_path, monkeypatch):
    raw = native_image()
    record = dict(schema="church.uart-profile-installation/v1", profile=loader.PROFILE,
                  bitstream_sha256=loader.BIT_SHA256, operator_verified_installation=True,
                  expires_at=NOW + 120, **TARGET)
    path = tmp_path / "installation.json"
    path.write_text(json.dumps(record))
    monkeypatch.setattr(loader, "INSTALLATION_PATH", path)
    monkeypatch.setattr(loader.time, "time", lambda: NOW)
    backend = SimpleNamespace(
        _approved_namespace_upload_source=lambda revision: (raw, {}) if revision == REVISION else
            (_ for _ in ()).throw(ValueError("Unapproved revision")),
        _wukong_control_auth=lambda: (True, None),
        _wukong_target_error=lambda data: (TARGET.copy(), None),
        _wukong_target_rejection=lambda error: ({"error": str(error)}, 409),
        _wukong_pending_cmd=None, _upload_in_flight=False, _wukong_cmd_id=0,
        _wukong_upload_ack={"old": True}, _wukong_run_unlocked=True,
        _wukong_runtime_identity={"old": True}, _wukong_active_lump_info={"old": True},
        _wukong_pending_entry_slot=None, _wukong_pending_thread_contexts=[],
        _wukong_cmd_delivery=dict(cmd="h", write_ok=True, board_halt_confirmed=True,
            board_halt_ts=NOW - 1, board_halt_session=TARGET["bridge_session"],
            target_device_uid=TARGET["device_uid"], target_session_id=TARGET["bridge_session"]),
    )
    for key in ("_wukong_command_lock", "_upload_in_flight_lock",
                "_wukong_hw_entry_lock", "_wukong_upload_ack_lock"):
        setattr(backend, key, Lock())
    app = Flask(__name__)
    loader.register(app, backend)
    return app.test_client(), backend, raw, record, path


def payload(raw):
    return dict(profile=loader.PROFILE, namespace_revision_id=REVISION,
                artifact_sha256=hashlib.sha256(raw).hexdigest(),
                confirm_runtime_memory_replacement=True,
                target_device_uid=TARGET["device_uid"], target_session_id=TARGET["bridge_session"])


def test_offline_prepare_never_contacts_target_or_requires_installation(setup):
    client, backend, raw, _, path = setup
    path.unlink()
    backend._wukong_target_error = lambda _: pytest.fail("Offline prepare contacted target")
    response = client.post("/api/namespace-image/uart-prepare", json=payload(raw))
    assert response.status_code == 200
    assert response.json["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert response.json["thread_contexts"] == [dict(number=1, slot=2, base_word=256)]
    assert response.json["queued"] is False
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight
    assert backend._wukong_upload_ack == {"old": True}


def test_exact_bytes_queue_without_projection_and_no_automatic_recovery(setup):
    client, backend, raw, _, _ = setup
    response = client.post("/api/namespace-image/uart-install", json=payload(raw))
    assert response.status_code == 200 and response.json["queued"]
    command = backend._wukong_pending_cmd
    assert base64.b64decode(command["data"]) == raw
    assert command["cmd"] == "u" and command["reboot"]
    assert command["target_session_id"] == TARGET["bridge_session"]
    assert command["artifact_sha256"] == hashlib.sha256(raw).hexdigest()
    assert backend._wukong_pending_entry_slot == 3
    assert not backend._wukong_run_unlocked and backend._wukong_runtime_identity is None
    assert backend._wukong_active_lump_info == {}
    assert not response.json["installed_bytes_verified"]
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 409
    assert backend._wukong_pending_cmd is command


@pytest.mark.parametrize("field,value", [
    ("bitstream_sha256", "b" * 64), ("profile", "legacy"),
    ("device_uid", "other"), ("bridge_session", "old"),
    ("operator_verified_installation", False), ("expires_at", NOW),
    ("expires_at", NOW + 301), ("expires_at", True), ("expires_at", float("nan")),
])
def test_installation_proof_is_exact_and_session_bound(setup, field, value):
    client, backend, raw, record, path = setup
    record[field] = value
    path.write_text(json.dumps(record))
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


@pytest.mark.parametrize("change", [
    dict(confirm_runtime_memory_replacement=False), dict(artifact_sha256="b" * 64),
    dict(namespace_revision_id="b" * 64), dict(profile="legacy"),
    dict(installation={}), dict(source_image_base64="AA=="),
])
def test_request_cannot_supply_authority_or_change_reviewed_bytes(setup, change):
    client, backend, raw, _, _ = setup
    assert client.post("/api/namespace-image/uart-install",
                       json={**payload(raw), **change}).status_code == 409
    assert backend._wukong_pending_cmd is None and not backend._upload_in_flight


@pytest.mark.parametrize("field,value", [
    ("board_halt_confirmed", False), ("board_halt_ts", NOW - 11),
    ("board_halt_session", "old"), ("cmd", "f"), ("write_ok", False),
])
def test_fault_hold_or_stale_stop_cannot_be_treated_as_upload_permission(setup, field, value):
    client, backend, raw, _, _ = setup
    backend._wukong_cmd_delivery[field] = value
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 409
    assert backend._wukong_pending_cmd is None


def test_auth_and_target_failure_preserve_queue(setup):
    client, backend, raw, _, _ = setup
    backend._wukong_control_auth = lambda: (False, ({"error": "Unauthorized"}, 401))
    assert client.post("/api/namespace-image/uart-prepare", json=payload(raw)).status_code == 401
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 401
    backend._wukong_control_auth = lambda: (True, None)
    backend._wukong_target_error = lambda _: (None, "Session changed")
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 409
    assert not backend._upload_in_flight


@pytest.mark.parametrize("busy", ["command", "upload"])
def test_busy_state_preserved(setup, busy):
    client, backend, raw, _, _ = setup
    if busy == "command":
        backend._wukong_pending_cmd = {"cmd": "q"}
    else:
        backend._upload_in_flight = True
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 409
    assert backend._wukong_cmd_id == 0 and backend._wukong_upload_ack == {"old": True}


def test_changed_program_has_new_digest_without_a_new_fpga_profile():
    a, b = native_image(), native_image(0xBF040001)
    pa, pb = loader.prepare_image(a), loader.prepare_image(b)
    assert pa["artifact_sha256"] != pb["artifact_sha256"]
    assert pa["required_bitstream_sha256"] == pb["required_bitstream_sha256"] == loader.BIT_SHA256
    assert pa["profile"] == pb["profile"]


@pytest.mark.parametrize("offset,value", [(0, 0), (1, 0x4E534832), (6, 0), (255, 3)])
def test_legacy_corrupt_and_scheduler_alias_images_rejected(offset, value):
    raw = bytearray(native_image())
    struct.pack_into("<I", raw, offset * 4, value)
    with pytest.raises(ValueError):
        loader.prepare_image(raw)


def test_wrong_capacity_rejected():
    with pytest.raises(ValueError, match="64 KiB"):
        loader.prepare_image(bytes(32768))


def test_bridge_produces_exact_big_endian_uart_words(setup, monkeypatch):
    from hardware import wukong_bridge as bridge
    client, backend, raw, _, _ = setup
    assert client.post("/api/namespace-image/uart-install", json=payload(raw)).status_code == 200
    writes, replies = [], []

    class Serial:
        in_waiting = 0
        def write(self, data):
            writes.append(data)
        def flush(self):
            pass
        def read(self, count):
            return b"\x06"

    monkeypatch.setattr(bridge.requests, "post", lambda *a, **k: replies.append(k))
    bridge._handle_upload(backend._wukong_pending_cmd, Serial(), "https://offline.invalid",
                          True, TARGET["bridge_session"], TARGET["device_uid"])
    assert writes[0][:5] == b"u" + struct.pack(">I", 65536)
    assert struct.unpack(">16384I", writes[0][5:]) == struct.unpack("<16384I", raw)
    assert writes[1:] == [b"f"]  # explicit install reboot, never recovery authorization g
    assert replies[-1]["json"]["ok"]
