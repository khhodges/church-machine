"""End-to-end tests for POST /api/boot-image/upload.

Task #389: The endpoint validates images before saving, but there were no
automated tests covering this path.  This module exercises two cases
against the Flask test client:

  1. A boot image that has the correct format-version tag but a zeroed
     mandatory NS slot (slot 0) — must return 400 with "mandatory NS slot"
     in the error message.

  2. A well-formed image produced by generate_boot_image() — must return 200
     with ok=True.

Neither case requires a saved boot-config.json on disk; the invalid-image
case is crafted purely in memory, and the valid-image case generates the
image at test time from a default config.

Task #397: Additional parametrized cases cover four more validation branches:
  - Missing/empty JSON body
  - Missing data_b64 field
  - Malformed base64 data
  - Empty image
  - Image whose byte length is not a multiple of 4
"""
import base64
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    NS_TABLE_RESERVE,
    NS_ENTRY_WORDS,
    BOOT_ABSTR_NS_SLOT,
    BOOT_IMAGE_FORMAT_TAG,
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


def _zero_ns_slot(image_bytes, cfg, slot):
    """Return a copy of image_bytes with word0 and word1 of NS slot zeroed."""
    total = int(cfg["step1"]["totalNamespaceWords"])
    ns_table_base = total - NS_TABLE_RESERVE
    slot_base = ns_table_base + slot * NS_ENTRY_WORDS
    words = list(struct.unpack(f"<{total}I", image_bytes))
    words[slot_base]     = 0
    words[slot_base + 1] = 0
    return struct.pack(f"<{total}I", *words)


def _to_b64(image_bytes):
    return base64.b64encode(image_bytes).decode("ascii")


