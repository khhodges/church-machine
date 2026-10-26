"""No serial/network access: exact retained image through the existing bridge."""
import base64
import hashlib
import json
from pathlib import Path
import struct
from unittest.mock import patch
import pytest

from hardware import wukong_bridge as bridge
from hardware.test_wukong_bridge_dispatch import _FakeSer


@pytest.mark.parametrize("guarded", [False, True])
def test_retained_full_image_frame_and_restart_order(guarded):
    root = Path(__file__).resolve().parents[2]
    evidence = root / "docs/phase-1/reload-evidence"
    raw = (evidence / ("new-layout-guarded/candidate-le.bin" if guarded
                       else "projected-le.bin")).read_bytes()
    report = json.loads((evidence / "report.json").read_text())
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == ("866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879"
                      if guarded else report["projection"]["sha256"])
    assert len(raw) == 65536
    command = {
        "id": 1, "data": base64.b64encode(raw).decode(), "reboot": True,
        "artifact_size": len(raw), "artifact_sha256": digest,
        "artifact_identity": "wukong-native-dmem-v1:" + digest,
    }
    ser = _FakeSer(read_bytes=b"\x06")
    with patch.object(bridge, "requests") as requests:
        bridge._handle_upload(command, ser, "https://offline.invalid", True)
    wire = struct.pack(">16384I", *struct.unpack("<16384I", raw))
    assert bytes(ser._written) == b"\x75\x00\x01\x00\x00" + wire + b"f"
    if not guarded:
        assert hashlib.sha256(wire).hexdigest() == report["wire"]["payload_sha256"]
    assert any(c.kwargs.get("json", {}).get("ok") is True
               for c in requests.post.call_args_list)


@pytest.mark.parametrize("guarded", [False, True])
def test_retained_image_write_failure_never_sends_restart(guarded):
    root = Path(__file__).resolve().parents[2]
    raw = (root / "docs/phase-1/reload-evidence" /
           ("new-layout-guarded/candidate-le.bin" if guarded else "projected-le.bin")).read_bytes()
    ser = _FakeSer()
    with patch.object(ser, "write", side_effect=OSError("offline injected write failure")) as write:
        with patch.object(bridge, "requests") as requests:
            bridge._handle_upload(
                {"data": base64.b64encode(raw).decode(), "reboot": True},
                ser, "https://offline.invalid", True)
    assert write.call_count == 1
    assert write.call_args.args[0].startswith(b"\x75\x00\x01\x00\x00")
    assert any("offline injected write failure" in c.kwargs.get("json", {}).get("error", "")
               for c in requests.post.call_args_list)
