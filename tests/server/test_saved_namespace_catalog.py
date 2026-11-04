import json
import os

from server.saved_namespace_catalog import catalog


def test_all_statuses_and_saved_designs_are_visible_without_writes(tmp_path):
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    drafts = tmp_path / "design-drafts"
    drafts.mkdir()
    design = drafts / "ascending-v1.json"
    design.write_text('{"rows":[]}')
    os.utime(design, (2000000000, 2000000000))
    (snapshots / "build-approval-old.json").write_text('{"all_checks_pass":false}')
    records = [dict(revision_id=letter * 64, metadata={
        "approval_state": status, "test_status": testing,
        "created_at": "20261006T143256Z"}, files={"boot-image.bin": "x"})
        for letter, status, testing in [
            ("a", "approved", "Passed"), ("b", "unapproved", "Failed"),
            ("c", "draft", "Not tested")]]
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    rows = catalog(records, snapshots, tmp_path / "ns-state.json")
    assert len(rows) == 5
    assert rows[0]["name"] == "New Layout"
    assert rows[0]["preparation"] == "Needs preparation"
    assert {r["testing"] for r in rows} == {"Passed", "Failed", "Not tested"}
    assert any(r["preparation"] == "Preparation checks failed" for r in rows)
    assert before == {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    first = rows[0]["id"]
    design.write_text('{"rows":[1]}')
    assert next(r for r in catalog(records, snapshots, tmp_path / "ns-state.json")
                if r["name"] == "New Layout")["id"] != first


def test_malformed_design_remains_visible_and_linked_snapshot_is_not_duplicated(tmp_path):
    (tmp_path / "design-drafts").mkdir()
    (tmp_path / "design-drafts/phase1.json").write_text("broken")
    revision = "a" * 64
    (tmp_path / "build-approval-linked.json").write_text(
        json.dumps({"namespace_revision_id": revision}))
    rows = catalog([dict(revision_id=revision, files={}, metadata={})],
                   tmp_path, tmp_path / "ns-state.json")
    assert len(rows) == 2
    assert any(r["preparation"].startswith("Unreadable saved data") for r in rows)
