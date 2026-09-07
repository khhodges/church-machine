import hashlib
import json

import pytest

from server.lump_approvals import read_approvals, write_approvals


DIGEST = "a" * 64


def _selftest_approval():
    identity_string = "SelfTest#79"
    return {
        "binary_hash": DIGEST,
        "filename": "SelfTest.79.eceee227.lump",
        "dot_name": "SelfTest",
        "issue_n": 79,
        "identity_string": identity_string,
        "identity_hash": hashlib.sha256(identity_string.encode()).hexdigest(),
        "identity_seal_location": "approval",
        "token": "ee750c1b",
        "abstraction": "SelfTest",
        "grants": ["E"],
        "capability_type": "inform",
    }


def test_selftest_builder_approval_shape_round_trips_through_production_loader(tmp_path):
    path = tmp_path / "approvals.json"
    record = _selftest_approval()
    write_approvals(path, {DIGEST: record})

    assert read_approvals(path) == {DIGEST: record}


def test_legacy_approval_without_optional_identity_metadata_remains_valid(tmp_path):
    path = tmp_path / "approvals.json"
    record = {
        "binary_hash": DIGEST,
        "dot_name": "SelfTest",
        "issue_n": 1,
        "identity_hash": hashlib.sha256(b"SelfTest#1").hexdigest(),
    }
    write_approvals(path, {DIGEST: record})

    assert read_approvals(path)[DIGEST] == record


@pytest.mark.parametrize("changes, message", [
    ({"identity_string": 79}, "identity_string"),
    ({"identity_string": "SelfTest#78"}, "canonical identity"),
    ({"identity_hash": "0" * 64}, "SHA-256 of identity_string"),
    ({"identity_seal_location": "c-list[0]"}, "identity_seal_location"),
])
def test_identity_metadata_fails_closed_when_invalid(tmp_path, changes, message):
    path = tmp_path / "approvals.json"
    record = dict(_selftest_approval(), **changes)
    path.write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {DIGEST: record},
    }))

    with pytest.raises(ValueError, match=message):
        read_approvals(path)


def test_unsupported_approval_fields_still_fail_closed(tmp_path):
    path = tmp_path / "approvals.json"
    record = dict(_selftest_approval(), unsupported=True)
    path.write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {DIGEST: record},
    }))

    with pytest.raises(ValueError, match="unsupported fields"):
        read_approvals(path)


def test_existing_repository_approval_store_loads_unchanged():
    path = "server/lumps/approvals.json"
    before = open(path, "rb").read()

    approvals = read_approvals(path, missing_ok=False)

    assert approvals
    assert open(path, "rb").read() == before