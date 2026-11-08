import struct
from server.development_image_view import add_lump_geometry, lump_geometry


def test_exact_geometry(tmp_path):
    words = [(31 << 27) | (5 << 10) | 3] + [0] * 63
    raw = struct.pack(">64I", *words)
    (tmp_path / "saved.lump").write_bytes(raw)
    expected = dict(sizeWords=64, sizeBytes=256, codeWords=5, codeBytes=20, clistRows=3)
    row = dict(kind="lump", filename="saved.lump")
    assert add_lump_geometry([row], tmp_path)[0]["geometry"] == expected
    assert lump_geometry(struct.pack("<64I", *words), "<") == expected
    assert lump_geometry(raw[:-4]) is None
    row["binaryHash"] = "0" * 64
    assert add_lump_geometry([row], tmp_path)[0]["geometry"] is None
    (tmp_path / "saved.lump").unlink()
    assert add_lump_geometry([row], tmp_path)[0]["geometry"] is None
