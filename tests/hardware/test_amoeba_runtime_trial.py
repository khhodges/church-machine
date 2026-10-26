"""Exact isolated binding and retained model observations, not board acceptance."""
import json
import struct

from scripts.prepare_amoeba_runtime_trial import build, BASE


def test_runtime_reconstructs_with_only_approved_instruction_difference():
    candidate, evidence = build()
    retained = BASE / "new-layout-amoeba-runtime"
    assert (retained / "candidate-le.bin").read_bytes() == candidate
    assert json.loads((retained / "evidence.json").read_text()) == evidence
    assert len(candidate) == 65536
    parent = (BASE / "new-layout-change-runtime/candidate-le.bin").read_bytes()
    old, new = struct.unpack("<16384I", parent), struct.unpack("<16384I", candidate)
    assert [i for i, (a, b) in enumerate(zip(old, new)) if a != b] == [3653]
    assert new[3653] == 0x27010000
    assert new[3775] == 0x03a30002  # frozen root Thread version 419
    assert not evidence["uploaded"] and not evidence["hardwareCompatible"]


def test_retained_model_reaches_mallory_missing_row_without_executing_dread():
    _, evidence = build()
    result = json.loads((BASE / "new-layout-amoeba-runtime/full-program-result.json").read_text())
    assert result["imageSha256"] == evidence["sha256"]
    assert not result["physicalBoardTested"]
    assert not result["transportVerified"] and not result["installedBytesVerified"]
    # This is the observed BOUNDS result, NOT the comment's NO_CAPABILITY label.
    assert result["outcome"] == "fault" and result["faultCode"] == 8
    assert result["fetchAddress"] == 0x2e08
    assert result["faultInstruction"] == 0x070b0020
    assert result["registers"]["12"] == [0x0200000c, 0x2800, 255]
    addresses = [r["address"] for r in result["retired"]]
    assert addresses.count(0x350c) == 1
    assert addresses.count(0x3914) == 1
    assert addresses.count(0x3514) == 1
    assert addresses.count(0x390c) == 2
    assert 0x2c14 in addresses  # Alice RETURN
    assert 0x2e08 not in addresses and 0x2e0c not in addresses
