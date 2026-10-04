import copy
import hashlib
import json
import struct

from server.simulation_image_freshness import image_freshness


def fixture():
    artifact = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                           0x07230002, *([0] * 61), 0x4a000007)
    words = [0] * 256
    words[16:80] = struct.unpack(">64I", artifact)
    words[-32] = 16
    image = struct.pack("<256I", *words)
    digest = hashlib.sha256(image).hexdigest()
    body_hash = hashlib.sha256(artifact).hexdigest()
    provenance = {"image_sha256": digest, "artifactBindings": [{
        "slot": 7, "filename": "old.lump", "binaryHash": body_hash,
        "derivativeHash": body_hash}]}
    manifest = [{"filename": "old.lump", "abstraction": "WukongCallHome",
                 "token": "4a000007", "lump_version": 1}]
    # Namespace selection is already latest (and pinned); image is still old.
    state = {"abstractions": [{"slot": 7, "filename": "new.lump",
                              "token": "new", "artifact_pin": {"filename": "new.lump"}}]}
    return image, provenance, digest, state, manifest, artifact


def test_image_not_namespace_selection_supplies_executed_identity():
    image, provenance, digest, state, manifest, artifact = fixture()
    before = copy.deepcopy((provenance, state, manifest))
    def compare(actual):
        row = actual["abstractions"][0]
        assert row["filename"] == "old.lump"
        assert row["token"] == "4a000007"
        return {"status": "stale", "warnings": [{"selected": row, "latest": "new.lump"}]}
    report = image_freshness(image, provenance, digest, state, manifest,
                             compare, lambda name: artifact)
    assert report["status"] == "stale"
    assert report["basis"] == "verified-image"
    assert (provenance, state, manifest) == before


def test_missing_or_conflicting_evidence_stays_unknown():
    image, provenance, digest, state, manifest, artifact = fixture()
    def forbidden(_):
        raise AssertionError("unverified bytes reached comparison")
    for data, proof, requested, body in [
        (image, provenance, "0" * 64, artifact),
        (image, {}, digest, artifact),
        (image, provenance, digest, b"changed"),
        (image[:70] + b"\xff" + image[71:], provenance, digest, artifact),
        (image, {**provenance, "artifactBindings": []}, digest, artifact),
    ]:
        assert image_freshness(data, proof, requested, state, manifest,
                               forbidden, lambda name: body)["status"] == "unknown"


def test_matching_image_can_be_current():
    image, provenance, digest, state, manifest, artifact = fixture()
    result = image_freshness(image, provenance, digest, state, manifest,
                             lambda rows: {"status": "current", "warnings": []},
                             lambda name: artifact)
    assert result["status"] == "current"
    assert result["imageHash"] == digest


def test_real_comparator_ignores_changed_namespace_sequence(tmp_path):
    from server.app import _boot_execution_freshness
    image, provenance, digest, state, manifest, artifact = fixture()
    (tmp_path / "old.lump").write_bytes(artifact)
    newer = bytearray(artifact)
    newer[4:8] = (0x07230020).to_bytes(4, "big")
    (tmp_path / "new.lump").write_bytes(newer)
    manifest.append({**manifest[0], "filename": "new.lump", "lump_version": 2})
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    def compare(rows):
        return _boot_execution_freshness(rows, str(tmp_path), require_evidence=True)
    results = []
    for sequence in (0, 1, 511):
        state["abstractions"][0].update(
            seq=sequence, resident=False, type="Abstract", ns_slot_policy="dynamic")
        (tmp_path / "ns-state.json").write_text(json.dumps(state))
        before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
        results.append(image_freshness(
            image, provenance, digest, state, manifest, compare,
            lambda name: (tmp_path / name).read_bytes()))
        assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before
    assert results[0] == results[1] == results[2]
    assert results[0]["status"] == "stale"
    assert results[0]["warnings"][0]["latest"]["filename"] == "new.lump"


def test_real_comparator_no_admissible_candidates_is_unknown(tmp_path):
    from server.app import _boot_execution_freshness
    image, provenance, digest, state, manifest, artifact = fixture()
    (tmp_path / "old.lump").write_bytes(artifact)
    # Preserve the verified old resident, but let catalog candidates have
    # incompatible SELF authority. Empty comparison is not proof of current.
    incompatible = bytearray(artifact)
    incompatible[-4:] = (0x4a010007).to_bytes(4, "big")
    (tmp_path / "other.lump").write_bytes(incompatible)
    (tmp_path / "manifest.json").write_text(json.dumps([
        {**manifest[0], "filename": "other.lump", "lump_version": 3}]))
    result = image_freshness(
        image, provenance, digest, state, manifest,
        lambda rows: _boot_execution_freshness(rows, str(tmp_path), require_evidence=True),
        lambda name: (tmp_path / name).read_bytes())
    assert result["status"] == "unknown"