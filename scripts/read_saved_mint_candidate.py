"""Read and verify the pinned Mint source companion; no writes or compilation."""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.lump_variants import read_variant

BUNDLE = "637412634f56580a85cee50cde19aa4ea88c55b6c3fa1af7cc1ddbcc7a2e7193"
PRIMARY = "d83a4f45f9916a1911881461adab3405839f2316aa0b0215bcab12f67e8be797"
SOURCE = "c32e5b555453b0ea2b6c7b8a749d81285a923758f9181fcffa6f9ad941c4ee01"


def read_saved():
    directory = ROOT / "server/lumps"
    primary = (directory / "ide.Mint.1.a3b3dfad.lump").read_bytes()
    if hashlib.sha256(primary).hexdigest() != PRIMARY:
        raise ValueError("Pinned Mint primary changed")
    full, bundle = read_variant(directory, BUNDLE, "full")
    words = struct.unpack(f">{len(full) // 4}I", full)
    original = struct.unpack(f">{len(primary) // 4}I", primary)
    cw, cc = (original[0] >> 10) & 8191, original[0] & 255
    if ((words[0] >> 10) & 8191) != cw or (words[0] & 255) != cc:
        raise ValueError("Companion geometry mismatch")
    if words[1:1 + cw] != original[1:1 + cw] or words[-cc:] != original[-cc:]:
        raise ValueError("Companion executable/C-list mismatch")
    frame = cw + 1
    if words[frame] >> 16 != 0xAB03:
        raise ValueError("Expected uncompressed full-source frame")
    pos = frame + 1 + ((words[frame] & 65535) + 3) // 4
    length = words[pos]
    if (pos + 1) * 4 + length > (len(words) - cc) * 4:
        raise ValueError("Source exceeds frame bounds")
    source = full[(pos + 1) * 4:(pos + 1) * 4 + length].decode("utf-8")
    if hashlib.sha256(source.encode()).hexdigest() != SOURCE or bundle["source_sha256"] != SOURCE:
        raise ValueError("Pinned Mint source changed")
    return dict(source=source, primarySha256=PRIMARY, sourceSha256=SOURCE,
                bundleId=BUNDLE, executableWords=list(original[1:1 + cw]))


if __name__ == "__main__":
    print(json.dumps(read_saved()))
