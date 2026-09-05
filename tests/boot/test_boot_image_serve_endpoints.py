"""End-to-end tests for GET /api/boot-image/binary and GET /api/boot-image/download.

Task #403: Task #391 added validate_boot_image() calls to both serve routes so
that a stale on-disk image returns HTTP 500 instead of silently reaching the
simulator.  This module confirms those error paths (and the happy paths) via
the Flask test client.

Two scenarios per route:

  1. A tampered boot image (wrong BOOT_IMAGE_FORMAT_TAG) on disk
     → HTTP 500 with a JSON error containing "stale".

  2. A valid boot image produced by generate_boot_image() on disk
     → HTTP 200 with an application/octet-stream body matching the file.

server.app.BOOT_IMAGE_PATH is patched to a temp file for each test so the
real on-disk image is never touched.
"""
import os
import struct
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    generate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _tamper_format_tag(image_bytes):
    """Return a copy of image_bytes with the BOOT_IMAGE_FORMAT_TAG word set to
    a wrong value, so validate_boot_image() raises a ValueError about a stale
    image."""
    total = len(image_bytes) // 4
    ns_table_base = total - NS_TABLE_RESERVE
    tag_idx = ns_table_base - 1
    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[tag_idx] = 0xDEADBEEF  # any value != BOOT_IMAGE_FORMAT_TAG
    return struct.pack(f"<{total}I", *words)


def _make_valid_image():
    return generate_boot_image(_default_cfg(), LUMPS_DIR)

def _make_oversized_image():
    cfg = _default_cfg()
    cfg["step1"]["totalNamespaceWords"] = 32768
    return generate_boot_image(cfg, LUMPS_DIR)


def _write_tampered(path):
    tampered = _tamper_format_tag(_make_valid_image())
    with open(path, "wb") as f:
        f.write(tampered)


def _write_valid(path):
    valid = _make_valid_image()
    with open(path, "wb") as f:
        f.write(valid)
    return valid


def _write_retired_tail_relative_thread_image(path):
    stale = bytearray(_make_valid_image())
    total = len(stale) // 4
    thread_ns_word0 = total - (2 * 4)
    thread_loc = struct.unpack_from("<I", stale, thread_ns_word0 * 4)[0]
    struct.pack_into("<I", stale, (thread_loc + 17) * 4, 0x1F3)
    with open(path, "wb") as f:
        f.write(stale)
    return bytes(stale)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    from server.app import app  # noqa: E402 — deferred to avoid side-effects at import
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def temp_image_path(tmp_path):
    """Redirect server.app.BOOT_IMAGE_PATH to a temp file for one test."""
    fake_path = str(tmp_path / "boot-image.bin")
    with patch("server.app.BOOT_IMAGE_PATH", fake_path):
        yield fake_path


# ---------------------------------------------------------------------------
# /api/boot-image/binary
# ---------------------------------------------------------------------------

def test_binary_stale_image_returns_500(client, temp_image_path):
    """GET /api/boot-image/binary with a tampered image must return HTTP 500
    with a JSON error that contains the word 'stale'."""
    _write_tampered(temp_image_path)

    resp = client.get("/api/boot-image/binary")

    assert resp.status_code == 500, (
        f"Expected 500 for stale boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert "stale" in body.get("error", "").lower(), (
        f"Expected 'stale' in error message, got: {body.get('error')!r}"
    )


def test_binary_valid_image_returns_200(client, temp_image_path):
    """GET /api/boot-image/binary with a valid image must return HTTP 200 with
    an application/octet-stream body identical to the on-disk file."""
    valid_bytes = _write_valid(temp_image_path)

    resp = client.get("/api/boot-image/binary")

    assert resp.status_code == 200, (
        f"Expected 200 for valid boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    assert resp.content_type == "application/octet-stream", (
        f"Expected application/octet-stream, got {resp.content_type!r}"
    )
    assert resp.data == valid_bytes, (
        f"Response body length {len(resp.data)} != image length {len(valid_bytes)}"
    )


def test_binary_regenerates_retired_tail_relative_thread_boundary(
        client, temp_image_path):
    stale_bytes = _write_retired_tail_relative_thread_image(temp_image_path)
    valid_bytes = _make_valid_image()

    def regenerate_image():
        with open(temp_image_path, "wb") as image_file:
            image_file.write(valid_bytes)
        return valid_bytes, None

    with patch("server.app._auto_regen_boot_image",
               side_effect=regenerate_image) as regenerate:
        resp = client.get("/api/boot-image/binary")

    assert stale_bytes != valid_bytes
    regenerate.assert_called_once_with()
    assert resp.status_code == 200
    assert resp.data == valid_bytes


