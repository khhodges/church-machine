import copy
import hashlib
import json
import struct

import server.app as app_module


def _record(words):
    raw = struct.pack(f">{len(words)}I", *words)
    binary_hash = hashlib.sha256(raw).hexdigest()
    header = words[0]
    record = {
        "schema": "church-compiler-output/v1",
        "compiler": "CLOOMC",
        "compiler_version": "test",
        "language": "assembly",
        "abstraction": "Fixture",
        "binary_hash": binary_hash,
        "source_hash": "a" * 64,
        "words": len(words),
        "cw": (header >> 10) & 0x1FFF,
        "cc": header & 0xFF,
        "static_validated": True,
    }
    record["attestation"] = app_module.hmac.new(
        app_module._compiler_attestation_key(),
        app_module._canonical_compiler_record(record),
        hashlib.sha256,
    ).hexdigest()
    return record, binary_hash


def test_matching_hash_without_server_attestation_is_not_trusted():
    words = [0xF8000401, 0x1F000000]
    record, digest = _record(words)
    forged = copy.deepcopy(record)
    forged.pop("attestation")
    assert not app_module._verify_compiler_attestation(
        forged, digest, len(words), 1, 1
    )


def test_tampered_attestation_or_record_is_rejected():
    words = [0xF8000401, 0x1F000000]
    record, digest = _record(words)
    tampered = copy.deepcopy(record)
    tampered["compiler_version"] = "forged"
    assert not app_module._verify_compiler_attestation(
        tampered, digest, len(words), 1, 1
    )

    tampered = copy.deepcopy(record)
    tampered["attestation"] = "0" * 64
    assert not app_module._verify_compiler_attestation(
        tampered, digest, len(words), 1, 1
    )


def test_server_attestation_validates_unchanged_record():
    words = [0xF8000401, 0x1F000000]
    record, digest = _record(words)
    assert app_module._verify_compiler_attestation(
        record, digest, len(words), 1, 1
    )


def test_persisted_attested_compiler_artifact_is_trusted_on_read(tmp_path, monkeypatch):
    words = [0xF8000401, 0x1F000000] + [0] * 62
    record, digest = _record(words)
    dot_name = "Fixture"
    issue = 1
    number = app_module._compute_filename_number(
        dot_name, struct.pack(">64I", *words))
    filename = f"{dot_name}.{issue}.{number}.lump"
    (tmp_path / filename).write_bytes(struct.pack(">64I", *words))
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "1234abcd",
        "filename": filename,
        "abstraction": dot_name,
        "provenance": "trusted-compiler",
        "compiler_record": record,
    }]))
    (tmp_path / "approvals.json").write_text(
        json.dumps({"version": 1, "algorithm": "sha256", "approvals": {}}))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    response = app_module.app.test_client().get("/api/lump/1234abcd")
    assert response.status_code == 200
    assert response.headers["X-Lump-Trust"] == "canonical"
    assert response.headers["X-Lump-Hash"] == f"sha256:{digest}"