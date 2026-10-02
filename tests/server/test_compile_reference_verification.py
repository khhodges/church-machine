import hashlib
import json

import pytest

from server import compile_reference_verification as verification


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    for key, suffix in {
        "CHURCH_TEST_LUMPS_DIR": "lumps",
        "CHURCH_TEST_BOOT_CONFIG_PATH": "config.json",
        "CHURCH_TEST_BUILD_SNAPSHOTS_DIR": "snapshots",
        "CHURCH_TEST_DB_PATH": "test.db",
    }.items():
        monkeypatch.setenv(key, str(tmp_path / suffix))
    monkeypatch.setenv("CHURCH_TEST_ISOLATED_MODE", "1")
    root = tmp_path / "lumps"
    root.mkdir()
    raw = b"exact-target-fixture"
    (root / "selected.lump").write_bytes(raw)
    (root / "manifest.json").write_text(json.dumps([
        {"token": "12345678", "filename": "selected.lump"}]))
    cap = {"name": "Target", "N": "example.Target#1", "T": "12345678",
           "binary_hash": hashlib.sha256(raw).hexdigest(),
           "identity_hash": hashlib.sha256(b"example.Target#1").hexdigest()}
    checked = dict(ok=True, trusted=True, identity_verified=True,
                   dot_name="example.Target", issue_n=1, cache_token=cap["T"],
                   binary_hash=cap["binary_hash"], identity_hash=cap["identity_hash"])
    calls = []

    def resolve(directory, token, actual):
        assert directory == root
        assert token == cap["T"]
        assert actual == raw
        calls.append(actual)
        return checked.copy()
    monkeypatch.setattr(verification, "resolve_canonical_lump", resolve)
    return root, cap, checked, calls


def test_exact_bytes_and_identity(fixture):
    root, cap, _, calls = fixture
    before = {p.name: p.read_bytes() for p in root.iterdir()}
    evidence = verification.verify_pinned_references([cap], root)
    assert evidence[0]["N"] == cap["N"]
    assert len(calls) == 1
    assert {p.name: p.read_bytes() for p in root.iterdir()} == before


@pytest.mark.parametrize("field,value", [
    ("trusted", False), ("identity_verified", False), ("ok", False),
    ("issue_n", 2), ("dot_name", "example.Other"),
    ("cache_token", "87654321"), ("identity_hash", "0" * 64),
    ("binary_hash", "0" * 64),
])
def test_identity_mismatch(fixture, field, value):
    root, cap, checked, _ = fixture
    checked[field] = value
    with pytest.raises(ValueError, match="identity could not be verified"):
        verification.verify_pinned_references([cap], root)


def test_mutation_rechecked_not_cached(fixture):
    root, cap, _, calls = fixture
    verification.verify_pinned_references([cap], root)
    (root / "selected.lump").write_bytes(b"changed")
    with pytest.raises(ValueError, match="binary hash mismatch"):
        verification.verify_pinned_references([cap], root)
    assert len(calls) == 1


def test_no_name_or_newer_revision_fallback(fixture):
    root, cap, _, calls = fixture
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps([{"token": "87654321", "name": "Target",
                                    "filename": "selected.lump"}]))
    with pytest.raises(ValueError, match="missing or ambiguous"):
        verification.verify_pinned_references([cap], root)
    assert not calls


def test_partial_or_unpinned(fixture):
    root, cap, _, calls = fixture
    assert verification.verify_pinned_references(
        [{"name": "SELF"}, {"name": "Unpinned"}], root) == []
    del cap["identity_hash"]
    with pytest.raises(ValueError, match="incomplete"):
        verification.verify_pinned_references([cap], root)
    assert not calls


def test_real_canonical_verifier_rejects_unapproved_bytes(fixture, monkeypatch):
    from server.lump_integrity import resolve_canonical_lump
    root, cap, _, _ = fixture
    monkeypatch.setattr(verification, "resolve_canonical_lump", resolve_canonical_lump)
    with pytest.raises(ValueError, match="identity could not be verified"):
        verification.verify_pinned_references([cap], root)