def test_binary_regenerates_when_authoritative_ns_state_is_newer(
        client, temp_image_path):
    valid_bytes = _write_valid(temp_image_path)
    ns_state_path = os.path.join(
        os.path.dirname(temp_image_path), "ns-state.json")
    with open(ns_state_path, "w", encoding="utf-8") as state_file:
        state_file.write('{"abstractions":[]}')
    image_mtime = os.path.getmtime(temp_image_path)
    os.utime(ns_state_path, (image_mtime + 1, image_mtime + 1))

    def regenerate_image():
        with open(temp_image_path, "wb") as image_file:
            image_file.write(valid_bytes)
        return valid_bytes, None

    with patch("server.app._auto_regen_boot_image",
               side_effect=regenerate_image) as regenerate:
        resp = client.get("/api/boot-image/binary")

    regenerate.assert_called_once_with()
    assert resp.status_code == 200
    assert resp.data == valid_bytes


def test_raw_binding_invalidation_does_not_touch_unchanged_ns_state(tmp_path):
    from server.app import _invalidate_ns_state_raw_binding

    state_path = tmp_path / "ns-state.json"
    original = '{"abstractions":[{"name":"CapabilityTest","slot":10}]}'
    state_path.write_text(original)
    before_mtime = state_path.stat().st_mtime_ns

    with patch("server.app.NS_STATE_PATH", str(state_path)):
        _invalidate_ns_state_raw_binding()

    assert state_path.read_text() == original
    assert state_path.stat().st_mtime_ns == before_mtime


def test_binary_never_serves_cached_image_for_different_memory_size(
        client, temp_image_path):
    with open(temp_image_path, "wb") as image_file:
        image_file.write(_make_oversized_image())

    with patch("server.app._auto_regen_boot_image",
               return_value=(None, "regeneration unavailable")):
        resp = client.get("/api/boot-image/binary")

    assert resp.status_code == 500
    error = resp.get_json()["error"]
    assert "32768 words" in error
    assert "16384 words" in error
    assert "regenerate" in error.lower()


def test_exists_does_not_advertise_image_for_different_memory_size(
        client, temp_image_path):
    with open(temp_image_path, "wb") as image_file:
        image_file.write(_make_oversized_image())

    resp = client.get("/api/boot-image/exists")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["exists"] is False
    assert "32768 words" in body["reason"]
    assert "16384 words" in body["reason"]


def test_boot_config_size_change_invalidates_cached_image_availability(
        client, tmp_path):
    image_path = tmp_path / "boot-image.bin"
    config_path = tmp_path / "boot-config.json"
    image_path.write_bytes(_make_oversized_image())
    config_path.write_text('{"step1":{"totalNamespaceWords":32768}}')
    payload = {
        "targetBoard": "wukong-xc7a100t",
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords": 64,
            "threadLumpWords": 256,
        },
        "step2": {"lumps": []},
        "step3": {"emptySlotCount": 0},
    }

    with patch("server.app.BOOT_IMAGE_PATH", str(image_path)), \
            patch("server.app.BOOT_CONFIG_PATH", str(config_path)), \
            patch("server.app.BOOT_CONFIG_LEGACY_PATH",
                  str(tmp_path / "missing-legacy.json")):
        save_resp = client.post("/api/boot-config", json=payload)
        exists_resp = client.get("/api/boot-image/exists")

    assert save_resp.status_code == 200
    assert save_resp.get_json()["bootImageInvalidated"] is True
    assert save_resp.get_json()["invalidatedBootImageWords"] == 32768
    assert exists_resp.status_code == 200
    exists_body = exists_resp.get_json()
    assert exists_body["exists"] is False
    assert "32768 words" in exists_body["reason"]
    assert "16384 words" in exists_body["reason"]


# ---------------------------------------------------------------------------
# /api/boot-image/download
# ---------------------------------------------------------------------------

def test_download_stale_image_returns_500(client, temp_image_path):
    """GET /api/boot-image/download with a tampered image must return HTTP 500
    with a JSON error that contains the word 'stale'."""
    _write_tampered(temp_image_path)

    resp = client.get("/api/boot-image/download")

    assert resp.status_code == 500, (
        f"Expected 500 for stale boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert "stale" in body.get("error", "").lower(), (
        f"Expected 'stale' in error message, got: {body.get('error')!r}"
    )


def test_download_valid_image_returns_200(client, temp_image_path):
    """GET /api/boot-image/download with a valid image must return HTTP 200
    with an application/octet-stream body identical to the on-disk file."""
    valid_bytes = _write_valid(temp_image_path)

    resp = client.get("/api/boot-image/download")

    assert resp.status_code == 200, (
        f"Expected 200 for valid boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    assert resp.content_type == "application/octet-stream", (
        f"Expected application/octet-stream, got {resp.content_type!r}"
    )
    assert resp.data == valid_bytes, (
        f"Response body length {len(resp.data)} != image length {len(valid_bytes)}"
    )
