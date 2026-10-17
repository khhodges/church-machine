"""Source recovery must use the exact selected bytes, never catalog fallbacks."""
import hashlib
import json
import struct
import zlib

import pytest
from scripts.prepare_phase1_candidates import recover


def image(compressed=False):
    source = "; @abstraction ide.Example\nRETURN\n"
    api = json.dumps({"name": "ide.Example", "language": "assembly"}).encode()
    payload = source.encode()
    if compressed:
        compressor = zlib.compressobj(wbits=-15)
        payload = compressor.compress(payload) + compressor.flush()
    words = [0] * 64
    words[0] = (31 << 27) | (1 << 10) | 1
    words[1] = 0x1f000000
    words[2] = (0xAB << 24) | ((7 if compressed else 3) << 16) | len(api)
    def place(at, data):
        padded = data + bytes((-len(data)) % 4)
        words[at:at + len(padded)//4] = struct.unpack(f">{len(padded)//4}I", padded)
    place(3, api)
    source_at = 3 + (len(api) + 3)//4
    words[source_at] = len(payload)
    place(source_at + 1, payload)
    raw = struct.pack(">64I", *words)
    return raw, source, source_at


@pytest.mark.parametrize("compressed", [False, True])
def test_exact_source(compressed):
    raw, source, _ = image(compressed)
    recovered, api = recover(raw, hashlib.sha256(raw).hexdigest())
    assert recovered == source
    assert api["name"] == "ide.Example"


def test_wrong_selected_hash_rejected():
    raw, _, _ = image()
    with pytest.raises(ValueError, match="hash mismatch"):
        recover(raw, "0" * 64)


def test_source_cannot_overlap_capabilities():
    raw, _, at = image()
    words = list(struct.unpack(">64I", raw))
    words[at] = 4096
    raw = struct.pack(">64I", *words)
    with pytest.raises(ValueError, match="overlaps C-list"):
        recover(raw, hashlib.sha256(raw).hexdigest())


def test_api_only_does_not_get_invented_source():
    raw, _, _ = image()
    words = list(struct.unpack(">64I", raw))
    words[2] &= ~(255 << 16)
    raw = struct.pack(">64I", *words)
    with pytest.raises(ValueError, match="No supported embedded source"):
        recover(raw, hashlib.sha256(raw).hexdigest())
