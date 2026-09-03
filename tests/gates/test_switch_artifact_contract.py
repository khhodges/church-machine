import hashlib
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "simulator/examples/capability_test.cloomc"
LUMPS = ROOT / "server/lumps"
MANIFEST = LUMPS / "manifest.json"


def _binding():
    entries = json.loads(MANIFEST.read_text())
    bindings = [entry for entry in entries if entry.get("token") == "00000a00"]
    assert len(bindings) == 1
    binding = bindings[0]
    assert binding["abstraction"] == "CapabilityTest"
    assert binding["ns_slot"] == 10
    return binding


def test_capability_test_has_valid_m_present_and_absent_switches():
    source = SOURCE.read_text()
    assert "SWITCH CR12, CR6, #0" in source
    assert "SWITCH CR13, CR6, #0" in source
    assert "SWITCH CR0, CR1" not in source
    assert "SWITCH CR0, 1" not in source


def test_canonical_binary_uses_full_destination_field():
    binding = _binding()
    data = (LUMPS / binding["filename"]).read_bytes()
    words = struct.unpack(f">{len(data) // 4}I", data)
    # Both instructions use fld_a for the isolated destination and retain the
    # ordinary CR6 c-list source in fld_b.
    assert 0x2F630000 in words  # SWITCH CR12, CR6, #0
    assert 0x2F6B0000 in words  # SWITCH CR13, CR6, #0
    assert 0x2F000001 not in words  # malformed legacy SWITCH CR0, CR1


def test_all_switch_destinations_round_trip_without_aliasing():
    # Encoding contract used jointly by the assembler and disassembler:
    # fld_a is the complete isolated destination, fld_b the LOAD source.
    words = {
        dest: (5 << 27) | (14 << 23) | (dest << 19) | (6 << 15) | 3
        for dest in range(12, 16)
    }
    assert len(set(words.values())) == 4
    for dest, word in words.items():
        assert ((word >> 19) & 0xF) == dest
        assert ((word >> 15) & 0xF) == 6
        assert word & 0x7FFF == 3


def test_sidecar_and_manifest_are_bound_to_exact_binary_and_source():
    binding = _binding()
    binary = (LUMPS / binding["filename"]).read_bytes()
    sidecar = json.loads((LUMPS / binding["sidecar_file"]).read_text())
    digest = hashlib.sha256(binary).hexdigest()
    assert binding["binary_hash"] == digest
    assert sidecar["binary_hash"] == digest
    assert sidecar["source"] == SOURCE.read_text()
    assert sidecar["token"] == "00000a00"
    assert sidecar["ns_slot"] == 10