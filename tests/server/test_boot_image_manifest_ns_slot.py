import hashlib
import json
import struct

from server import boot_image
from server.lump_integrity import compute_number


def _lump(marker=0):
    words = [(0x1F << 27) | (1 << 10), marker] + [0] * 62
    return struct.pack(">64I", *words)


def _approve(root, raw, filename, dot_name):
    digest = hashlib.sha256(raw).hexdigest()
    (root / "approvals.json").write_text(json.dumps({
        "version": 1,
        "algorithm": "sha256",
        "approvals": {digest: {
            "binary_hash": digest, "filename": filename,
            "dot_name": dot_name, "issue_n": 1,
            "identity_hash": hashlib.sha256(
                f"{dot_name}#1".encode()).hexdigest(),
        }},
    }))


def test_namespace_state_wins_over_manifest_placement(tmp_path):
    raw = _lump(0xAAAA)
    aaaa_name = f"aaaa.1.{compute_number('aaaa', raw)}.lump"
    other = _lump(0xBBBB)
    bbbb_name = f"bbbb.1.{compute_number('bbbb', other)}.lump"
    (tmp_path / aaaa_name).write_bytes(raw)
    (tmp_path / bbbb_name).write_bytes(other)
    _approve(tmp_path, raw, aaaa_name, "aaaa")
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "abstractions": [{
            "name": "Chosen", "slot": 9, "token": "aaaa0001",
            "filename": aaaa_name,
        }],
    }))
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "bbbb0002", "filename": bbbb_name,
        "abstraction": "Chosen", "ns_slot": 9, "boot_resident": True,
    }]))

    assert boot_image.find_lump_file_by_abstraction(
        str(tmp_path), "Chosen", 9
    ) == str(tmp_path / aaaa_name)


def test_manifest_placement_cannot_supply_missing_namespace_binding(tmp_path):
    raw = _lump()
    bbbb_name = f"bbbb.1.{compute_number('bbbb', raw)}.lump"
    (tmp_path / bbbb_name).write_bytes(raw)
    _approve(tmp_path, raw, bbbb_name, "bbbb")
    (tmp_path / "ns-state.json").write_text('{"abstractions":[]}')
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "bbbb0002", "filename": bbbb_name,
        "abstraction": "Chosen", "ns_slot": 9, "boot_resident": True,
    }]))

    assert boot_image.find_lump_file_by_abstraction(
        str(tmp_path), "Chosen", 9
    ) is None