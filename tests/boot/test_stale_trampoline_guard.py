"""Guard test: loadBootImage() rejects boot images with a stale CHANGE trampoline.

Any boot-image.bin generated before direct-dispatch (Task #2046, trampoline removal)
contains a CHANGE instruction as the first word of the Boot.Abstr lump body.  With
direct dispatch, CR0 is pre-loaded from the boot-entry E-GT before any instructions
execute, so those old trampoline words run as real code — silently producing wrong
behaviour on hardware without a clear error.

This test verifies that:
  1. A hand-crafted "stale" image (valid format tag, but CHANGE as first lump body word)
     causes loadBootImage() to return false with an explanatory error message.
  2. A valid image (from the current generator) still loads and boots successfully.
  3. An image bearing the pre-direct-dispatch format tag (0xB0070563) is also rejected
     because the tag-not-found scan fails to match the current tag.
"""

import base64
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    BOOT_IMAGE_FORMAT_TAG,
    BOOT_ABSTR_NS_SLOT,
    generate_boot_image,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")

# CHANGE is Church opcode 4; encoding: (4 << 27) = 0x20000000
CHANGE_OPCODE = 4
CHANGE_WORD   = (CHANGE_OPCODE << 27) & 0xFFFFFFFF  # 0x20000000

# The format tag in use before the trampoline was removed.
_OLD_FORMAT_TAG = 0xB0070563


# ---- helpers ----------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _run_harness(cfg, image_bytes):
    payload = json.dumps({
        "config":      cfg,
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
    })
    proc = subprocess.run(
        ["node", HARNESS],
        input=payload.encode("utf-8"),
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_boot_loader.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"sim_boot_loader.js produced non-JSON output: {exc}\nstdout:\n{out}"
        ) from exc


def _inject_change_into_boot_abstr(image_bytes):
    """Return a modified copy of image_bytes with CHANGE as word 1 of Boot.Abstr body.

    This mimics a trampoline-era image that starts the Boot.Abstr lump body with a
    CHANGE instruction instead of the current direct-dispatch entry point.
    """
    total = len(image_bytes) // 4
    words = list(struct.unpack(f"<{total}I", image_bytes))

    # Locate BOOT_IMAGE_FORMAT_TAG by backward scan (same algorithm as loadBootImage).
    scan_limit = min(8192, total)
    tag_idx = -1
    for si in range(1, scan_limit + 1):
        pos = total - si
        if words[pos] == BOOT_IMAGE_FORMAT_TAG:
            tag_idx = pos
            break
    assert tag_idx >= 0, (
        f"BOOT_IMAGE_FORMAT_TAG (0x{BOOT_IMAGE_FORMAT_TAG:08x}) not found "
        f"in generated image (last {scan_limit} words)"
    )

    ns_entry_words = 4

    # NS entry word 0 for the Boot.Abstr slot is the lump's physAddr (word index).
    # NS slots count DOWN from the top: slot N starts at total − (N+1)×4.
    ns_table_base  = tag_idx + 1
    abstr_ns_base = total - (BOOT_ABSTR_NS_SLOT + 1) * ns_entry_words
    phys_addr = words[abstr_ns_base]
    assert phys_addr > 0, (
        f"Boot.Abstr physAddr (NS slot {BOOT_ABSTR_NS_SLOT}) must be non-zero"
    )
    assert phys_addr + 1 < ns_table_base, (
        f"Boot.Abstr lump body word 1 (at word {phys_addr + 1}) would be "
        f"inside or beyond NS table (base={ns_table_base})"
    )

    # Overwrite the first body word (word index = physAddr + 1) with CHANGE.
    words[phys_addr + 1] = CHANGE_WORD

    return struct.pack(f"<{total}I", *words)


def _patch_format_tag(image_bytes, new_tag):
    """Return a copy of image_bytes with BOOT_IMAGE_FORMAT_TAG replaced by new_tag."""
    total = len(image_bytes) // 4
    words = list(struct.unpack(f"<{total}I", image_bytes))
    scan_limit = min(8192, total)
    replaced = False
    for si in range(1, scan_limit + 1):
        pos = total - si
        if words[pos] == BOOT_IMAGE_FORMAT_TAG:
            words[pos] = new_tag & 0xFFFFFFFF
            replaced = True
            break
    assert replaced, "BOOT_IMAGE_FORMAT_TAG not found — cannot patch"
    return struct.pack(f"<{total}I", *words)


# ---- tests ------------------------------------------------------------------

def test_stale_trampoline_guard_fires():
    """loadBootImage() must reject a stale image before touching simulator state.

    The guard must fire against the raw input buffer, before any memory copy or
    instance-variable mutation.  Consequence: even if the caller ignores the return
    value and drives _bootStep(), the simulator boots from whatever state it had
    before the call (here: zeroed memory from the harness) — not the stale image.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    stale = _inject_change_into_boot_abstr(image)

    status = _run_harness(cfg, stale)

    console = status.get("consoleOutput", "")
    assert status["loaded"] is False, (
        "loadBootImage() should have rejected the stale trampoline image, "
        f"but returned loaded=True.\nconsoleOutput:\n{console}"
    )
    assert "CHANGE" in console or "trampoline" in console, (
        "Expected 'CHANGE' or 'trampoline' in consoleOutput to explain the rejection; "
        f"got:\n{console}"
    )
    # The stale guard must fire BEFORE any simulator state mutation.
    # Since the harness wipes memory before calling loadBootImage(), a pre-copy
    # rejection leaves memory zeroed — the boot state machine cannot complete.
    assert status["bootComplete"] is False, (
        "bootComplete should be False when loadBootImage() rejected the image — "
        "the stale-trampoline guard must not allow boot to proceed. "
        f"bootStep={status['bootStep']}, consoleOutput:\n{console}"
    )


def test_old_format_tag_rejected():
    """loadBootImage() must reject images carrying the pre-direct-dispatch format tag.

    Old images have tag 0xB0070563; the current tag is 0xB0072046.  The backward scan
    fails to find the new tag, so loadBootImage() returns false before even reaching
    the trampoline guard.
    """
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)
    old   = _patch_format_tag(image, _OLD_FORMAT_TAG)

    status = _run_harness(cfg, old)

    assert status["loaded"] is False, (
        "loadBootImage() should have rejected an old-format-tag image "
        f"(tag=0x{_OLD_FORMAT_TAG:08x}), but returned loaded=True.\n"
        f"consoleOutput:\n{status.get('consoleOutput', '')}"
    )


def test_valid_image_still_loads():
    """Sanity check: a freshly-generated image is not rejected by the stale guard."""
    cfg   = _default_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR)

    status = _run_harness(cfg, image)

    console = status.get("consoleOutput", "")
    assert status["loaded"] is True, (
        "loadBootImage() rejected a valid current-format image.\n"
        f"consoleOutput:\n{console}"
    )
    assert status["bootComplete"] is True, (
        f"Boot did not complete for a valid image; "
        f"bootStep={status['bootStep']}, iterations={status['iterations']}\n"
        f"consoleOutput:\n{console}"
    )
