import copy
import pytest
from server.namespace_design_v1 import DesignStore, phase1_seed, project, validate, seed


def test_phase1_table_and_members(tmp_path):
    d = phase1_seed()
    validate(d)
    p = project(d, tmp_path)
    assert d["slotCount"] == 256
    assert p["tableWords"] == 1024
    assert p["metadataWords"][0] == 0xF8840100
    rows = {r["slot"]: r for r in p["rows"]}
    assert rows[1]["limit"] == 1023
    assert rows[2]["location"] == 1024
    assert [rows[i]["name"] for i in (9, 14, 15)] == ["ide.Mint", "nstab", "pkverify"]
    assert not p["activationAllowed"] and not p["buildReady"]
    assert all(rows[i]["location"] is None for i in (9, 14, 15))


def test_separate_persistence_and_high_slot(tmp_path):
    live = tmp_path / "ns-state.json"
    live.write_text('{"abstractions":[]}')
    old = DesignStore(tmp_path / "old.json", tmp_path, live)
    new = DesignStore(tmp_path / "phase1.json", tmp_path, live, phase1=True)
    old_before = old.read()
    r = new.read()
    d = copy.deepcopy(r["document"])
    d["rows"].append(dict(slot=255, name="ide.Future", kind="lump",
                          policy="Lazy", sequence=0))
    saved = new.save(dict(fingerprint=r["fingerprint"], document=d))
    assert new.read()["document"] == d
    assert saved["persisted"]
    assert old.read() == old_before
    assert live.read_text() == '{"abstractions":[]}'
    with pytest.raises(ValueError, match="another tab"):
        new.save(dict(fingerprint=r["fingerprint"], document=d))
    with pytest.raises(ValueError, match="profile"):
        old.save(dict(fingerprint=old_before["fingerprint"], document=d))
    d["slotCount"] = 128
    with pytest.raises(ValueError, match="slot"):
        validate(d)


def test_capacity_is_configurable_and_old_geometry_stays(tmp_path):
    d = phase1_seed()
    d["slotCount"] = 512
    assert project(d, tmp_path)["tableWords"] == 2048
    assert project(seed({}), tmp_path)["tableWords"] == 256
    for bad in (True, 15, 4097, 256.5):
        d["slotCount"] = bad
        with pytest.raises(ValueError):
            validate(d)
