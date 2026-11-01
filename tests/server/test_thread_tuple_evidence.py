"""Exact build annotations, using private images and no live state."""
import copy
import hashlib
import json
import struct

import pytest

from server.built_namespace_view import read_built_namespace
from server.built_thread_view import inspect_threads
from server.thread_tuple_evidence import capture, validate_design
from tests.server.test_built_thread_view import fixture


def design():
    return {"sizeWords": 256, "stackWords": 32, "tuples": [
        {"name": "Counter", "offset": 7, "policy": "preserve",
         "fields": [{"name": "count", "type": "uint32", "size": 1, "initial": 123},
                    {"name": "label", "type": "utf8", "size": 5, "initial": "Hi"}]}]}


def sample():
    words, entries = fixture()
    for entry in entries:
        entry.update(w2=0, w3=0)
    entries.append({"slot": 0, "name": "Test.NS", "w0": 0, "w1": 0, "w2": 0, "w3": 0})
    image = struct.pack(f"<{len(words)}I", *words)
    raw = {"entries": entries, "nsTableBase": 2000}
    return image, raw


def test_capture_is_snapshot_not_initialization_or_geometry_replacement():
    image, raw = sample()
    before = bytes(image)
    approved = design()
    evidence = capture(image, raw, approved, {1, 11})
    approved["tuples"][0]["name"] = "EditedLater"
    threads = inspect_threads(image, raw["entries"], 2000, evidence)
    assert evidence["image_sha256"] == hashlib.sha256(image).hexdigest()
    assert len(evidence["threads"]) == 1  # heterogeneous Thread cannot inherit it
    assert threads[0]["heap"]["definitions"][0]["name"] == "Counter"
    assert threads[0]["heap"]["definitions"][0]["words"] == 4
    assert threads[0]["heap"]["definitions"][0]["offset"] == 7
    assert threads[1]["heap"]["definitionsStatus"] == "not-recorded"
    assert image == before
    assert threads[0]["heap"]["initialWords"][7] == 0  # not the intent value 123
    assert capture(image, raw, design(), set())["threads"] == []


@pytest.mark.parametrize("damage", [
    "missing", "image", "body", "slot", "descriptor", "duplicate", "geometry",
    "malformed", "version", "out-of-heap",
])
def test_stale_or_invalid_evidence_never_displays_definitions(damage):
    image, raw = sample()
    evidence = capture(image, raw, design(), {1})
    row = evidence["threads"][0]
    if damage == "missing":
        evidence = None
    elif damage == "image":
        image = image[:-4] + b"\1\0\0\0"
    elif damage == "body":
        row["body_sha256"] = "0" * 64
    elif damage == "slot":
        row["slot"] = 11
    elif damage == "descriptor":
        row["descriptor"][1] ^= 1 << 21
    elif damage == "duplicate":
        evidence["threads"].append(copy.deepcopy(row))
    elif damage == "geometry":
        row["design"]["stackWords"] = 64
    elif damage == "malformed":
        row["design"]["tuples"] = {}
    elif damage == "version":
        evidence["version"] = 99
    elif damage == "out-of-heap":
        row["design"]["tuples"][0]["offset"] = 9999
    thread = inspect_threads(image, raw["entries"], 2000, evidence)[0]
    assert thread["heap"]["definitionsStatus"] == "not-recorded"
    assert "definitions" not in thread["heap"]


@pytest.mark.parametrize("change", [
    lambda d: d.update(sizeWords=True),
    lambda d: d["tuples"][0].update(offset=-1),
    lambda d: d["tuples"].append(copy.deepcopy(d["tuples"][0])),
    lambda d: d["tuples"][0]["fields"][0].update(initial=2**32),
    lambda d: d["tuples"][0]["fields"][1].update(initial="\ud800"),
    lambda d: d["tuples"][0]["fields"][0].update(type="capability"),
])
def test_bad_approval_is_rejected(change):
    approved = design()
    change(approved)
    with pytest.raises(ValueError):
        validate_design(approved)


