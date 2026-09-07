import json

from server.app import _resolve_lump_path
from server.lump_integrity import check_lump_canonical_integrity


def _write_manifest(tmp_path, rows):
    (tmp_path / "manifest.json").write_text(json.dumps(rows), encoding="utf-8")


def test_duplicate_token_resolves_when_rows_name_same_immutable_file(tmp_path):
    lump = tmp_path / "SelfTest.79.example.lump"
    lump.write_bytes(b"same immutable artifact")
    _write_manifest(tmp_path, [
        {"token": "ee750c1b", "filename": lump.name, "archived": True},
        {"token": "ee750c1b", "filename": lump.name},
    ])

    assert _resolve_lump_path("ee750c1b", str(tmp_path)) == str(lump)


def test_duplicate_token_rejects_conflicting_files(tmp_path):
    (tmp_path / "one.lump").write_bytes(b"one")
    (tmp_path / "two.lump").write_bytes(b"two")
    _write_manifest(tmp_path, [
        {"token": "ee750c1b", "filename": "one.lump"},
        {"token": "ee750c1b", "filename": "two.lump"},
    ])

    assert _resolve_lump_path("ee750c1b", str(tmp_path)) is None


def test_integrity_allows_history_and_current_rows_for_same_file(tmp_path):
    header = ((0x1F << 27) | 1).to_bytes(4, "big")
    raw = header + (b"\0" * ((64 * 4) - 4))
    lump = tmp_path / "SelfTest.79.example.lump"
    lump.write_bytes(raw)
    _write_manifest(tmp_path, [
        {"token": "ee750c1b", "filename": lump.name, "archived": True},
        {"token": "ee750c1b", "filename": lump.name},
    ])

    assert check_lump_canonical_integrity(
        str(tmp_path), "ee750c1b", raw
    ) is None