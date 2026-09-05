"""Boot-image regression coverage for the Task 2862 NS Word 3 contract."""

import os
import struct

from server.boot_image import (
    BOOT_IMAGE_FORMAT_TAG,
    NS_ENTRY_WORDS,
    _load_trusted_cache_token_map,
    generate_boot_image,
)


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


def _slot_words(words, slot):
    base = len(words) - (slot + 1) * NS_ENTRY_WORDS
    return words[base:base + NS_ENTRY_WORDS]


def test_format_tag_marks_canonical_thread_frame_images():
    assert BOOT_IMAGE_FORMAT_TAG == 0xB0073224


def test_trusted_cache_map_uses_current_ns_state_not_stale_manifest_slots():
    tokens = _load_trusted_cache_token_map(
        os.path.join(LUMPS_DIR, "manifest.json"))

    # SelfTest has a complete canonical full-identity record and current slot
    # assignment.
    assert tokens[6] == 0x30542A6D

    # Manifest history still contains Constants at slot 9, while current
    # ns-state owns it at slot 46.  Its metadata lacks a full identity hash, so
    # neither the stale nor the current slot may be promoted to trusted.
    assert 9 not in tokens
    assert 46 not in tokens


def test_generated_resident_entries_use_cache_tokens_not_permission_annotations():
    cfg = {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords": 1024,
            "threadLumpWords": 256,
        },
    }
    image = generate_boot_image(cfg, LUMPS_DIR)
    words = list(struct.unpack(f"<{len(image) // 4}I", image))

    # Foundational/device entries without a canonical external full identity
    # have no cache value.  In particular, W3 is no longer synthesized from
    # their permission mask.
    for slot in (0, 1, 2, 3, 4, 5, 9, 10):
        assert _slot_words(words, slot)[3] == 0

    # Only canonically verified resident identities receive their compact
    # issue-blind lookup value. Full issued identity stays in manifest data.
    assert _slot_words(words, 6)[3] == 0x30542A6D
    assert _slot_words(words, 7)[3] == 0
    assert _slot_words(words, 8)[3] == 0
