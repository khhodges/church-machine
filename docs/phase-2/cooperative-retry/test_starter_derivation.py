"""Cheap source-provenance checks; these are not runtime acceptance."""
import hashlib
import json
from pathlib import Path

import pytest
from prepare_starter import prepare, IMAGE_HASHES


def test_preparation_refuses_existing_and_non_generated_destinations(tmp_path):
    with pytest.raises(ValueError, match="fresh directory"):
        prepare(tmp_path)
    with pytest.raises(ValueError, match="fresh directory"):
        prepare(tmp_path / "new")


def test_running_candidate_matches_its_source_receipt():
    import hardware.starter_top as starter
    root = Path(starter.__file__).resolve().parents[1]
    manifest = json.loads((root / "starter-source-manifest.json").read_text())
    assert tuple(IMAGE_HASHES.values()) == starter.IMAGE_SHA256
    assert manifest["applications"] == IMAGE_HASHES
    assert not manifest["vendorBuild"] and not manifest["physicalTest"]
    assert not manifest["programmingAuthorized"]
    for name, expected in manifest["files"].items():
        path = (root / name).resolve()
        assert path.is_relative_to(root)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, name
    for name, expected in manifest["retainedSources"].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
