import copy
import hashlib
import json
import struct

import pytest

import server.app as app_module
from server.lump_approvals import compiler_tcb_key
from server.lump_approvals import sign_compiler_record, write_approvals


@pytest.fixture(autouse=True)
def _dedicated_compiler_key(monkeypatch):
    monkeypatch.setenv("M_BIT_IDE_SECRET", "compiler-test-secret-" + "a" * 32)


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


def test_missing_or_historical_default_compiler_key_fails_closed(monkeypatch):
    words = [0xF8000401, 0x1F000000]
    record, digest = _record(words)
    monkeypatch.delenv("M_BIT_IDE_SECRET", raising=False)
    assert not app_module._verify_compiler_attestation(
        record, digest, len(words), 1, 1)

    forged = copy.deepcopy(record)
    forged["attestation"] = app_module.hmac.new(
        compiler_tcb_key("dev-secret-key"),
        app_module._canonical_compiler_record(forged),
        hashlib.sha256,
    ).hexdigest()
    monkeypatch.setenv("M_BIT_IDE_SECRET", "compiler-test-secret-" + "b" * 32)
    assert not app_module._verify_compiler_attestation(
        forged, digest, len(words), 1, 1)


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


def test_persisted_compiler_record_is_accepted_by_boot_delivery(tmp_path):
    from server.boot_image import _require_approved_executable_lump
    from server.lump_integrity import compute_number

    words = [0xF8000401, 0x1F000000] + [0] * 61 + [0x4A00000E]
    raw = struct.pack(">64I", *words)
    digest = hashlib.sha256(raw).hexdigest()
    dot_name = "CompiledBootFixture"
    issue = 1
    filename = f"{dot_name}.{issue}.{compute_number(dot_name, raw)}.lump"
    artifact = tmp_path / filename
    artifact.write_bytes(raw)
    identity_hash = hashlib.sha256(f"{dot_name}#{issue}".encode()).hexdigest()
    inner = sign_compiler_record({
        "binary_hash": digest,
        "source_hash": "b" * 64,
        "language": "assembly",
        "compiler_identity": "CLOOMC",
        "compiler_version": "test",
    }, signing_key=app_module._compiler_attestation_key())
    write_approvals(str(tmp_path / "approvals.json"), {digest: {
        "binary_hash": digest,
        "filename": filename,
        "dot_name": dot_name,
        "issue_n": issue,
        "identity_hash": identity_hash,
        "trust_origin": "trusted-home-ide",
        "compiler_identity": "CLOOMC",
        "compiler_version": "test",
        "compiler_record": inner,
    }})

    delivered = _require_approved_executable_lump(
        str(artifact), str(tmp_path), dot_name)
    assert delivered == words


def test_real_compile_finalize_save_and_boot_flow_rejects_tampering(
        tmp_path, monkeypatch):
    from server.boot_image import _require_approved_executable_lump

    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "revision": 0, "abstractions": [],
    }))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    source = "IADD DR1, DR0, #42\nRETURN\n"

    with app_module.app.test_client() as client:
        compiled_response = client.post("/api/compile", json={
            "source": source, "language": "assembly",
        })
        assert compiled_response.status_code == 200
        compiled = compiled_response.get_json()
        metadata = {
            "abstraction": "CompilerRouteFixture",
            "dot_name": "CompilerRouteFixture",
            "issue_n": 1,
            "source": source,
            "language": "assembly",
            "trust_origin": compiled["trust_origin"],
            "compiler_identity": compiled["compiler_identity"],
            "compiler_version": compiled["compiler_version"],
            "compiler_record": compiled["compiler_record"],
        }

        tampered_words = list(compiled["words"])
        tampered_words[1] ^= 1
        tampered = client.post("/api/lumps/finalize", json={
            "binary": tampered_words, "metadata": metadata,
        })
        assert tampered.status_code == 403

        finalized_response = client.post("/api/lumps/finalize", json={
            "binary": compiled["words"], "metadata": metadata,
        })
        assert finalized_response.status_code == 201
        finalized = finalized_response.get_json()
        metadata.update({
            "compiler_record": finalized["compiler_record"],
            "save_plan": finalized["plan"],
        })
        saved_response = client.post("/api/lumps/save", json={
            "binary": finalized["final_binary"], "metadata": metadata,
        })
        assert saved_response.status_code == 200
        saved = saved_response.get_json()
        assert saved["committed"] is True

    artifact = tmp_path / saved["filename"]
    delivered = _require_approved_executable_lump(
        str(artifact), str(tmp_path), "CompilerRouteFixture")
    assert delivered == finalized["final_binary"]