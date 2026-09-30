"""Independent deliverables retain exact bytes while drafts and aliases move."""
from concurrent.futures import ThreadPoolExecutor

import pytest

from server.artifact_revisions import RevisionStore


def test_namespace_and_bitstream_keep_their_exact_inputs(tmp_path):
    store = RevisionStore(str(tmp_path / "history"))
    source = tmp_path / "selected.lump"
    source.write_bytes(b"approved lump")
    first = store.publish("namespace", {"selected_lumps": [{"slot": 1, "token": "12345678"}]},
                          {"selected.lump": source.read_bytes(), "boot-image.bin": b"image one"})
    bit = store.publish("bitstream", {"namespace_revision_id": first, "source_commit": "a" * 40},
                        {"bitstream.bit": b"bit one"})
    source.write_bytes(b"newly published lump")
    second = store.publish("namespace", {"selected_lumps": [{"slot": 1, "token": "87654321"}]},
                           {"selected.lump": source.read_bytes(), "boot-image.bin": b"image two"})
    assert first != second
    assert open(store.file_path("namespace", first, "selected.lump"), "rb").read() == b"approved lump"
    assert store.read("bitstream", bit)["metadata"]["namespace_revision_id"] == first
    assert open(store.file_path("bitstream", bit, "bitstream.bit"), "rb").read() == b"bit one"


def test_concurrent_publish_is_idempotent_and_never_overwrites(tmp_path):
    store = RevisionStore(str(tmp_path))
    def publish(_):
        return store.publish("namespace", {"upstream": "a" * 64}, {"image.bin": b"original"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        revisions = list(pool.map(publish, range(12)))
    assert len(set(revisions)) == 1
    assert len(store.history("namespace")) == 1


def test_tampering_fails_closed_and_is_not_repaired_by_publication(tmp_path):
    store = RevisionStore(str(tmp_path))
    revision = store.publish("bitstream", {}, {"image.bit": b"approved"})
    path = store.file_path("bitstream", revision, "image.bit")
    with open(path, "wb") as stream:
        stream.write(b"tampered")
    with pytest.raises(ValueError, match="integrity"):
        store.read("bitstream", revision)
    with pytest.raises(ValueError, match="integrity"):
        store.publish("bitstream", {}, {"image.bit": b"approved"})


@pytest.mark.parametrize("name", ["../escape", ".", "revision.json", ""])
def test_reject_unsafe_file_names(tmp_path, name):
    with pytest.raises(ValueError):
        RevisionStore(str(tmp_path)).publish("namespace", {}, {name: b"bytes"})


def test_missing_and_invalid_upstream_revision_never_resolves_latest(tmp_path):
    store = RevisionStore(str(tmp_path))
    store.publish("namespace", {}, {"image.bin": b"current"})
    with pytest.raises(ValueError):
        store.read("namespace", "latest")
    with pytest.raises(FileNotFoundError):
        store.read("namespace", "0" * 64)