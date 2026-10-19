"""The reviewed repair changes a selection, never historical executable bytes."""
import copy
import hashlib
import json
from pathlib import Path
import struct

import pytest

from server import wukong_callhome_selection as repair
from server.namespace_design_v1 import DesignStore, digest
from server.symbolic_binding import embedded_api

ROOT = Path(__file__).resolve().parents[2] / "server/lumps"
OLD_FILE = "WukongCallHome.1.7084172e.lump"
OLD_HASH = "549aa4138bf722b48c2ff304ec628af0139d70685ea99e66dfb3200ad0055738"


def words(path):
    raw = path.read_bytes()
    return list(struct.unpack(f">{len(raw)//4}I", raw))


def test_new_revision_preserves_instructions_and_repairs_declared_identity():
    old = words(ROOT / OLD_FILE)
    new = words(ROOT / repair.SELECTION["filename"])
    assert hashlib.sha256((ROOT / OLD_FILE).read_bytes()).hexdigest() == OLD_HASH
    assert hashlib.sha256((ROOT / repair.SELECTION["filename"]).read_bytes()).hexdigest() == repair.SELECTION["binaryHash"]
    assert (old[0] >> 10) & 8191 == (new[0] >> 10) & 8191 == 75
    assert new[1:76] == old[1:76]
    assert old[-3:] == [0, 0, 0]
    assert new[-3:] == [0xFEED5E1F, 0, 0]
    api = embedded_api(new)
    assert api["name"] == "ide.WukongCallHome"
    assert [row["name"] for row in api["capabilities"]] == [
        "SELF", "ide.LED_DEV", "ide.UART_DEV"]
    main = ROOT / "ide.CapabilityTest.1.ea7c9154.lump"
    assert hashlib.sha256(main.read_bytes()).hexdigest() == "42d8b6888ed4383d750edfafd8911014379686638f7d1db4ebc5e3af63d43b63"
    assert "ide.WukongCallHome" in [
        row["name"] for row in embedded_api(words(main))["capabilities"]]


@pytest.fixture
def store(tmp_path, monkeypatch):
    # Reconstruct the reviewed draft independently of environment-local state.
    from server.namespace_design_v1 import seed
    document = seed({})
    document["rows"] = [r for r in document["rows"] if r["name"] != "SelfTest"]
    main = next(r for r in document["rows"] if r["slot"] == 10)
    main.update(name="ide.CapabilityTest", selection={
        "filename": "ide.CapabilityTest.1.ea7c9154.lump", "revision": 2,
        "binaryHash": "42d8b6888ed4383d750edfafd8911014379686638f7d1db4ebc5e3af63d43b63",
        "token": "961bfee3"})
    # The exact reviewed document has explicit false boot on the non-boot LUMP.
    assert digest(document) == repair.REVIEWED_FINGERPRINT
    path = tmp_path / "ascending-v1.json"
    path.write_text(json.dumps(document))
    from server import design_simulation, namespace_binding_report
    # These tests isolate CAS/selection behavior. Real compiler admission,
    # binding, preparation and stepping are checked by the endpoint replay.
    monkeypatch.setattr(design_simulation, "bindings", lambda *args: [])
    monkeypatch.setattr(namespace_binding_report, "binding_report",
                        lambda *args: {"status": "unresolved", "installed": False})
    return DesignStore(path, ROOT, tmp_path / "unused.json")


def test_reviewed_selection_only_changes_slot_seven_and_is_idempotent(store):
    before = store.read_document()
    result = repair.apply_reviewed_selection(store)
    assert result["changed"]
    after = store.read_document()
    expected = copy.deepcopy(before)
    row = next(r for r in expected["rows"] if r["slot"] == 7)
    row.update(name="ide.WukongCallHome", selection=repair.SELECTION)
    assert after == expected
    assert row["sequence"] == 0 and not row["boot"]
    assert result["bindingReport"]["installed"] is False
    saved = store.path.read_bytes()
    assert not repair.apply_reviewed_selection(store)["changed"]
    assert store.path.read_bytes() == saved


def test_changed_draft_is_never_overwritten(store):
    document = store.read_document()
    document["rows"][-1]["sequence"] += 1
    store.path.write_text(json.dumps(document))
    saved = store.path.read_bytes()
    assert not repair.apply_reviewed_selection(store)["changed"]
    assert store.path.read_bytes() == saved


def test_missing_draft_is_not_seeded(store):
    store.path.unlink()
    assert not repair.apply_reviewed_selection(store)["changed"]
    assert not store.path.exists()


def test_failed_admission_does_not_save(store, monkeypatch):
    from server import design_simulation
    def reject(*args):
        raise ValueError("authenticated compiler approval is required")
    monkeypatch.setattr(design_simulation, "bindings", reject)
    saved = store.path.read_bytes()
    with pytest.raises(ValueError, match="authenticated"):
        repair.apply_reviewed_selection(store)
    assert store.path.read_bytes() == saved
