import json

import pytest

from server.approval_retention_audit import documented_approval_deletion


DIGEST = "a" * 64
NAME = "Old.1.12345678.lump"
TOKEN = "12345678"


@pytest.fixture
def evidence(tmp_path):
    row = dict(filename=NAME, binary_hash=DIGEST, version=1, deleted_at=100)
    approval = dict(filename=NAME, binary_hash=DIGEST, token=TOKEN)

    def check(*, update=None, manifest=None, document=None, ledger=None):
        value = {TOKEN: [dict(row, **(update or {}))]} if ledger is None else ledger
        (tmp_path / "history-retention.json").write_text(json.dumps(value))
        if document:
            for name, body in document.items():
                (tmp_path / name).write_text(json.dumps(body))
        return documented_approval_deletion(tmp_path, DIGEST, approval, manifest or [])
    return tmp_path, approval, check


@pytest.mark.parametrize("status", [None, "deleted"])
def test_completed_deletion(evidence, status):
    _, _, check = evidence
    assert check(update={"status": status})


@pytest.mark.parametrize("update", [
    {"status": "pending"}, {"filename": "Other.1.12345678.lump"},
    {"binary_hash": "b" * 64},
])
def test_incomplete_or_different_identity(evidence, update):
    assert not evidence[2](update=update)


@pytest.mark.parametrize("update", [
    {"deleted_at": None}, {"deleted_at": True}, {"deleted_at": 0},
    {"deleted_at": float("nan")}, {"version": True}, {"version": -1},
    {"status": "failed"}, {"filename": "../Old.lump"},
    {"filename": "dir\\Old.lump"}, {"binary_hash": "bad"},
])
def test_malformed_entries_fail_closed(evidence, update):
    with pytest.raises(ValueError):
        evidence[2](update=update)


@pytest.mark.parametrize("ledger", [[], {"bad": []}, {TOKEN: {}}, {TOKEN: [None]}])
def test_malformed_ledgers(evidence, ledger):
    with pytest.raises(ValueError):
        evidence[2](ledger=ledger)


def test_missing_ledger(tmp_path):
    assert not documented_approval_deletion(tmp_path, DIGEST, {"filename": NAME}, [])


def test_corrupt_json(evidence):
    root, approval, _ = evidence
    (root / "history-retention.json").write_text("{")
    with pytest.raises(ValueError):
        documented_approval_deletion(root, DIGEST, approval, [])


@pytest.mark.parametrize("kind", ["file", "dangling_alias", "journal"])
def test_surviving_file_or_pending_journal(evidence, kind):
    root, _, check = evidence
    if kind == "file":
        (root / NAME).write_bytes(b"wrong bytes")
    elif kind == "dangling_alias":
        (root / NAME).symlink_to("missing")
    else:
        (root / ".history-retention-pending.json").write_text("{}")
    assert not check()


@pytest.mark.parametrize("row", [
    {"filename": NAME}, {"filename": NAME, "archived": True},
    {"filename": "New.lump", "binary_hash": DIGEST},
])
def test_manifest_references(evidence, row):
    assert not evidence[2](manifest=[row])


@pytest.mark.parametrize("name,body", [
    ("ns-state.json", {"abstractions": [{"filename": NAME}]}),
    ("ns-state.json", {"abstractions": [{"binary_hash": DIGEST}]}),
    ("boot-config.json", {"filename": NAME}),
    ("boot-image.provenance.json", {"artifactBindings": [{"binary_hash": DIGEST}]}),
])
def test_selected_artifacts_never_exempted(evidence, name, body):
    assert not evidence[2](document={name: body})


def test_old_input_inventory_is_not_a_selection(evidence):
    assert evidence[2](document={
        "boot-image.provenance.json": {"sourceInputs": {NAME: DIGEST}}})


def test_wrong_approval_filename_or_token(evidence):
    _, approval, check = evidence
    approval["filename"] = "Other.lump"
    assert not check()
    approval["filename"] = NAME
    approval["token"] = "87654321"
    assert not check()


def test_pending_entry_cannot_reuse_old_completed_evidence(evidence):
    completed = dict(filename=NAME, binary_hash=DIGEST, version=1, deleted_at=100)
    assert not evidence[2](ledger={TOKEN: [
        completed, dict(completed, status="pending", version=2)]})


def test_selection_map_keys_are_references(evidence):
    assert not evidence[2](document={
        "boot-image.provenance.json": {"artifactBindings": {NAME: {}}}})


@pytest.mark.parametrize("field,value", [
    ("binary_hash", "b" * 64), ("source_binary_hash", "b" * 64),
])
def test_r4_keeps_approval_hash_integrity_checks(evidence, monkeypatch, field, value):
    from . import test_lump_consistency as consistency
    root, approval, check = evidence
    assert check()
    monkeypatch.setattr(consistency, "LUMPS_DIR", str(root))
    monkeypatch.setattr(consistency, "MANIFEST", [])
    monkeypatch.setattr(consistency, "_all_lump_filenames", lambda: [])
    monkeypatch.setattr(consistency, "APPROVALS", {
        DIGEST: dict(approval, **{field: value})})
    with pytest.raises(AssertionError, match="must equal its key"):
        consistency.TestR4_ApprovalStore().test_approval_keys_and_binary_hash_fields()
