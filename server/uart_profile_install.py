"""Native UART installation for the exact Amoeba retry FPGA profile.

Preparation is offline. Installation additionally needs trusted operator evidence
and a fresh physical stop; neither a build number nor browser data grants these.
No legacy projection, address conversion, compiler substitution, or fault release.
"""
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import time

from flask import jsonify, request
from server.guarded_runtime_reload import halted
from server.namespace_ascending_image import FORMAT, validate_image

PROFILE = "amoeba-retry-25mhz-uart-v1"
BIT_SHA256 = "a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e"
INSTALLATION_PATH = Path(__file__).resolve().parents[1] / "build/uart-profile-installation.json"


def prepare_image(raw):
    """Validate retained native bytes without changing a single word."""
    if len(raw) != 65536:
        raise ValueError("This FPGA profile requires an exact 64 KiB native Namespace image.")
    evidence = validate_image(raw, image_format=FORMAT)
    words = struct.unpack("<16384I", raw)
    # The tested BIT elaborates expected_boot_guard=0 (self and entry versions).
    if (words[5] >> 21 & 511) or (words[9] >> 21 & 511):
        raise ValueError("This FPGA requires version zero for Namespace self and entry Thread.")
    # Legacy M6 scheduling reads word 255 during upload and assumes Thread 1.
    # Native programs schedule through their own CHANGE instructions; never
    # enable that incompatible legacy scheduler as an upload side effect.
    if words[255] != 0:
        raise ValueError("Native UART images must leave word 255 zero; legacy M6 scheduling is incompatible.")
    slots = [2] + [row["slot"] for row in evidence["threadRows"]]
    digest = hashlib.sha256(raw).hexdigest()
    return dict(
        ok=True, queued=False, profile=PROFILE, required_bitstream_sha256=BIT_SHA256,
        image_format=FORMAT, artifact_sha256=digest, size=len(raw),
        artifact_identity=PROFILE + ":" + digest, entry_slot=evidence["bootTarget"]["slot"],
        thread_contexts=[dict(number=n + 1, slot=slot, base_word=words[slot * 4])
                         for n, slot in enumerate(slots)],
        installed_bytes_verified=False,
        requires_fresh_confirmed_halt=True,
        requires_operator_verified_installation=True,
    )


def verify_installation(target, now):
    try:
        record = json.loads(INSTALLATION_PATH.read_text())
    except (OSError, ValueError) as error:
        raise ValueError("No operator-verified installation record for this UART profile. Nothing was sent.") from error
    if not isinstance(record, dict) or any((
        record.get("schema") != "church.uart-profile-installation/v1",
        record.get("profile") != PROFILE,
        record.get("operator_verified_installation") is not True,
        record.get("bitstream_sha256") != BIT_SHA256,
        record.get("device_uid") != target["device_uid"],
        record.get("bridge_session") != target["bridge_session"],
    )):
        raise ValueError("Installation evidence does not match this exact BIT and board session. Nothing was sent.")
    expires = record.get("expires_at")
    if (type(expires) not in (int, float) or not math.isfinite(expires)
            or not now < expires <= now + 300):
        raise ValueError("Installation evidence needs a fresh five-minute operator approval. Nothing was sent.")


def register(app, backend):
    def selected(data):
        if not isinstance(data, dict) or data.get("profile") != PROFILE:
            raise ValueError("Select the explicit Amoeba retry UART profile.")
        revision = data.get("namespace_revision_id")
        if not isinstance(revision, str) or not re.fullmatch("[0-9a-f]{64}", revision):
            raise ValueError("Select an exact approved hardware Namespace revision.")
        if any(key in data for key in ("data", "source_image_base64", "installation", "path")):
            raise ValueError("Browser-supplied image bytes or installation evidence are not accepted.")
        raw, _config = backend._approved_namespace_upload_source(revision)
        prepared = prepare_image(raw)
        prepared["namespace_revision_id"] = revision
        return raw, prepared

    @app.route("/api/namespace-image/uart-prepare", methods=["POST"])
    def prepare_uart():
        ok, error = backend._wukong_control_auth()
        if not ok:
            return error
        try:
            _raw, prepared = selected(request.get_json(silent=True))
        except (OSError, ValueError, KeyError) as error:
            return jsonify(ok=False, queued=False, error=str(error)), 409
        return jsonify(prepared)

    @app.route("/api/namespace-image/uart-install", methods=["POST"])
    def install_uart():
        ok, error = backend._wukong_control_auth()
        if not ok:
            return error
        data = request.get_json(silent=True)
        try:
            raw, prepared = selected(data)
        except (OSError, ValueError, KeyError) as error:
            return jsonify(ok=False, queued=False, error=str(error)), 409
        if (data.get("confirm_runtime_memory_replacement") is not True
                or data.get("artifact_sha256") != prepared["artifact_sha256"]):
            return jsonify(ok=False, queued=False,
                           error="Confirm replacement using the exact prepared image digest."), 409
        with backend._wukong_command_lock:
            target, error = backend._wukong_target_error(data)
            if error:
                return backend._wukong_target_rejection(error)
            try:
                verify_installation(target, time.time())
            except ValueError as error:
                return jsonify(ok=False, queued=False, error=str(error)), 409
            if backend._wukong_pending_cmd or not halted(
                    backend._wukong_cmd_delivery or {}, target, time.time()):
                return jsonify(ok=False, queued=False, error=(
                    "A fresh board-confirmed STOP and an empty queue are required. "
                    "Fault hold refuses uploads; use the separately authorized recovery workflow first. "
                    "Nothing was sent.")), 409
            with backend._upload_in_flight_lock:
                if backend._upload_in_flight:
                    return jsonify(ok=False, queued=False, error="Upload already in progress."), 409
                backend._upload_in_flight = True
            with backend._wukong_hw_entry_lock:
                backend._wukong_pending_entry_slot = prepared["entry_slot"]
                backend._wukong_pending_thread_contexts = prepared["thread_contexts"]
            with backend._wukong_upload_ack_lock:
                backend._wukong_upload_ack = {}
            backend._wukong_run_unlocked = False
            backend._wukong_runtime_identity = None
            backend._wukong_active_lump_info = {}
            backend._wukong_cmd_id += 1
            identity = {key: prepared[key] for key in (
                "artifact_sha256", "artifact_identity", "namespace_revision_id")}
            identity.update(artifact_size=len(raw), target_device_uid=target["device_uid"],
                            target_session_id=target["bridge_session"])
            command_id = backend._wukong_cmd_id
            backend._wukong_pending_cmd = dict(
                cmd="u", id=command_id, data=base64.b64encode(raw).decode("ascii"),
                reboot=True, **target, **identity)
            backend._wukong_cmd_delivery = dict(
                id=command_id, cmd="u", queued_ts=time.time(), consumed_ts=None,
                write_ok=None, write_error="", write_ts=None, **identity)
        return jsonify(dict(prepared, queued=True, id=command_id))
