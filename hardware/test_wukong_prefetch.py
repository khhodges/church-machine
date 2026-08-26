"""Focused tests for Wukong's post-boot LUMP prefetch transport."""

import hashlib
import importlib
import json
import struct

from hardware.wukong_bridge import (
    build_prefetch_response,
    handle_prefetch_request,
    parse_prefetch_incident,
)
from hardware.wukong_prefetch import (
    PREFETCH_STATUS_CRC,
    PREFETCH_STATUS_MALFORMED,
    PREFETCH_STATUS_OK,
    PREFETCH_STATUS_TRANSPORT,
    build_incident,
    build_request,
    crc32,
    parse_request,
    parse_response_header,
)
from server.boot_image import build_wukong_prefetch_policy


class _Response:
    def __init__(self, status_code, content, headers):
        self.status_code = status_code
        self.content = content
        self.headers = headers


def _canonical_response(token=0x12345678, words=None, corrupt_crc=False,
                        corrupt_hash=False):
    words = words or [0xF8000700] + [0] * 63  # Outform, 64-word allocation
    raw = struct.pack(f">{len(words)}I", *words)
    digest = hashlib.sha256(raw).hexdigest()
    if corrupt_hash:
        digest = "0" * 64
    advertised_crc = crc32(raw) ^ (1 if corrupt_crc else 0)
    return _Response(200, struct.pack(">I", advertised_crc) + raw, {
        "X-Lump-Hash": f"sha256:{digest}",
        "X-Lump-Binary-Hash": f"sha256:{digest}",
        "X-Lump-Identity-Hash": "sha256:" + "1" * 64,
        "X-Lump-Cache-Token": f"{token:08x}",
        "X-Lump-Trust": "canonical",
    })


def _response_status(frame):
    header = parse_response_header(frame)
    assert header is not None
    return header["status"]


def test_request_round_trip_includes_hash_prefix():
    request = build_request(7, 12, 0x12345678, 64, 0xAABBCCDD)
    assert len(request) == 16
    assert parse_request(request) == {
        "sequence": 7, "slot": 12, "token": 0x12345678,
        "max_words": 64, "expected_hash32": 0xAABBCCDD,
    }


def test_bridge_returns_validated_raw_lump_frame():
    request = parse_request(build_request(1, 8, 0x12345678, 64))
    frame = build_prefetch_response(request, _canonical_response())
    header = parse_response_header(frame)
    assert header["status"] == PREFETCH_STATUS_OK
    assert header["slot"] == 8
    assert header["token"] == 0x12345678
    assert header["word_count"] == 64
    assert frame[16:] == _canonical_response().content[4:]


def test_bridge_rejects_bad_crc_and_noncanonical_metadata():
    request = parse_request(build_request(1, 8, 0x12345678, 64))
    assert _response_status(build_prefetch_response(
        request, _canonical_response(corrupt_crc=True))) == PREFETCH_STATUS_CRC
    assert _response_status(build_prefetch_response(
        request, _canonical_response(corrupt_hash=True))) == PREFETCH_STATUS_CRC
    bad_metadata = _canonical_response()
    bad_metadata.headers["X-Lump-Trust"] = "untrusted"
    assert _response_status(build_prefetch_response(
        request, bad_metadata)) == PREFETCH_STATUS_MALFORMED


def test_transport_failure_yields_retryable_error_response():
    request_frame = build_request(2, 8, 0x12345678, 64)

    def _unavailable(*_args, **_kwargs):
        raise OSError("serial-side network loss")

    response = handle_prefetch_request(
        request_frame, "https://ide.example", True, http_get=_unavailable)
    assert _response_status(response) == PREFETCH_STATUS_TRANSPORT


def test_required_incident_frame_is_decodable():
    assert parse_prefetch_incident(build_incident(3, 9, PREFETCH_STATUS_CRC, 3)) == {
        "sequence": 3, "slot": 9, "status": PREFETCH_STATUS_CRC, "attempts": 3,
    }


