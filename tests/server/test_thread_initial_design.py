import copy
import json
import shutil
from pathlib import Path
import pytest
from server.thread_initial_design import validate_design, validate_bindings, apply_initialization
from server.built_thread_view import inspect_threads
from tests.server.test_built_thread_view import fixture, inspect
from tests.server.test_thread_tuple_approval import endpoint


def design(slot=11, size=512):
    return {"sizeWords": size, "stackWords": 64,
            "target": {"slot": slot, "sequence": 0, "namespaceSequence": 0,
                       "name": "Mallory.Thread", "namespaceName": "Test.NS"},
            "tuples": [{"name": "Counter", "offset": 0, "policy": "initialize",
                        "fields": [{"name": "value", "type": "uint32", "size": 1, "initial": 679}]}],
            "initialization": {"dataRegisters": [None, 913] + [None] * 14,
                               "capabilityRegisters": [None, 0x4A040015] + [None] * 10}}


def test_design_to_exact_built_registers_and_heap():
    words, entries = fixture()
    before = list(words)
    d = validate_design(design())
    apply_initialization(words, 512, d)
    a, m = inspect(words, entries)
    assert words[:512] == before[:512]
    assert m["dataRegisters"][1]["value"] == 913
    assert m["capabilities"][1]["targetName"] == "Mallory"
    assert m["heap"]["initialWords"][0] == 679
    assert a["heap"]["initialWords"][0] == 0xA11CE


@pytest.mark.parametrize("value", [-1, 2**32, True, "0x10", 1.5])
def test_invalid_register_never_coerced(value):
    d = design()
    d["initialization"]["dataRegisters"][1] = value
    with pytest.raises(ValueError):
        validate_design(d)


def test_generation_and_immutable_thread_rejected():
    d = validate_design(design())
    rows = [{"slot": 0, "seq": 0, "name": "Test.NS"},
            {"slot": 11, "seq": 0, "name": "Mallory.Thread"},
            {"slot": 21, "seq": 4, "name": "Mallory"}]
    validate_bindings(d, rows)
    rows[2]["seq"] = 5
    with pytest.raises(ValueError):
        validate_bindings(d, rows)
    rows[2]["seq"] = 4
    rows[1]["filename"] = "immutable.lump"
    with pytest.raises(ValueError):
        validate_bindings(d, rows)


def test_real_generator_uses_per_thread_design(tmp_path):
    from server.boot_image import generate_simulation_image, parse_ns_table_raw
    root = Path(__file__).resolve().parents[2]
    lumps = tmp_path / "lumps"
    shutil.copytree(root / "server/lumps", lumps)
    cfg = json.loads((root / "server/boot-config.json").read_text())
    rows = json.loads((lumps / "ns-state.json").read_text())["abstractions"]
    by_slot = {r["slot"]: r for r in rows}
    d = design(12, 512)
    d["target"].update(name=by_slot[12]["name"], sequence=by_slot[12]["seq"],
                       namespaceName=by_slot[0]["name"], namespaceSequence=by_slot[0]["seq"])
    # Use a real retained binding, never fabricate an Alice/Mallory occupant.
    d["initialization"]["capabilityRegisters"][1] = 0x4A000000 | (by_slot[10]["seq"] << 16) | 10
    cfg["threadInitialDesigns"] = [d]
    image = generate_simulation_image(cfg, str(lumps))
    raw = parse_ns_table_raw(image)
    ts = {t["slot"]: t for t in inspect_threads(image, raw["entries"], raw["nsTableBase"])}
    assert ts[12]["sizeWords"] == 512
    assert ts[12]["dataRegisters"][1]["value"] == 913
    assert ts[12]["heap"]["initialWords"][0] == 679
    assert ts[11]["sizeWords"] == 256


@pytest.mark.skipif(__import__("os").environ.get("CHURCH_TEST_ISOLATED_MODE") != "1",
                    reason="Isolated server required")
def test_reviewed_endpoint_saves_exact_design_without_building(endpoint):
    client, path, before = endpoint
    d = design(1, 256)
    d["target"]["name"] = "Alice.Thread"
    d["initialization"]["capabilityRegisters"] = [None] * 12
    response = client.post("/api/boot-config/thread-designs", json=d)
    assert response.status_code == 428
    assert json.loads(path.read_text()) == before
    response = client.post("/api/boot-config/thread-designs", json=d,
                           headers={"X-Change-Confirmation": response.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    assert json.loads(path.read_text())["threadInitialDesigns"] == [d]
