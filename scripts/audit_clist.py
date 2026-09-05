#!/usr/bin/env python3
"""Validate c-list layout directly from canonical LUMP binaries."""

import json
import os
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")


def _entries():
    with open(os.path.join(LUMPS_DIR, "manifest.json"), encoding="utf-8") as stream:
        value = json.load(stream)
    rows = value if isinstance(value, list) else list(value.values())
    return [row for row in rows if isinstance(row, dict) and row.get("filename")]


def check():
    failures = []
    checked = 0
    empty = 0
    for entry in _entries():
        filename = entry["filename"]
        path = os.path.join(LUMPS_DIR, filename)
        try:
            raw = open(path, "rb").read()
            if len(raw) < 4 or len(raw) % 4:
                raise ValueError("length is not a positive word multiple")
            words = struct.unpack(f">{len(raw) // 4}I", raw)
            header = words[0]
            magic = (header >> 27) & 0x1F
            size = 1 << (((header >> 23) & 0xF) + 6)
            cc = header & 0xFF
            if magic != 0x1F:
                raise ValueError("bad header magic")
            if size != len(words):
                raise ValueError(f"header size {size} != file size {len(words)}")
            if cc >= size:
                raise ValueError(f"c-list count {cc} exceeds LUMP size")
            c_list = words[size - cc:] if cc else ()
            empty += sum(word == 0 for word in c_list)
            checked += 1
        except (OSError, ValueError, struct.error) as exc:
            failures.append(f"  {filename}: {exc}")

    if failures:
        print("audit_clist: FAIL — invalid binary c-list layout:")
        print("\n".join(failures))
        return 1
    print(f"audit_clist: OK — {checked} binaries inspected ({empty} zero c-list words).")
    return 0


if __name__ == "__main__":
    sys.exit(check())