def test_read_only_projection_requires_outer_and_inner_image_binding(tmp_path):
    image, raw = sample()
    evidence = capture(image, raw, design(), {1})
    image_path, prov_path, state_path = [tmp_path / n for n in ("image", "prov", "state")]
    image_path.write_bytes(image)
    provenance = {"image_sha256": hashlib.sha256(image).hexdigest(),
                  "thread_tuple_evidence": evidence}
    prov_path.write_text(json.dumps(provenance))
    def read():
        return read_built_namespace(image_path, prov_path, state_path, lambda _: raw, lambda _: "")
    assert read()["threads"][0]["heap"]["definitionsStatus"] == "recorded"
    provenance["image_sha256"] = "bad"
    prov_path.write_text(json.dumps(provenance))
    assert read()["threads"][0]["heap"]["definitionsStatus"] == "not-recorded"
    prov_path.unlink()
    assert read()["threads"][0]["heap"]["definitionsStatus"] == "not-recorded"
    assert image_path.read_bytes() == image


def test_new_refresh_retains_evidence_without_changing_any_image_byte(tmp_path):
    from tests.server.test_namespace_image_refresh import fixture as refresh_fixture
    from server.namespace_image_refresh import reconstruct, RefreshStore
    cfg, rows = refresh_fixture(tmp_path)
    rows[1]["limit"] = 255
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    before, old = reconstruct(cfg, rows, tmp_path, compact=True)
    approved = design()
    approved["target"] = {"slot": 23, "sequence": 2, "namespaceSequence": 0,
                          "name": "AnyThread", "namespaceName": "Boot.NS"}
    cfg["threadTupleDesign"] = [approved]
    after, new = reconstruct(cfg, rows, tmp_path, compact=True)
    assert before == after
    assert "thread_tuple_evidence" not in old
    assert [r["slot"] for r in new["thread_tuple_evidence"]["threads"]] == [23]
    # The approved snapshot survives the reviewed build's on-disk retention.
    (tmp_path / "config.json").write_text(json.dumps(cfg))
    store = RefreshStore(tmp_path, tmp_path / "ns-state.json", tmp_path / "config.json")
    # Use the existing reviewed publication entry point rather than retrofitting a file.
    record = store.prepare("test-owner")
    store.commit(record["operationId"], "test-owner")
    committed = json.loads((tmp_path / "boot-image.provenance.json").read_text())
    assert committed["thread_tuple_evidence"] == new["thread_tuple_evidence"]


def test_independent_designs_never_cross_slots_or_generations():
    image, raw = sample()
    alice = design()
    alice["target"] = {"slot": 1, "sequence": 0, "namespaceSequence": 0,
                       "name": "Alice.Thread", "namespaceName": "Test.NS"}
    mallory = design()
    mallory.update(sizeWords=512, stackWords=64)
    mallory["tuples"][0]["name"] = "MalloryRecord"
    mallory["target"] = {"slot": 11, "sequence": 0, "namespaceSequence": 0,
                         "name": "Mallory.Thread", "namespaceName": "Test.NS"}
    evidence = capture(image, raw, [alice, mallory], {1, 11})
    threads = inspect_threads(image, raw["entries"], 2000, evidence)
    assert threads[0]["heap"]["definitions"][0]["name"] == "Counter"
    assert threads[1]["heap"]["definitions"][0]["name"] == "MalloryRecord"
    rebound = copy.deepcopy(raw)
    rebound["entries"][0]["name"] = "Replacement.Thread"
    evidence = capture(image, rebound, [alice, mallory], {1, 11})
    assert [t["slot"] for t in evidence["threads"]] == [11]
    assert inspect_threads(image, rebound["entries"], 2000, evidence)[0]["heap"]["definitionsStatus"] == "not-recorded"
    rebound["entries"][-1]["name"] = "Replacement.NS"
    assert capture(image, rebound, [alice, mallory], {1, 11})["threads"] == []
    alice["target"]["sequence"] = 1
    evidence = capture(image, raw, [alice, mallory], {1, 11})
    assert [t["slot"] for t in evidence["threads"]] == [11]
    mallory["target"]["namespaceSequence"] = 1
    assert capture(image, raw, [alice, mallory], {1, 11})["threads"] == []
