"""Explicit, exact-image trial loader; no inference from legacy build versions."""
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import time

from flask import jsonify, request

ROOT = Path(__file__).resolve().parents[1]
PROFILE = "new-layout-guarded-relative-nia-v1"
IMAGE_HASH = "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451"
IMAGE_PATH = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin"
INSTALLATION_PATH = ROOT / "build/guarded-runtime-installation.json"


def is_ascending(raw):
    if len(raw) < 16:
        return False
    header = struct.unpack_from("<I", raw)[0]
    # Slot zero carries a nonzero occupied-count word as well as the header.
    # Historical Header V2 instead carries its explicit NSH2 marker at word 1.
    return header >> 27 == 31 and (header >> 8) & 3 == 1 and raw[4:8] == bytes(4)


def source_digest():
    """Conservative source-tree pin, not a substitute for a build/install receipt."""
    digest = hashlib.sha256()
    for path in sorted((ROOT / "hardware").rglob("*.py")):
        digest.update(path.relative_to(ROOT).as_posix().encode() + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def prepare(target, now):
    # This file is trusted server/operator evidence, never HTTP request data.
    try:
        record = json.loads(INSTALLATION_PATH.read_text())
    except (OSError, ValueError) as error:
        raise ValueError("No verified guarded-runtime installation approval exists for this board/session") from error
    if not isinstance(record, dict):
        raise ValueError("Invalid installation approval")
    if (record.get("schema") != "church.guarded-runtime-installation/v1"
            or record.get("operator_verified_installation") is not True
            or record.get("profile") != PROFILE
            or record.get("device_uid") != target["device_uid"]
            or record.get("bridge_session") != target["bridge_session"]
            or record.get("guard18") != 23971
            or record.get("image_sha256") != IMAGE_HASH
            or not re.fullmatch(r"[0-9a-f]{64}", str(record.get("bitstream_sha256", "")))
            or record.get("hardware_tree_sha256") != source_digest()):
        raise ValueError("Installation approval does not establish this exact guarded profile on the selected board/session")
    expires = record.get("expires_at")
    if type(expires) not in (int, float) or not now < expires <= now + 300:
        raise ValueError("Installation approval is expired or outside its five-minute admission window")
    raw = IMAGE_PATH.read_bytes()
    if len(raw) != 65536 or hashlib.sha256(raw).hexdigest() != IMAGE_HASH:
        raise ValueError("Retained guarded image identity changed; nothing was queued")
    return raw


def halted(delivery, target, now):
    stamp = delivery.get("board_halt_ts")
    return (delivery.get("cmd") == "h"
            and delivery.get("write_ok") is True
            and delivery.get("board_halt_confirmed") is True
            and delivery.get("target_device_uid") == target["device_uid"]
            and delivery.get("target_session_id") == target["bridge_session"]
            and delivery.get("board_halt_session") == target["bridge_session"]
            and type(stamp) in (int, float) and 0 <= now - stamp <= 10)


def register(app, backend):
    @app.route("/hardware/wukong/guarded-reload", methods=["POST"])
    def guarded_reload():
        ok, error = backend._wukong_control_auth()
        if not ok:
            return error
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or data.get("profile") != PROFILE:
            return jsonify(ok=False, error="Explicit guarded runtime profile required"), 400
        action = data.get("action", "inspect")
        if action not in ("inspect", "send"):
            return jsonify(ok=False, error="Action must be inspect or send"), 400
        target, error = backend._wukong_target_error(data)
        if error:
            return backend._wukong_target_rejection(error)
        try:
            raw = prepare(target, time.time())
        except (OSError, ValueError) as error:
            return jsonify(ok=False, queued=False, error=str(error),
                           decision="guarded_installation_unproven"), 409
        if action == "inspect":
            return jsonify(ok=True, queued=False, profile=PROFILE, image_sha256=IMAGE_HASH,
                           bytes=len(raw), requires_fresh_confirmed_halt=True,
                           installed_bytes_verified=False)
        if data.get("confirm_runtime_memory_replacement") is not True or data.get("image_sha256") != IMAGE_HASH:
            return jsonify(ok=False, queued=False, error="Explicit confirmation of exact image and runtime-memory replacement required"), 409
        identity = PROFILE + ":" + IMAGE_HASH
        # Same upload lease and delivery record as the existing bridge loader.
        # Never overwrite any pending command or begin from an unconfirmed stop.
        with backend._wukong_command_lock:
            target, error = backend._wukong_target_error(data)
            if error:
                return backend._wukong_target_rejection(error)
            if backend._wukong_pending_cmd or not halted(backend._wukong_cmd_delivery or {}, target, time.time()):
                return jsonify(ok=False, queued=False, error="A fresh target-confirmed STOP and an empty command queue are required"), 409
            # Recheck the operator approval at the actual admission boundary.
            try:
                raw = prepare(target, time.time())
            except (OSError, ValueError) as error:
                return jsonify(ok=False, queued=False, error=str(error)), 409
            encoded = base64.b64encode(raw).decode("ascii")
            with backend._upload_in_flight_lock:
                if backend._upload_in_flight:
                    return jsonify(ok=False, queued=False, error="Upload already in progress"), 409
                backend._upload_in_flight = True
            with backend._wukong_hw_entry_lock:
                backend._wukong_pending_entry_slot = 20
                backend._wukong_pending_thread_contexts = [
                    dict(number=n, slot=s, base_word=b)
                    for n, s, b in ((1, 2, 256), (2, 11, 2304), (3, 12, 2560))]
            with backend._wukong_upload_ack_lock:
                backend._wukong_upload_ack = {}
            backend._wukong_cmd_id += 1
            backend._wukong_run_unlocked = False
            backend._wukong_runtime_identity = {}
            # Never label this separate trial using an older live image's map.
            backend._wukong_active_lump_info = {}
            command_id = backend._wukong_cmd_id
            backend._wukong_pending_cmd = dict(
                cmd="u", data=encoded, reboot=True, id=command_id, **target,
                target_device_uid=target["device_uid"],
                target_session_id=target["bridge_session"],
                artifact_sha256=IMAGE_HASH, artifact_size=len(raw), artifact_identity=identity)
            backend._wukong_cmd_delivery = dict(
                id=command_id, cmd="u", queued_ts=time.time(), consumed_ts=None,
                write_ok=None, write_error="", write_ts=None,
                target_device_uid=target["device_uid"], target_session_id=target["bridge_session"],
                artifact_sha256=IMAGE_HASH, artifact_size=len(raw), artifact_identity=identity)
        return jsonify(ok=True, queued=True, id=command_id, artifact_sha256=IMAGE_HASH,
                       artifact_identity=identity, bytes=len(raw), profile=PROFILE,
                       installed_bytes_verified=False)
