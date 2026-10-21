"""File packaging must not change decoded identity or weaken upload admission."""
import base64
import gzip
import hashlib
import json
import struct

import pytest

from server.lump_file import MAX_LUMP_BYTES, pack_lump, unpack_lump
from server.lump_variants import read_variant, summary


def binary():
    words = [0] * 64
    words[0] = 0xF8000401
    words[1] = 0xF8000000
    words[-1] = 0x0A000002
    return struct.pack(">64I", *words)


def test_file_roundtrip_and_legacy():
    raw = binary()
    packed = pack_lump(raw)
    assert packed[:2] == b"\x1f\x8b"
    assert len(packed) < len(raw)
    assert pack_lump(raw) == packed
    assert unpack_lump(packed) == unpack_lump(raw) == raw


@pytest.mark.parametrize("damage", [
    lambda p: p[:-1],
    lambda p: p + b"trailing",
    lambda p: p + p,
    lambda p: p[:-8] + bytes([p[-8] ^ 1]) + p[-7:],
])
def test_corrupt_files_rejected(damage):
    with pytest.raises(ValueError):
        unpack_lump(damage(pack_lump(binary())))


def test_wrong_geometry_and_expansion_limit():
    for data in (b"", b"not a lump", binary() + b"\0" * 4,
                 gzip.compress(b"\0" * (MAX_LUMP_BYTES + 1))):
        with pytest.raises(ValueError):
            unpack_lump(data)


def test_legacy_bundle_remains_readable(tmp_path):
    raw = binary()
    profile = {"sha256": hashlib.sha256(raw).hexdigest(),
               "bytes": len(raw), "data": base64.b64encode(raw).decode()}
    bundle = {"schema": 2, "primary_sha256": profile["sha256"],
              "profiles": {"api": profile}}
    bundle_id = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).hexdigest()
    bundle["bundle_id"] = bundle_id
    path = tmp_path / (bundle_id + ".variants.json")
    original = json.dumps(bundle)
    path.write_text(original)
    assert read_variant(tmp_path, bundle_id, "api")[0] == raw
    assert summary(bundle)["api"]["encoding"] == "gzip"
    assert path.read_text() == original


def test_upload_raw_and_gzip_keep_identity_and_quarantine(tmp_path, monkeypatch):
    from server import app as app_module
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    raw = binary()
    digest = hashlib.sha256(raw).hexdigest()
    with app_module.app.test_client() as client:
        def upload(data):
            payload = {"name": "FilePackagingTest", "data_b64": base64.b64encode(data).decode()}
            response = client.post("/api/lumps/upload-lump", json=payload)
            if response.status_code == 428:
                response = client.post("/api/lumps/upload-lump", json=payload, headers={
                    "X-Change-Confirmation": response.json["change_confirmation"]["id"]})
            return response
        results = []
        for data in (raw, pack_lump(raw)):
            response = upload(data)
            assert response.status_code == 200, response.json
            results.append(response.json)
            assert response.json["quarantined"] is True
            assert response.json["executable"] is False
            assert response.json["binary_hash"] == digest
        assert results[0] == results[1]
        assert (tmp_path / "quarantine" / (digest + ".lump")).read_bytes() == raw
        before = sorted(p.name for p in (tmp_path / "quarantine").iterdir())
        bad = upload(pack_lump(raw)[:-1])
        assert bad.status_code == 400
        assert bad.json["committed"] is False
        assert sorted(p.name for p in (tmp_path / "quarantine").iterdir()) == before
