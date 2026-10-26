#!/usr/bin/env python3
"""Offline source compatibility evidence, not installed-board identification.

Exit 2 means the no-flash trial remains blocked. No writes to live state,
serial access, network calls, image conversion or hardware commands.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def inspect(image):
    from hardware.boot_rom import BOOT_PROGRAM
    from server.namespace_ascending_image import FORMAT, validate_image
    from server.boot_image import build_wukong_upload_image

    validate_image(image, image_format=FORMAT)
    words = struct.unpack(f"<{len(image)//4}I", image)
    root_slot = BOOT_PROGRAM[0] & 0x7fff
    thread_slot = BOOT_PROGRAM[1] & 0x7fff
    try:
        build_wukong_upload_image(image)
        rejection = None
    except ValueError as exc:
        rejection = str(exc)
    return {
        "namespace": "New Layout",
        "image_sha256": hashlib.sha256(image).hexdigest(),
        "size_bytes": len(image),
        "ascending_image_validation": "passed",
        "source_boot_words": [f"0x{word:08x}" for word in BOOT_PROGRAM[:3]],
        "source_boot_root_slot": root_slot,
        "source_boot_thread_slot": thread_slot,
        "required_root_slot": 1,
        "required_thread_slot": 2,
        "boot_slot_match": root_slot == 1 and thread_slot == 2,
        "metadata_words": list(words[:4]),
        "self_descriptor_words": list(words[4:8]),
        "thread_descriptor_words": list(words[8:12]),
        "existing_loader_rejection": rejection,
        "status": "blocked; hardware compatibility has not been established",
        "installed_board": "unknown; disconnected; no physical test performed",
        "address_unit_review": (
            "New Layout descriptor locations are word addresses. Current "
            "ns_gate/mload pass raw_base into word1_location; Wukong memory "
            "arbitration treats addresses as bytes. See source references."
        ),
        "source_references": [
            "hardware/boot_rom.py: BOOT_PROGRAM",
            "hardware/wukong_top.py: BootRom(_WUKONG_ROM), DMEM address arbitration",
            "hardware/ns_gate.py: ns_entry_addr and raw_base",
            "hardware/mload.py: WAIT_GATE",
        ],
        "source_sha256": {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in (
                "hardware/boot_rom.py", "hardware/wukong_top.py",
                "hardware/ns_gate.py", "hardware/mload.py",
                "server/namespace_ascending_image.py", "server/boot_image.py",
            )
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.image.read_bytes()), indent=2))
    # This diagnostic never grants hardware compatibility, even if a future
    # change makes the boot-slot comparison pass.
    return 2


if __name__ == "__main__":
    sys.exit(main())