@pytest.fixture(scope="module")
def client():
    from server.app import app  # noqa: E402 — deferred to avoid side-effects at import
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_upload_bad_boot_image_returns_400_mandatory_ns_slot(client):
    """POST a boot image with a zeroed mandatory NS slot — expect 400 with
    an error message that mentions 'mandatory NS slot'."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    bad_image = _zero_ns_slot(image, cfg, slot=0)

    resp = client.post(
        "/api/boot-image/upload",
        json={"data_b64": _to_b64(bad_image)},
    )

    assert resp.status_code == 400, (
        f"Expected 400 for image with zeroed NS slot 0, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert body.get("ok") is False, f"Expected ok=false in error response, got {body}"
    error_msg = body.get("error", "")
    assert "mandatory NS slot" in error_msg, (
        f"Expected 'mandatory NS slot' in error message, got: {error_msg!r}"
    )


def test_upload_valid_boot_image_returns_200(client):
    """POST a well-formed boot image produced by generate_boot_image() — expect 200."""
    cfg = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    resp = client.post(
        "/api/boot-image/upload",
        json={"data_b64": _to_b64(image)},
    )

    assert resp.status_code == 200, (
        f"Expected 200 for a valid boot image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    body = resp.get_json()
    assert body is not None, "Response body should be JSON"
    assert body.get("ok") is True, f"Expected ok=true in success response, got {body}"
    assert body.get("bytes") == len(image), (
        f"Response 'bytes' field {body.get('bytes')} != image length {len(image)}"
    )
    assert body.get("words") == len(image) // 4, (
        f"Response 'words' field {body.get('words')} != {len(image) // 4}"
    )


# ---------------------------------------------------------------------------
# Task #397 — edge-case validation branches
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("body,content_type,expected_fragment", [
    (b"",           "application/json", "Invalid JSON body"),
    (b"not json",   "application/json", "Invalid JSON body"),
])
def test_upload_missing_or_bad_json_body_returns_400(client, body, content_type, expected_fragment):
    """POST with a missing or non-JSON body must return 400 with a descriptive error."""
    resp = client.post(
        "/api/boot-image/upload",
        data=body,
        content_type=content_type,
    )
    assert resp.status_code == 400, (
        f"Expected 400 for body={body!r}, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    result = resp.get_json()
    assert result is not None, "Response body should be JSON"
    assert result.get("ok") is False
    assert expected_fragment in result.get("error", ""), (
        f"Expected {expected_fragment!r} in error, got {result.get('error')!r}"
    )


@pytest.mark.parametrize("payload,expected_fragment", [
    # An empty dict {} is falsy in Python, so the endpoint treats it the
    # same as a missing body and returns "Invalid JSON body".
    ({},                    "Invalid JSON body"),
    # An explicit None for data_b64 — key is present but null.
    ({"data_b64": None},    "Missing 'data_b64' field"),
    # Key missing entirely — payload.get("data_b64") returns None.
    ({"other_key": "x"},    "Missing 'data_b64' field"),
])
def test_upload_missing_data_b64_field_returns_400(client, payload, expected_fragment):
    """POST with a JSON body that omits or nulls data_b64 must return 400."""
    resp = client.post("/api/boot-image/upload", json=payload)
    assert resp.status_code == 400, (
        f"Expected 400 for payload={payload!r}, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    result = resp.get_json()
    assert result is not None
    assert result.get("ok") is False
    assert expected_fragment in result.get("error", ""), (
        f"Expected {expected_fragment!r} in error, got {result.get('error')!r}"
    )


@pytest.mark.parametrize("bad_b64", [
    "not!valid!base64!!!",
    "====",
    "YQ==YQ==",
])
def test_upload_malformed_base64_returns_400(client, bad_b64):
    """POST with syntactically invalid base64 must return 400 with 'Invalid base64 data'."""
    resp = client.post("/api/boot-image/upload", json={"data_b64": bad_b64})
    assert resp.status_code == 400, (
        f"Expected 400 for bad_b64={bad_b64!r}, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    result = resp.get_json()
    assert result is not None
    assert result.get("ok") is False
    assert "Invalid base64 data" in result.get("error", ""), (
        f"Expected 'Invalid base64 data' in error, got {result.get('error')!r}"
    )


def test_empty_image_guard_direct():
    """Call _validate_boot_image_bytes(b"") directly — no HTTP layer involved.

    This is a companion to test_upload_empty_image_returns_400.  It confirms
    that the guard is independently exercised via the factored-out helper and
    would remain covered even if the HTTP routing changed.
    """
    from server.app import _validate_boot_image_bytes

    with pytest.raises(ValueError, match="Boot image is empty"):
        _validate_boot_image_bytes(b"")


def test_upload_empty_image_returns_400(client):
    """POST a zero-byte image must return 400 with 'Boot image is empty'.

    base64.b64encode(b"") == b"", so the encoded string is empty ("").
    The endpoint accepts an empty string as a present-but-empty data_b64 value,
    decodes it to zero bytes, and returns 400 "Boot image is empty".
    """
    empty_b64 = base64.b64encode(b"").decode("ascii")
    assert empty_b64 == "", "sanity-check: empty bytes encodes to empty string"
    resp = client.post("/api/boot-image/upload", json={"data_b64": empty_b64})
    assert resp.status_code == 400, (
        f"Expected 400 for empty image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    result = resp.get_json()
    assert result is not None
    assert result.get("ok") is False, f"Expected ok=False, got {result}"
    assert "Boot image is empty" in result.get("error", ""), (
        f"Expected 'Boot image is empty' in error, got {result.get('error')!r}"
    )


@pytest.mark.parametrize("extra_bytes", [1, 2, 3])
def test_upload_non_multiple_of_4_returns_400(client, extra_bytes):
    """POST a base64 image whose byte length is not a multiple of 4 must return 400."""
    raw = b"\x00" * (4 + extra_bytes)
    b64 = base64.b64encode(raw).decode("ascii")
    resp = client.post("/api/boot-image/upload", json={"data_b64": b64})
    assert resp.status_code == 400, (
        f"Expected 400 for {len(raw)}-byte image, got {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    result = resp.get_json()
    assert result is not None
    assert result.get("ok") is False
    assert "multiple of 4" in result.get("error", ""), (
        f"Expected 'multiple of 4' in error, got {result.get('error')!r}"
    )
