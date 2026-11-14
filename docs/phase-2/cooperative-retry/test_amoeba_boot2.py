"""Preparation safety gates; RTL outcomes are retained separately, not guessed."""
import struct
import json

import pytest
import qualify_amoeba_boot2 as prep


@pytest.fixture(scope="module")
def prepared():
    return prep.prepare()


def test_exact_eleven_selections_and_input_preservation(prepared):
    images, receipt = prepared
    assert {r["slot"] for r in receipt["records"]} == {6, 7, 9, 10, 14, 15, 16, 17, 18, 19, 20}
    assert receipt["initiallyResidentExecutableSlots"] == [21]
    assert receipt["inputs"] == prep.verified_inputs()["files"]
    for mode, raw in images.items():
        assert len(raw) == 65536
        assert prep.sha(raw) == receipt["imageHashes"][mode]


def test_no_instruction_translation_and_exact_private_grants(prepared):
    images, receipt = prepared
    saved = struct.unpack(">2048I", prep.AMOEBA.read_bytes())
    for mode, raw in images.items():
        words = struct.unpack("<16384I", raw)
        assert words[1024:1024+2042] == saved[:-6]
        table = words[22*4]
        assert {i for i in range(64) if words[table+i]} == {r["slot"] for r in receipt["records"]}
        for r in receipt["records"]:
            slot, base, size = r["slot"], r["baseByte"]//4, r["sizeWords"]
            assert words[base] == r["words"][0] & ~(8191 << 10)
            assert not any(words[base+1:base+size])
            assert words[slot*4:slot*4+4] == words[r["grantSlot"]*4:r["grantSlot"]*4+4]
            assert words[table+slot] == 0x32000000 | r["grantSlot"]
            assert prep.sha(struct.pack(f"<{size}I", *r["words"])) == r["localizedSha256LE"]
    assert not receipt["instructionTranslation"]


def test_disjoint_allocation_and_preserved_devices(prepared):
    images, receipt = prepared
    ranges = receipt["ranges"]
    assert all(0 <= a < b <= 65536 for a, b, _ in ranges)
    for i, (a, b, _) in enumerate(ranges):
        assert all(b <= c or d <= a for c, d, _ in ranges[i+1:])
    original = struct.unpack("<16384I", (prep.SOURCE/"boot2.bin").read_bytes())
    for raw in images.values():
        words = struct.unpack("<16384I", raw)
        for slot in (1, 2, 3, 4, 5, 8, 11, 12, 13):
            assert words[slot*4:slot*4+4] == original[slot*4:slot*4+4]
        user_base = 768 if raw == images["mallory"] else 512
        frame = (words[user_base+17] & 0xfff) + 2
        assert words[user_base+frame] & 0xfff == frame
        assert (words[user_base+frame] >> 13) & 0x7fff == words[1027]-1
        assert words[user_base+243] == original[user_base+243]


def test_unresolved_references_are_reported_not_invented(prepared):
    _, receipt = prepared
    missing = {r["name"]: [b["name"] for b in r["bindingRows"] if b["status"] == "unresolved"]
               for r in receipt["records"]}
    assert missing["ide.Mint"] == ["ide.MintState", "ide.MintScratch", "ide.MintPool",
        "ide.MintV4Verifier", "ide.MintNamespace", "ide.MintApproval"]
    assert missing["ide.MintCleaner"] == ["ide.CleanerState", "ide.CleanerPool"]


def test_changed_saved_review_is_rejected(tmp_path, monkeypatch):
    fake = tmp_path / "review.lump"
    fake.write_bytes(b"not the saved review")
    monkeypatch.setattr(prep, "AMOEBA", fake)
    with pytest.raises(ValueError, match="Saved Amoeba review changed"):
        prep.verified_inputs()


def test_relocated_receiver_preserves_devices_and_saved_code(prepared):
    images, receipt = prep.prepare(receiver_base=0x40000100)
    original = struct.unpack("<16384I", (prep.SOURCE / "boot2.bin").read_bytes())
    assert receipt["knownMappingConflict"] is None
    assert receipt["receiverBase"] == 0x40000100
    for mode, raw in images.items():
        words = struct.unpack("<16384I", raw)
        previous = struct.unpack("<16384I", prepared[0][mode])
        assert {i for i, (a, b) in enumerate(zip(words, previous)) if a != b} == {92, 94, 96, 98}
        for slot in (3, 4, 5, 8, 13):
            assert words[slot*4:slot*4+4] == original[slot*4:slot*4+4]


