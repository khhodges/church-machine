"""No live catalog, image, boot-config, or hardware is touched by these tests."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "built_namespace_view", ROOT / "server/built_namespace_view.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.fixture
def fixture(tmp_path):
    image = tmp_path / "image.bin"
    provenance = tmp_path / "provenance.json"
    state = tmp_path / "state.json"
    image.write_bytes(b"\0" * 64)
    raw = {"totalWords": 16, "maxEntries": 2, "nsTableBase": 8, "thread": None,
           "entries": [{"slot": 1, "w0": 12, "w1": 2, "w2": 3, "w3": 4}]}
    provenance.write_text(json.dumps({
        "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
        "namespace_fingerprint": "built",
        "resident_bindings": [
            {"slot": 1, "filename": "exact.old.lump", "artifact_sha256": "old-hash"},
            {"slot": 99, "filename": "not-in-image.lump"}]}))
    state.write_text(json.dumps({"abstractions": [{"name": "newer"}]}))
    def read():
        return module.read_built_namespace(
            image, provenance, state, lambda _: raw, lambda _: "newer")
    return image, provenance, state, raw, read


def test_membership_and_identity_use_built_evidence_only(fixture):
    image, provenance, state, raw, read = fixture
    before = [p.read_bytes() for p in (image, provenance, state)]
    result = read()
    assert [r["slot"] for r in result["entries"]] == [1]
    assert result["entries"][0]["filename"] == "exact.old.lump"
    assert result["savedNamespaceMatchesBuilt"] is False
    assert result["provenanceStatus"] == "verified"
    assert result["entries"][0]["w0"] == raw["entries"][0]["w0"]
    assert [p.read_bytes() for p in (image, provenance, state)] == before


def test_mismatched_provenance_cannot_name_built_entries(fixture):
    image, _, _, _, read = fixture
    image.write_bytes(b"\1" * 64)
    result = read()
    assert result["provenanceStatus"] == "mismatch"
    assert result["entries"][0]["filename"] is None
    assert result["builtNamespaceFingerprint"] is None
    assert result["savedNamespaceMatchesBuilt"] is None


def test_missing_image_never_falls_back(fixture):
    image, _, _, _, read = fixture
    image.unlink()
    with pytest.raises(FileNotFoundError):
        read()


def test_invalid_image_never_falls_back(fixture):
    image, _, _, _, read = fixture
    image.write_bytes(b"bad")
    with pytest.raises(ValueError):
        read()


def test_missing_provenance_still_displays_raw_descriptors(fixture):
    _, provenance, _, _, read = fixture
    provenance.unlink()
    result = read()
    assert result["provenanceStatus"] == "missing"
    assert result["entries"][0]["w3"] == 4
    assert result["entries"][0]["artifactSha256"] is None


def test_route_is_get_only_and_uses_read_only_helper():
    source = (ROOT / "server/app.py").read_text()
    start = source.index('@app.route("/api/boot-image/built-namespace"')
    end = source.index('@app.route("/api/boot-image/ns-state"', start)
    route = source[start:end]
    assert 'methods=["GET"]' in route
    assert "read_built_namespace(" in route
    for forbidden in ("_ensure_ns_state(", "_auto_regen", "_resolve_namespace_saved_artifacts("):
        assert forbidden not in route


def test_matching_namespace_supplies_names_without_changing_membership(fixture):
    image, provenance, state, raw, read = fixture
    p = json.loads(provenance.read_text())
    p["namespace_fingerprint"] = "newer"
    provenance.write_text(json.dumps(p))
    state.write_text(json.dumps({"abstractions": [
        {"slot": 1, "name": "Verified.Thread"},
        {"slot": 99, "name": "Not.In.Image"}]}))
    before = [x.read_bytes() for x in (image, provenance, state)]
    result = read()
    assert len(result["entries"]) == 1
    assert result["entries"][0]["name"] == "Verified.Thread"
    assert result["entries"][0]["nameSource"] == "matched-namespace"
    assert [x.read_bytes() for x in (image, provenance, state)] == before


def test_unmatched_namespace_cannot_supply_names(fixture):
    _, _, state, _, read = fixture
    state.write_text(json.dumps({"abstractions": [{"slot": 1, "name": "New.Name"}]}))
    assert read()["entries"][0]["name"] is None


def test_descriptor_decoding_uses_all_authority_bits(fixture):
    _, _, _, raw, read = fixture
    raw["entries"][0]["w1"] = (1 << 31) | (1 << 30) | (345 << 21) | 0x123456
    decoded = read()["entries"][0]["decoded"]
    assert decoded == {"location": 12, "limit": 0x123456, "sequence": 345,
                       "f": 1, "g": 1, "seal": 3, "accessGt": 4}


def test_device_artifact_is_not_applicable_only_with_verified_label(fixture):
    _, provenance, state, raw, read = fixture
    p = json.loads(provenance.read_text())
    p.update(namespace_fingerprint="newer", resident_bindings=[])
    provenance.write_text(json.dumps(p))
    state.write_text(json.dumps({"abstractions": [{"slot": 1, "name": "UART_DEV"}]}))
    raw["entries"][0]["w0"] = 0x40000014
    assert read()["entries"][0]["artifactStatus"] == "not-applicable"
    p["namespace_fingerprint"] = "different"
    provenance.write_text(json.dumps(p))
    assert read()["entries"][0]["artifactStatus"] == "unavailable"


def test_duplicate_verified_labels_do_not_supply_identity(fixture):
    _, provenance, state, _, read = fixture
    p = json.loads(provenance.read_text())
    p["namespace_fingerprint"] = "newer"
    provenance.write_text(json.dumps(p))
    state.write_text(json.dumps({"abstractions": [
        {"slot": 1, "name": "One"}, {"slot": 1, "name": "Two"}]}))
    assert read()["entries"][0]["name"] is None
