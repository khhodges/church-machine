#!/usr/bin/env python3
"""Read-only verification of the retained physical reload observation.

Never connects to a server or serial port. Recorded CRC validity is a bridge
observation, not an independent recomputation from a retained raw UART stream.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hardware.wukong_bridge import decode_trace_packet


def verify():
    folder = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime"
    hashes = {
        "physical-runtime-reload-status.json":
            "ae86981da39f5daefa604af48d4513c1b80d082358966ccf000ae6b23d217bb9",
        "physical-runtime-reload-events.json":
            "b41d05a56e4cbf498ef7a6bdfaff8104ba8e644b821f830edc81a91ea9c57d00",
        "candidate-le.bin":
            "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451",
    }
    for name, expected in hashes.items():
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == expected, name
    status = json.loads((folder / "physical-runtime-reload-status.json").read_text())
    events = json.loads((folder / "physical-runtime-reload-events.json").read_text())
    model = json.loads((folder / "full-program-result.json").read_text())
    ack, delivery = status["runtime_upload_ack"], status["command_delivery"]
    snapshot = status["latest_snapshot"]
    session, uid = "9bc8f0b355574cdc89e82f51ea428a71", "20250619ac5c01"
    assert ack["ok"] is True and delivery["write_ok"] is True
    assert ack["id"] == delivery["id"] == 4
    assert ack["artifact_size"] == delivery["artifact_size"] == 65536
    assert ack["artifact_sha256"] == delivery["artifact_sha256"] == hashes["candidate-le.bin"]
    assert ack["session_id"] == delivery["target_session_id"] == snapshot["bridge_session"] == session
    assert ack["target_device_uid"] == delivery["target_device_uid"] == uid
    assert status["pending_command"] is None and status["upload_in_flight"] is False
    assert snapshot["crc_valid"] is True and snapshot["reason"] == 2
    assert snapshot["nia"] == model["fetchAddress"] == 0x2E08
    assert snapshot["thread_base"] == 0x2800
    assert all(snapshot["cr"][int(k)] == v for k, v in model["registers"].items())
    packets = sorted(
        (p for p in events["events"] if p.get("bridge_trace_counter") is not None),
        key=lambda p: p["bridge_trace_counter"])
    assert [p["bridge_trace_counter"] for p in packets] == list(range(1, 40))
    fault = [p for p in packets if p["fault_valid"]]
    # Ordinary event records omit session; only fault records retain this field.
    # Do not turn the live single-bridge context into per-packet attestation.
    assert all(p["bridge_session"] == session for p in fault)
    assert [p["bridge_trace_counter"] for p in fault] == [38, 39]
    assert all(p["fault_code"] == model["faultCode"] == 8 and p["nia"] == 0x2E08
               for p in fault)
    raw = (ROOT / "attached_assets/wukong-corrected-program-20261026T200751646720Z_1793045631780.bin").read_bytes()
    assert len(raw) == 772
    assert hashlib.sha256(raw).hexdigest() == "2373193def2384f725d269a8fb76139fe308ac26586993e05e404995cfddf586"
    prior = [decode_trace_packet(raw[i:i+12]) for i in range(12, 480, 12)]
    differences = []
    for counter, (actual, expected) in enumerate(zip(packets, prior), 1):
        for field, value in expected.items():
            if actual[field] != value:
                differences.append([counter, field, value, actual[field]])
    # Retain the difference, rather than silently treating reset state as pristine.
    assert differences == [[7, "payload_gt", 0, 0x4A000011]]
    assert status["boot_info"]["startup_state"] == "halt_confirmation_timed_out"
    image = (folder / "candidate-le.bin").read_bytes()
    wire = b"".join(image[i:i+4][::-1] for i in range(0, len(image), 4))
    frame = b"u" + struct.pack(">I", len(wire)) + wire
    assert hashlib.sha256(wire).hexdigest() == "94e649cb1b9aa32a77f96950f7ec91169c4a81d5d749cb37b7539289839f8e30"
    assert len(frame) == 65541
    assert hashlib.sha256(frame).hexdigest() == "96e560f13089bc7bda494e53b1080bc1c2f2b424be64f3d5beb69081b4e8bc5a"
    return {
        "evidenceChecks": "passed",
        "transportAcknowledged": True,
        "programEndpoint": "Mallory BOUNDS at 0x2e08 in Thread.3",
        "tracePackets": len(packets),
        "priorCaptureDifferences": differences,
        "postReloadStartupHaltConfirmed": False,
        "ordinaryTraceSessionRetainedPerPacket": False,
        "installedBytesVerified": False,
        "releaseApproved": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