@pytest.fixture
def archive(fixture):
    from server.lump_integrity import compute_number
    from server.lump_approvals import write_approvals
    root, _, _, _ = fixture
    raw = ((31 << 27) | (1 << 10)).to_bytes(4, "big") + b"\0" * 252
    token = compute_number("example.Target", raw)
    digest = hashlib.sha256(raw).hexdigest()
    original = f"example.Target.1.{token}.lump"
    filename = original[:-5] + "_v2.lump"
    (root / filename).write_bytes(raw)
    cap = dict(name="Target", N="example.Target#1", T=token, binary_hash=digest,
               identity_hash=hashlib.sha256(b"example.Target#1").hexdigest())
    record = dict(filename=original, dot_name="example.Target", issue_n=1,
                  binary_hash=digest, identity_hash=cap["identity_hash"])
    write_approvals(root / "approvals.json", {digest: record})
    entries = [
        dict(filename=filename, token=token, binary_hash=digest, archived=True),
        # A successor must never replace the requested historical bytes.
        dict(filename="selected.lump", token=token, binary_hash="f" * 64),
    ]
    (root / "manifest.json").write_text(json.dumps(entries))
    return root, cap, filename, record, entries


def test_exact_archive_with_real_integrity_evidence(archive, monkeypatch):
    root, cap, _, _, _ = archive
    monkeypatch.setattr(verification, "resolve_canonical_lump",
                        lambda *args: pytest.fail("active resolution used for archive"))
    before = {p.name: p.read_bytes() for p in root.iterdir()}
    assert verification.verify_pinned_references([cap], root)[0]["N"] == cap["N"]
    assert {p.name: p.read_bytes() for p in root.iterdir()} == before


def test_archive_retaining_original_filename(archive):
    root, cap, filename, record, entries = archive
    (root / filename).rename(root / record["filename"])
    entries[0]["filename"] = record["filename"]
    (root / "manifest.json").write_text(json.dumps(entries))
    assert verification.verify_pinned_references([cap], root)[0]["T"] == cap["T"]


def test_archive_without_hash_index_is_not_guessed(archive):
    root, cap, _, _, entries = archive
    del entries[0]["binary_hash"]
    (root / "manifest.json").write_text(json.dumps(entries))
    with pytest.raises(ValueError, match="missing or ambiguous"):
        verification.verify_pinned_references([cap], root)


@pytest.mark.parametrize("mutation", [
    "bytes", "name", "approval", "issue", "identity_hash", "ambiguous", "missing",
    "bootstrap",
])
def test_archive_failures_never_fall_back(archive, mutation):
    from server.lump_approvals import write_approvals
    root, cap, filename, record, entries = archive
    if mutation == "bytes":
        (root / filename).write_bytes(b"changed")
    elif mutation == "missing":
        (root / filename).unlink()
    elif mutation == "name":
        (root / filename).rename(root / "wrong.lump")
        entries[0]["filename"] = "wrong.lump"
    elif mutation == "ambiguous":
        entries.append(entries[0].copy())
    else:
        if mutation == "issue":
            record["issue_n"] = 2
        if mutation == "identity_hash":
            record["identity_hash"] = "0" * 64
        if mutation == "bootstrap":
            record["bootstrap_t"] = "12345678"
            record["bootstrap_runtime_gt"] = 0x12345678
        write_approvals(root / "approvals.json",
                        {} if mutation == "approval" else {cap["binary_hash"]: record})
    (root / "manifest.json").write_text(json.dumps(entries))
    before = {p.name: p.read_bytes() for p in root.iterdir()}
    with pytest.raises((ValueError, OSError)):
        verification.verify_pinned_references([cap], root)
    assert {p.name: p.read_bytes() for p in root.iterdir()} == before