@pytest.mark.parametrize("base", [0x4000001c, 0x40000028, 0x4000002c, 0x40000101, 0x80000000])
def test_conflicting_or_invalid_receiver_map_rejected(base):
    with pytest.raises(ValueError, match="overlaps|Invalid"):
        prep.prepare(receiver_base=base)


def test_private_system_grants_match_retained_descriptor_generation():
    images, receipt = prep.prepare(receiver_base=0x40000100, correct_system_gt=True)
    assert receipt["correctedSystemGT"]
    for mode, raw in images.items():
        words = struct.unpack("<16384I", raw)
        expected = (words[9] >> 21) & 511
        user = 768 if mode == "mallory" else 512
        assert (words[user+255] >> 16) & 511 == expected
        assert (words[1024+2047] >> 16) & 511 == expected
        assert words[user+255] == words[1024+2047]


def test_system_revision_loads_dependencies_before_original_checks(prepared):
    images, receipt = prep.prepare(receiver_base=0x40000100,
                                  correct_system_gt=True, system_loads=True)
    revision = receipt["systemRevision"]
    assert revision and "IADD DR1, DR0, #6" in revision["source"]
    assert "IADD DR1, DR0, #7" in revision["source"]
    source = revision["source"]
    assert source.index("CALL CR2, #1") < source.index("LOAD CR0, CR6, #1")
    assert "ISUB DR8, DR0, #1\nCHANGE CR6, #8\nBRANCHNE Start" in source
    assert "IADD DR1, DR5, #0\nLOAD CR2, CR6, #13\nCALL CR2, #1" in source
    old = {r["slot"]: r for r in prepared[1]["records"]}
    for record in receipt["records"]:
        if record["slot"] != 10:
            assert record["words"] == old[record["slot"]]["words"]
        else:
            assert record["words"][-1] == 0x4a000015
            assert record["words"][-14:-1] == old[10]["words"][-13:]
            assert record["words"] != old[10]["words"]


def test_self_consistent_replaced_boot2_manifest_is_rejected(tmp_path):
    (tmp_path / "boot2.bin").write_bytes(b"different image")
    (tmp_path / "manifest.json").write_text(json.dumps({
        "files": {"boot2.bin": prep.sha(b"different image")}}))
    with pytest.raises(ValueError, match="manifest differs from pinned"):
        prep.verified_inputs(tmp_path)


def test_replaced_boot2_image_is_rejected_before_manifest_walk(tmp_path):
    (tmp_path / "manifest.json").write_bytes((prep.SOURCE / "manifest.json").read_bytes())
    (tmp_path / "boot2.bin").write_bytes(b"different image")
    with pytest.raises(ValueError, match="image differs from pinned"):
        prep.verified_inputs(tmp_path)


def test_self_consistent_replaced_rtl_manifest_is_rejected(tmp_path):
    from replay_amoeba_boot2 import verify_snapshot
    (tmp_path / "starter-source-manifest.json").write_text('{"files": {}}')
    with pytest.raises(ValueError, match="RTL manifest differs from pinned"):
        verify_snapshot(tmp_path)


def test_committed_receipts_match_exact_observed_inputs():
    from pathlib import Path
    evidence = Path(__file__).parent / "evidence" / "amoeba-boot2"
    receipt = json.loads((evidence / "preparation.json").read_text())
    assert receipt["originalSha256"] == prep.BOOT2_SHA
    assert receipt["amoebaSha256"] == prep.AMOEBA_SHA
    from replay_amoeba_boot2 import RTL_MANIFEST_SHA
    assert prep.sha((evidence / "starter-source-manifest.json").read_bytes()) == RTL_MANIFEST_SHA
    assert prep.sha((evidence / "input-manifest.json").read_bytes()) == prep.INPUT_MANIFEST_SHA
    for mode in ("system", "alice", "mallory"):
        result = json.loads((evidence / f"{mode}-replay.json").read_text())
        assert result["imageSha256"] == receipt["imageHashes"][mode]
        assert result["rtlManifestSha256"] == RTL_MANIFEST_SHA
        assert result["admission"] == "READY"
        assert result["fault"] == (17 if mode == "system" else 29)
