"""Isolated opt-in simulator image reads: no catalog or live image fixture."""
import struct
from unittest.mock import patch

import pytest

from server import app as app_module
from server.boot_image import (
    NS_ENTRY_WORDS,
    NS_TABLE_RESERVE,
    THREAD_STO_OFFSET,
    create_gt,
    pack_lump_header,
    thread_layout,
    validate_boot_image,
    write_ns_entry,
)
from shared.namespace_header import encode_namespace_header


def _synthetic_image():
    total = 16384
    slots = NS_TABLE_RESERVE // NS_ENTRY_WORDS
    words = [0] * total
    thread_loc = 64
    code_loc = 512
    layout = thread_layout(256, 32)
    assert layout["valid"]
    words[thread_loc] = pack_lump_header(2, 32, 0, typ=2)
    words[code_loc] = pack_lump_header(0, 1, 0)
    words[code_loc + 1] = 0x1F000000  # RETURN
    for slot in (2, 3, 4, 5, 6):
        loc = 1024 + slot * 64
        words[loc] = pack_lump_header(0, 1, 0)
        write_ns_entry(words, total, NS_ENTRY_WORDS, slot, loc, 63,
                       0, 0, 1, 0, 0, 0)
    write_ns_entry(words, total, NS_ENTRY_WORDS, 0, 0, total - NS_TABLE_RESERVE - 1,
                   0, 0, 1, 0, 0, 0)
    write_ns_entry(words, total, NS_ENTRY_WORDS, 1, thread_loc, 255,
                   0, 0, 1, 0, 0, 0)
    write_ns_entry(words, total, NS_ENTRY_WORDS, 10, code_loc, 63,
                   0, 0, 1, 0, 0, 0)
    entry_gt = create_gt(0, 10, {"E": 1}, 1)
    resume_sto = layout["stack_end"] - 2
    words[thread_loc + THREAD_STO_OFFSET] = (1 << 12) | resume_sto
    words[thread_loc + layout["caps_start"]] = entry_gt
    words[thread_loc + resume_sto + 1] = entry_gt
    words[thread_loc + resume_sto + 2] = (
        (0x7FFF << 13) | (1 << 12) | layout["stack_end"])
    words[:16] = encode_namespace_header(0, total, slots, code_loc * 4)
    image = struct.pack(f"<{total}I", *words)
    validate_boot_image(image)
    return image


@pytest.fixture
def isolated_image(tmp_path):
    path = tmp_path / "committed.bin"
    image = _synthetic_image()
    path.write_bytes(image)
    # Only read this temporary image. No generated catalog, Namespace state
    # mutation, server approval record, or live artifact is involved.
    with (
        patch.object(app_module, "BOOT_IMAGE_PATH", str(path)),
        patch.object(app_module, "_read_saved_boot_config",
                     return_value=({"step1": {"totalNamespaceWords": 8192}}, None)),
        patch.object(app_module, "_boot_image_provenance_origin", return_value="generated"),
        patch.object(app_module, "_boot_image_is_stale", return_value=True),
        patch.object(app_module, "_authoritative_boot_slot", return_value=10),
        patch.object(app_module, "_auto_regen_boot_image") as regenerate,
        patch.object(app_module, "_write_boot_image_bytes") as write_image,
    ):
        yield app_module.app.test_client(), path, image, regenerate, write_image


def test_stale_simulator_read_preserves_exact_bytes_and_other_routes(isolated_image):
    client, path, image, regenerate, write_image = isolated_image
    ordinary = client.get("/api/boot-image/binary")
    download = client.get("/api/boot-image/download")
    assert ordinary.status_code == 409
    assert download.status_code == 409
    response = client.get("/api/boot-image/binary?simulator=1")
    assert response.status_code == 200
    assert response.data == image == path.read_bytes()
    assert response.headers["X-Simulator-Image-Stale"] == "true"
    assert response.headers["X-Boot-Preparation"] == "prepared"
    assert response.headers["Cache-Control"].startswith("no-store")
    regenerate.assert_not_called()
    write_image.assert_not_called()


def test_missing_and_malformed_simulator_bytes_never_regenerate(isolated_image):
    client, path, _, regenerate, write_image = isolated_image
    path.unlink()
    assert client.get("/api/boot-image/binary?simulator=1").status_code == 404
    path.write_bytes(b"\x00\x00\x00\x00")
    rejected = client.get("/api/boot-image/binary?simulator=1")
    assert rejected.status_code == 500
    assert b"stale or invalid" in rejected.data
    regenerate.assert_not_called()
    write_image.assert_not_called()