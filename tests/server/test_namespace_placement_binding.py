import copy
import hashlib
import struct

from server.namespace_placement_binding import placement_document, bind_saved_placements


def test_exact_selection_not_stale_parent_and_no_input_mutation():
    rows = [dict(slot=12, name="ide.Mint", seq=7, filename="old.lump",
                 binary_hash="old", token="old",
                 selection=dict(filename="chosen.lump", binary_hash="chosen",
                                token="chosen", lump_version=2))]
    before = copy.deepcopy(rows)
    item = placement_document(rows)["rows"][0]
    assert item["selection"] == dict(filename="chosen.lump", binaryHash="chosen",
                                     token="chosen", revision=2)
    assert item["sequence"] == 7
    assert rows == before


def test_missing_digest_is_not_filled_from_parent():
    row = dict(slot=12, name="ide.Mint", binary_hash="stale",
               selection=dict(filename="selected.lump"))
    assert placement_document([row])["rows"][0]["selection"]["binaryHash"] is None


def test_unfinished_placement_stays_saved_and_not_ready(tmp_path):
    rows = [dict(slot=12, name="ide.Mint", seq=3, symbolic=True,
                 type="Inform", selection={"status": "missing"})]
    result = bind_saved_placements(rows, tmp_path, "exact")
    assert result["installed"] is False
    assert result["lists"][0]["status"] == "blocked"
    assert "No exact saved LUMP" in result["lists"][0]["reason"]
    assert list(tmp_path.iterdir()) == []


def test_tampered_artifact_is_not_bound(tmp_path):
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                      0x07230002, *([0] * 61), 0)
    (tmp_path / "mint.lump").write_bytes(raw)
    rows = [dict(slot=12, name="ide.Mint", seq=0,
                 selection=dict(filename="mint.lump", binary_hash="0" * 64))]
    result = bind_saved_placements(rows, tmp_path, "exact")
    assert "hash changed" in result["lists"][0]["reason"]
    assert (tmp_path / "mint.lump").read_bytes() == raw
    assert result["installed"] is False


def test_native_gt_is_not_a_substitute_for_authenticated_binding(tmp_path):
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                      0x07230002, *([0] * 61), 0x4a000007)
    (tmp_path / "mint.lump").write_bytes(raw)
    rows = [dict(slot=12, name="ide.Mint", seq=0,
                 filename="mint.lump", binary_hash=hashlib.sha256(raw).hexdigest())]
    result = bind_saved_placements(rows, tmp_path, "exact")
    assert result["lists"][0]["status"] == "blocked"
    assert "Existing GTs were not reused" in result["lists"][0]["reason"]
    assert (tmp_path / "mint.lump").read_bytes() == raw
