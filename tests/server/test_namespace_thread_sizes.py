"""Thread allocation follows the shared contract, without changing defaults."""
import copy
import struct
import json
import pytest
from server.namespace_design_v1 import validate, project, DesignStore, digest
from server.namespace_ascending_image import build_fresh_thread_lump
from server.boot_image import THREAD_SUPPORTED_BODY_WORDS, thread_layout


def design(size):
    return {
        "format": "ascending-nst-metadata-slot0-v1", "capacityWords": 16384,
        "slotCount": 64, "outputProfile": "api",
        "rows": [
            dict(slot=1, name="Boot.NS", kind="namespace", policy="Resident", sequence=0),
            dict(slot=2, name="Boot.Thread", kind="thread", policy="Resident", sequence=0, words=256),
            dict(slot=32, name="ide.B1.FreeThread", kind="thread", policy="Resident", sequence=0, words=size),
            dict(slot=40, name="ide.Entry", kind="lump", policy="Lazy", sequence=0, boot=True),
        ],
    }


@pytest.mark.parametrize("size", THREAD_SUPPORTED_BODY_WORDS)
def test_validation_placement_and_initialization(size, tmp_path):
    document = design(size)
    before = copy.deepcopy(document)
    validate(document)
    projection = project(document, tmp_path)
    rows = {row["slot"]: row for row in projection["rows"]}
    assert rows[2]["allocationWords"] == 256
    assert rows[32]["allocationWords"] == size
    assert rows[32]["limit"] == size - 1
    assert rows[32]["location"] >= rows[2]["location"] + 256
    raw = build_fresh_thread_lump(allocation_words=size, stack_words=32,
                                   entry_slot=21, entry_sequence=0)
    words = struct.unpack(f">{size}I", raw)
    layout = thread_layout(size, 32)
    assert len(words) == size
    assert 1 << (((words[0] >> 23) & 15) + 6) == size
    assert words[layout["caps_start"]] != 0
    assert words[layout["caps_start"] + 1] == 0
    assert document == before


@pytest.mark.parametrize("size", [0, 128, 300, 513, 16384, True, 512.0, "512", None])
def test_invalid_sizes_rejected(size):
    with pytest.raises(ValueError, match="Thread allocation"):
        validate(design(size))


def test_mixed_size_design_persists_without_binding(tmp_path):
    path = tmp_path / "draft.json"
    original = design(256)
    path.write_text(json.dumps(original))
    store = DesignStore(path, tmp_path / "lumps", tmp_path / "ns-state.json")
    updated = copy.deepcopy(original)
    updated["rows"][2]["words"] = 512
    result = store.save({"fingerprint": digest(original), "document": updated, "bind": False})
    assert not result["bindingRequested"]
    saved = json.loads(path.read_text())
    assert saved["rows"][1] == original["rows"][1]
    assert saved["rows"][2]["words"] == 512
    assert not (tmp_path / "ns-state.json").exists()
