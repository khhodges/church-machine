"""Shared planning references must never become implicit executable copies."""
import copy
import json

import pytest

from server.namespace_design_v1 import (
    FORMAT, DesignStore, digest, project, require_standalone_design, validate,
)


def design():
    return dict(format=FORMAT, capacityWords=16384, slotCount=64,
                outputProfile="api", rows=[
                    dict(slot=1, name="Boot.NS", kind="namespace", policy="Resident", sequence=0),
                    dict(slot=2, name="Boot.Thread", kind="thread", policy="Resident", sequence=0, words=256),
                    dict(slot=22, name="ide.Amoeba", kind="lump", policy="Resident", sequence=0, boot=True),
                    dict(slot=23, name="ide.SecurityRegulator", kind="lump", policy="Resident", sequence=0),
                ])


def shared_design(tmp_path):
    source = design()
    folder = tmp_path / "design-drafts/copies" / ("a" * 32)
    folder.mkdir(parents=True)
    (folder / "design.json").write_text(json.dumps(source))
    (folder / "metadata.json").write_text(json.dumps(dict(name="Boot.Services")))
    app = copy.deepcopy(source)
    app["capacityWords"] = 8192
    for slot in (11, 12):
        app["rows"].append(dict(slot=slot, name=f"Thread.{slot-9}", kind="thread",
                                policy="Resident", sequence=0, words=256))
    for row in app["rows"]:
        if row["kind"] == "lump":
            row["sharedFrom"] = dict(designId="a"*32, slot=row["slot"], fingerprint=digest(source))
    return source, app, folder


def test_shared_residents_no_local_duplicates_and_correct_capacity_header(tmp_path):
    _, app, _ = shared_design(tmp_path)
    result = project(validate(app), tmp_path)
    assert result["usedWords"] == 256 + 3*256
    assert (result["metadataWords"][0] >> 23) & 15 == 0
    assert result["sharedResidentCount"] == 2
    assert result["sharedPhysicalWords"] is None
    assert result["buildReady"] is result["activationAllowed"] is False
    for row in result["rows"]:
        if "sharedFrom" in row:
            assert row["allocationWords"] == 0
            assert row["location"] is None
            assert row["sharingVerified"] is False
            assert row["sharedSourceLabel"] == "Boot.Services"
    assert all("unverified" in warning for warning in result["warnings"])


def test_source_change_is_visible_and_not_silently_followed(tmp_path):
    source, app, folder = shared_design(tmp_path)
    source["rows"][1]["words"] = 512
    (folder / "design.json").write_text(json.dumps(source))
    assert all("Shared source changed" in w for w in project(app, tmp_path)["warnings"])


def test_missing_source_stays_unresolved(tmp_path):
    _, app, folder = shared_design(tmp_path)
    (folder / "design.json").unlink()
    assert all("invalid shared reference" in w for w in project(app, tmp_path)["warnings"])


def test_different_selected_bytes_cannot_claim_sharing(tmp_path):
    _, app, _ = shared_design(tmp_path)
    app["rows"][2]["selection"] = dict(filename="other.lump", binaryHash="0"*64)
    assert "same exact artifact" in project(app, tmp_path)["warnings"][0]


@pytest.mark.parametrize("change", [
    lambda r: r["sharedFrom"].update(designId="../../outside"),
    lambda r: r["sharedFrom"].update(slot=True),
    lambda r: r["sharedFrom"].update(fingerprint="unverified"),
    lambda r: r.update(policy="Lazy"),
    lambda r: r["sharedFrom"].update(extra=True),
])
def test_invalid_shared_reference_rejected(tmp_path, change):
    _, app, _ = shared_design(tmp_path)
    change(app["rows"][2])
    with pytest.raises(ValueError):
        validate(app)


@pytest.mark.parametrize("capacity", [True, 4096, 12000, 32768])
def test_invalid_capacity_rejected(capacity):
    doc = design()
    doc["capacityWords"] = capacity
    with pytest.raises(ValueError):
        validate(doc)


def test_standalone_paths_reject_shared_or_reduced_designs(tmp_path):
    from server.design_simulation import configuration, selected_rows
    from server.namespace_binding_report import binding_report
    _, app, _ = shared_design(tmp_path)
    for check in (require_standalone_design, configuration, selected_rows):
        with pytest.raises(ValueError, match="combined-image"):
            check(app)
    with pytest.raises(ValueError, match="combined-image"):
        binding_report(app, tmp_path, digest(app), bind_now=True)
    reduced = design()
    reduced["capacityWords"] = 8192
    with pytest.raises(ValueError, match="combined-image"):
        require_standalone_design(reduced)
    require_standalone_design(design())
    require_standalone_design(dict(rows=[]))  # Legacy binding-report callers.


def test_shared_draft_roundtrip_without_binding(tmp_path):
    _, app, _ = shared_design(tmp_path)
    legacy = tmp_path / "ns-state.json"
    legacy.write_text('{"abstractions":[]}')
    path = tmp_path / "application.json"
    path.write_text(json.dumps(design()))
    store = DesignStore(path, tmp_path, legacy)
    result = store.save(dict(document=app, fingerprint=digest(design()), bind=False))
    assert result["persisted"] and not result["bindingRequested"]
    assert store.read_document() == app
    assert json.loads(legacy.read_text()) == {"abstractions": []}