def test_rtl_uses_big_endian_response_fields_and_emits_all_incident_bytes():
    """Keep the FPGA parser in lockstep with the bridge's big-endian frames."""
    from pathlib import Path

    source = (Path(__file__).with_name("wukong_top.py")).read_text()
    assert "Cat(pf_header[7], pf_header[6], pf_header[5], pf_header[4])" in source
    assert "Cat(pf_header[11], pf_header[10], pf_header[9], pf_header[8])" in source
    assert "Cat(pf_header[15], pf_header[14], pf_header[13], pf_header[12])" in source
    assert "with m.If(pf_incident_index == 7):" in source
    # This is the bridge wire format the RTL parser above consumes.
    frame = build_prefetch_response(
        parse_request(build_request(9, 12, 0x12345678, 64)),
        _canonical_response())
    parsed = parse_response_header(frame)
    assert (parsed["token"], parsed["word_count"], parsed["crc"]) == (
        0x12345678, 64, crc32(frame[16:]))


def test_projection_policy_orders_entries_and_reserves_bounded_capacity():
    source = [0] * 600
    # Generic image uses an inverted Namespace table. Give each policy slot a
    # distinct authority word so the projection must retain it.
    source[-(9 + 1) * 4 + 1] = 0x4A120000
    source[-(8 + 1) * 4 + 1] = 0x4A340000
    cfg = {"step2": {"lumps": [
        {"nsSlot": 9, "prefetch": True, "resident": False, "prefetchOrder": 2,
         "lumpToken": "00000009", "lumpSize": 64, "binaryHash": "aabbccdd"},
        {"nsSlot": 8, "prefetch": True, "resident": False, "prefetchOrder": 1,
         "lumpToken": "00000008", "lumpSize": 128, "prefetchRequired": False},
    ]}}
    words, entries = build_wukong_prefetch_policy(cfg, source, 1400)
    assert [entry["slot"] for entry in entries] == [8, 9]
    assert entries[0]["target"] == 1400
    assert entries[1]["target"] == 1528
    assert words[1] & 0xFFFF == 2
    assert entries[0]["required"] is False
    # Bits 20:17 are part of W1's range; retaining them would authorize a
    # larger body than the policy's allocated capacity.
    assert entries[1]["authority"] & 0x1FFFFF == 63


def test_projection_policy_rejects_capacity_exhaustion():
    cfg = {"step2": {"lumps": [{
        "nsSlot": 8, "prefetch": True, "resident": False,
        "lumpToken": "00000008", "lumpSize": 16384,
    }]}}
    try:
        build_wukong_prefetch_policy(cfg, [0] * 100, 1280)
    except ValueError as exc:
        assert "capacity" in str(exc)
    else:
        raise AssertionError("Wukong projection accepted an overflowing staging body")


def test_lazy_prefetch_save_retains_capacity_and_hash_binding(monkeypatch, tmp_path):
    """A designer save must not reduce a lazy 128-word LUMP to 64 words."""
    app_module = importlib.import_module("server.app")
    config_path = tmp_path / "boot-config.json"
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(app_module, "_validate_step1", lambda *_args: None)
    monkeypatch.setattr(app_module, "_validate_step2", lambda *_args: None)
    monkeypatch.setattr(app_module, "_validate_step3", lambda *_args: None)
    payload = {
        "targetBoard": "wukong-xc7a100t",
        "step1": {
            "totalNamespaceWords": 16384, "namespaceLumpWords": 64,
            "threadLumpWords": 256,
        },
        "step2": {"lumps": [{
            "nsSlot": 8, "resident": False, "prefetch": True,
            "prefetchRequired": True, "prefetchOrder": 0,
            "downloadUrl": "/api/lump/12345678", "lumpToken": "12345678",
            "lumpSize": 128, "binaryHash": "aabbccddeeff0011",
            "identityHash": "1122334455667788",
        }]},
    }
    with app_module.app.test_client() as client:
        response = client.post("/api/boot-config", json=payload)
    assert response.status_code == 200
    saved = json.loads(config_path.read_text())
    entry = saved["step2"]["lumps"][0]
    assert entry["lumpSize"] == 128
    assert entry["binaryHash"] == "aabbccddeeff0011"
    assert entry["identityHash"] == "1122334455667788"