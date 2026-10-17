"""Source recovery must use the exact selected bytes, never catalog fallbacks."""
import hashlib
import json
import struct
import zlib

import pytest
from scripts.prepare_phase1_candidates import ROOT, recover, qualify_source, run_compile


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


def test_approved_names_preserve_operands_comments_and_substrings():
    source = ("; Abstraction: CapabilityTest\nabstraction CapabilityTest {\n"
              "capabilities { SELF E, UART_DEV RW }\n"
              "LOAD CR1, UART_DEV ; UART_DEV is the display label\n"
              "UART_DEV_label: IADD DR1, DR0, #3\n}\n")
    result = qualify_source(source, "CapabilityTest")
    assert "abstraction ide.CapabilityTest" in result
    assert "LOAD CR1, ide.UART_DEV ; UART_DEV is the display label" in result
    assert "UART_DEV_label:" in result
    assert qualify_source(result, "CapabilityTest") == result


def test_selftest_method_gets_outer_identity_not_replacement_instructions():
    source = "method Run {\nLOAD CR1, SELF\nRETURN\n}\n"
    result = qualify_source(source, "SelfTest")
    assert result.startswith("abstraction ide.SelfTest {\ncapabilities { SELF E }\n")
    assert source in result
    assert qualify_source(result, "SelfTest") == result


def test_device_aliases_have_explicit_approved_roles():
    assert qualify_source("LOAD CR3, LED0\nLOAD CR4, UART_TX\n", "WukongCallHome") == (
        "; @abstraction ide.WukongCallHome\n"
        "LOAD CR3, ide.LED_DEV\nLOAD CR4, ide.UART_DEV\n")


@pytest.mark.parametrize("slot", [6, 7, 10])
def test_exact_selected_source_compiles_as_approved_candidate(slot):
    profile_path = ROOT / "tests/fixtures/phase1_namespace_target.json"
    profile_bytes = profile_path.read_bytes()
    row = next(row for row in json.loads(profile_bytes)["rows"] if row["slot"] == slot)
    selected = row["selection"]
    path = ROOT / "server/lumps" / selected["filename"]
    original = path.read_bytes()
    source, api = recover(original, selected["binaryHash"])
    candidate = qualify_source(source, row["name"])
    result = run_compile({"source": candidate,
                          "language": api.get("language") or "assembly", "tier": 2})
    assert result["ok"], result
    assert result["abstractionName"] == "ide." + row["name"]
    assert result["methods"], "candidate must contain executable method definitions"
    assert result["capabilities"][0]["compiler_owned_self"]
    for capability in result["capabilities"][1:]:
        assert capability["name"].startswith("ide.")
    assert path.read_bytes() == original
    assert profile_path.read_bytes() == profile_bytes
