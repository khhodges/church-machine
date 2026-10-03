"""Generated design assignments must not masquerade as saved executables."""
import copy
import hashlib
import json

import pytest

from server import boot_image as boot
from server.change_confirmation import describe_boot_image_generation, resolve_saved_lump_versions


CONFIG = {"step1": {"threadCount": 3}}


def thread(slot, **changes):
    return dict({"slot": slot, "name": "Arbitrary name", "type": "Inform",
                 "load_policy": "Resident"}, **changes)


@pytest.mark.parametrize("slot", [1, 11, 12])
def test_design_assignment_not_a_saved_artifact(slot):
    row = thread(slot)
    assert boot.generated_thread_assignment(row, CONFIG)
    assert not boot.image_artifact_selected(row, CONFIG)
    assert boot.image_artifact_selected(row)  # no design evidence, no exemption
    assert not boot.generated_thread_assignment(
        thread(slot, filename="selected.lump"), CONFIG)
    assert boot.image_artifact_selected(
        thread(slot, filename="selected.lump"), CONFIG)


@pytest.mark.parametrize("row", [
    thread(20, name="Boot.Thread"),
    thread(12, filename=""),
    thread(11, filename="../bad.lump"),
])
def test_missing_or_invalid_saved_locator_is_not_exempt(tmp_path, row):
    for name in ("manifest.json", "approvals.json"):
        (tmp_path / name).write_text("{}")
    with pytest.raises(ValueError, match="exact filename"):
        boot.copy_selected_image_inputs(tmp_path, tmp_path / "stage", [row], CONFIG)


def test_copy_preserves_saved_thread_and_skips_only_design_bodies(tmp_path):
    for name in ("manifest.json", "approvals.json"):
        (tmp_path / name).write_text("{}")
    (tmp_path / "saved.lump").write_bytes(b"exact saved continuation")
    rows = [thread(1), thread(11), thread(12, filename="saved.lump", type="Thread")]
    boot.copy_selected_image_inputs(tmp_path, tmp_path / "stage", rows, CONFIG)
    assert (tmp_path / "stage" / "saved.lump").read_bytes() == b"exact saved continuation"
    assert {p.name for p in (tmp_path / "stage").iterdir()} == {
        "manifest.json", "approvals.json", "saved.lump"}


def test_preparation_and_review_resolve_exact_versions(tmp_path, monkeypatch):
    import server.app as app
    old, new = b"old immutable bytes", b"new immutable bytes"
    for name, raw in (("old.lump", old), ("new.lump", new)):
        (tmp_path / name).write_bytes(raw)
    manifest = [
        dict(abstraction="Example", filename="old.lump", token="old", lump_version=34),
        dict(abstraction="Example", filename="new.lump", token="new", lump_version=39),
    ]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    rows = [thread(1), thread(11), thread(12), dict(
        slot=10, name="Example", type="Inform", load_policy="Resident", boot=True,
        filename="old.lump", token="old", lump_version=34,
        binary_hash=hashlib.sha256(old).hexdigest())]
    original = copy.deepcopy(rows)
    admitted = []
    # This unit isolates candidate selection; production admission remains mandatory.
    monkeypatch.setattr(app._boot_image_gen, "_require_approved_executable_lump",
                        lambda path, *args: admitted.append(path))
    prepared, changes = app._prepare_run_candidates(
        rows, str(tmp_path), config=CONFIG,
        artifact_pins={"10": dict(filename="new.lump", token="new", revision=39)})
    assert rows == original
    assert prepared[:3] == rows[:3]
    assert [change["slot"] for change in changes] == [10]
    assert admitted == [str(tmp_path / "new.lump")]
    digest = lambda record: hashlib.sha256((tmp_path / record["filename"]).read_bytes()).hexdigest()
    review = "\n".join(describe_boot_image_generation(
        resolve_saved_lump_versions(rows, manifest, digest),
        resolve_saved_lump_versions(prepared, manifest, digest), 10, prepare_run=True))
    assert "old.lump saved version 34 → new.lump saved version 39" in review
    assert "Saved LUMP catalogue revisions: unchanged" in review
    with pytest.raises(ValueError, match="non-executable"):
        app._prepare_run_candidates(rows, str(tmp_path), config=CONFIG,
                                    artifact_pins={"11": {}})


def test_genuine_missing_executable_is_rejected(tmp_path):
    import server.app as app
    (tmp_path / "manifest.json").write_text("[]")
    with pytest.raises(ValueError, match="filename"):
        app._prepare_run_candidates([thread(20, boot=True)], str(tmp_path), config=CONFIG)