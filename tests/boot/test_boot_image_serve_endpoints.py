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


def _write_tampered(path):
    tampered = _tamper_format_tag(_make_valid_image())
    with open(path, "wb") as f:
        f.write(tampered)


def _write_valid(path):
    valid = _make_valid_image()
    with open(path, "wb") as f:
        f.write(valid)
    return valid


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
