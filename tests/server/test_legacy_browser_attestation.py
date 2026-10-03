"""Browser assembly saves must earn exact-byte evidence before publication."""
import copy
import hashlib
import struct

import pytest
from bootstrap_test_support import isolate_application

isolate_application()
import server.app as app_module
from server.compile_api import run_compile
from test_lump_save_endpoint import isolated_lumps
from test_artifact_only_publication import publish

SOURCE = "; @abstraction ReplayProbe\ncapabilities { SELF E }\nHALT"
STRUCTURED_SOURCE = "abstraction ReplayProbe {\ncapabilities { SELF E }\nmethod Run {\nHALT\n}\n}"


@pytest.fixture(params=[SOURCE, STRUCTURED_SOURCE], ids=["assembly", "structured"])
def candidate(monkeypatch, request):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "test-only-browser-replay-" + "x" * 32)
    source = request.param
    result = run_compile({"source": source, "language": "auto", "tier": 2})
    assert result["ok"], result
    return {
        "original_source": source, "language": "assembly", "compiler_candidate": True,
        "abstraction": "ReplayProbe", "capabilities": result["capabilities"],
    }, result["words"]


def test_legacy_candidate_receives_verifiable_exact_byte_record(candidate):
    metadata, words = candidate
    result = app_module._attest_idx1_browser_candidate(metadata, words)
    digest = hashlib.sha256(struct.pack(f">{len(words)}I", *words)).hexdigest()
    assert result["trust_origin"] == "trusted-home-ide"
    assert app_module._trusted_compile_metadata(result, digest, words)
    assert "isa_profile" not in result["compiler_record"]
    assert "compiler_record" not in metadata


@pytest.mark.parametrize("tamper", ["code", "source", "capabilities", "name", "extent"])
def test_legacy_candidate_cannot_gain_evidence_for_mismatched_inputs(candidate, tamper):
    metadata, words = copy.deepcopy(candidate)
    if tamper == "code":
        words[2] ^= 1
    elif tamper == "source":
        metadata["original_source"] = SOURCE.replace("HALT", "RETURN")
    elif tamper == "capabilities":
        metadata["capabilities"][0]["rights"] = ["R", "W"]
    elif tamper == "name":
        metadata["abstraction"] = "SomeoneElse"
    else:
        words[0] += 1 << 10
    with pytest.raises(ValueError):
        app_module._attest_idx1_browser_candidate(metadata, words)


@pytest.mark.parametrize("language", ["assembly", ""])
@pytest.mark.parametrize("echo_evidence", [True, False])
def test_browser_save_publishes_boot_admissible_provenance(candidate, isolated_lumps, language, echo_evidence):
    import json
    from server.boot_image import _require_approved_executable_lump
    metadata, words = candidate
    metadata["language"] = language
    metadata.update(content_type="code", grants=["E"], methods=[], artifact_only=True)
    client = app_module.app.test_client()
    if not echo_evidence:
        raw_client = client
        class WithoutEvidenceEcho:
            def post(self, path, **kwargs):
                if path == "/api/lumps/save":
                    kwargs = copy.deepcopy(kwargs)
                    for key in ("compiler_record", "trust_origin",
                                "compiler_identity", "compiler_version"):
                        kwargs["json"]["metadata"].pop(key, None)
                return raw_client.post(path, **kwargs)
        client = WithoutEvidenceEcho()
    saved = publish(client, {"binary": words, "metadata": metadata})
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    row = next(r for r in manifest if r.get("abstraction") == "ReplayProbe")
    binary = isolated_lumps / row["filename"]
    accepted = _require_approved_executable_lump(
        str(binary), str(isolated_lumps), "browser Save regression")
    assert accepted
    assert saved.get("ns_slot") is None, "Save must not silently deploy a revision"


def test_browser_save_without_frozen_source_cannot_succeed_inert(candidate, isolated_lumps):
    metadata, words = candidate
    metadata.update(original_source=None, content_type="code", artifact_only=True)
    response = app_module.app.test_client().post(
        "/api/lumps/save-plan", json={"binary": words, "metadata": metadata})
    assert response.status_code == 403
    assert response.json["compiler_evidence_invalid"] is True
    assert response.json["committed"] is False


def test_existing_idx1_browser_replay_still_authenticates(monkeypatch):
    from test_idx1_save_endpoint import browser_candidate
    from server.idx1_profile import validate_execution
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "test-only-idx1-replay-" + "x" * 32)
    payload = browser_candidate()
    words = payload["binary"]
    raw = struct.pack(f">{len(words)}I", *words)
    execution = validate_execution(payload["metadata"], raw)
    result = app_module._attest_idx1_browser_candidate(payload["metadata"], words, execution)
    assert app_module._trusted_compile_metadata(result, hashlib.sha256(raw).hexdigest(), words)