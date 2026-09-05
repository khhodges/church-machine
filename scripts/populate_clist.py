#!/usr/bin/env python3
"""Inspect c-list words in canonical binaries.

C-list mutation is intentionally unavailable: changing a binary invalidates its
SHA-256 identity. Required words must be changed in source and rebuilt.
"""

import argparse
import json
import os
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


def run():
    with open(os.path.join(LUMPS_DIR, "manifest.json"), encoding="utf-8") as stream:
        value = json.load(stream)
    entries = value if isinstance(value, list) else list(value.values())
    failures = 0
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("filename"):
            continue
        filename = entry["filename"]
        try:
            raw = open(os.path.join(LUMPS_DIR, filename), "rb").read()
            if len(raw) < 4 or len(raw) % 4:
                raise ValueError("invalid word length")
            words = struct.unpack(f">{len(raw) // 4}I", raw)
            header = words[0]
            size = 1 << (((header >> 23) & 0xF) + 6)
            cc = header & 0xFF
            if ((header >> 27) & 0x1F) != 0x1F or size != len(words) or cc >= size:
                raise ValueError("invalid header/c-list bounds")
            c_list = words[size - cc:] if cc else ()
            rendered = " ".join(f"{word:08x}" for word in c_list) or "(empty)"
            print(f"{filename}: cc={cc} {rendered}")
        except (OSError, ValueError, struct.error) as exc:
            failures += 1
            print(f"{filename}: ERROR {exc}", file=sys.stderr)
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description="Inspect binary c-list words.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Retained compatibility flag; inspection never writes")
    parser.add_argument("--write", action="store_true",
                        help="Rejected: edit source and rebuild to change c-list words")
    args = parser.parse_args()
    if args.write:
        parser.error("--write is retired; edit source and rebuild the LUMP")
    return run()


if __name__ == "__main__":
    sys.exit(main())