"""New-format design persistence is independent of image installation."""
import copy
import json
from pathlib import Path
import pytest
from server.namespace_design_v1 import DesignStore, seed, project, validate

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def store(tmp_path):
    legacy = tmp_path / "ns-state.json"
    legacy.write_text(json.dumps({"abstractions": [
        {"slot": 0, "name": "Boot.NS"}, {"slot": 1, "name": "Boot.Thread"},
        {"slot": 2, "name": "UART_DEV"},
    ]}))
    return DesignStore(tmp_path / "drafts" / "ascending.json", ROOT / "server/lumps", legacy)


def test_new_geometry_exact_pins_and_api_allocations(store):
    data = store.read()
    p = data["projection"]
    by = {r["slot"]: r for r in p["rows"]}
    assert p["metadataWords"] == [0xf8810100, 0, 10, 0]
    assert (by[1]["name"], by[1]["entryWord"], by[1]["limit"]) == ("Boot.NS", 4, 255)
    assert (by[2]["name"], by[2]["entryWord"], by[2]["location"]) == ("Boot.Thread", 8, 256)
    assert by[8]["name"] == "UART_DEV" and by[8]["sequence"] == 1
    assert 9 not in by
    assert by[7]["selection"]["revision"] == 20
    assert by[10]["selection"]["revision"] == 45
    # Historical filename suffixes are not the current API lookup token.
    assert by[7]["selection"]["token"] == "232f0de4"
    assert by[10]["selection"]["token"] == "17fc5571"
    assert by[7]["allocationWords"] < 4096
    assert by[10]["allocationWords"] < 2048
    assert 6 not in by
    assert not any("RunAbstraction" in w for w in p["warnings"])
    assert not data["persisted"] and not store.path.exists()
    assert p["activationAllowed"] is False and p["buildReady"] is False


@pytest.mark.parametrize("phase1", [False, True])
def test_saved_state_evidence_tracks_files_without_automatic_save(store, phase1):
    store.phase1 = phase1
    legacy_before = store.legacy_path.read_bytes()
    generated = store.read()
    assert generated["persisted"] is False
    assert not store.path.parent.exists(), "Reading defaults must not create saved state"
    assert store.read() == generated

    # Even identical default content is saved only after an explicit save.
    saved = store.save(dict(fingerprint=generated["fingerprint"],
                            document=generated["document"]))
    assert saved["persisted"] is True
    reopened = DesignStore(store.path, store.lumps, store.legacy_path, phase1=phase1).read()
    assert reopened["persisted"] is True
    assert reopened["document"] == generated["document"]
    assert reopened["fingerprint"] == generated["fingerprint"]

    store.path.unlink()
    missing = store.read()
    assert missing["persisted"] is False
    assert missing["document"] == generated["document"]
    assert not store.path.exists(), "Missing saved state must not be silently restored"
    assert store.legacy_path.read_bytes() == legacy_before


def test_unfinished_add_edit_save_reload_clear_and_stale_tab(store):
    before = store.legacy_path.read_bytes()
    original = store.read()
    draft = copy.deepcopy(original["document"])
    draft["rows"].append(dict(slot=14, name="ide.Mint", kind="lump", policy="Lazy", sequence=0))
    saved = store.save(dict(fingerprint=original["fingerprint"], document=draft))
    assert store.read()["document"] == draft
    assert saved["projection"]["metadataWords"][2] == 11
    assert store.legacy_path.read_bytes() == before
    with pytest.raises(ValueError, match="another tab"):
        store.save(dict(fingerprint=original["fingerprint"], document=original["document"]))
    draft["rows"][-1]["policy"] = "Resident"
    saved = store.save(dict(fingerprint=saved["fingerprint"], document=draft))
    assert any("ide.Mint" in w for w in saved["projection"]["warnings"])
    assert saved["projection"]["usedWords"] is None
    draft["rows"].pop()
    store.save(dict(fingerprint=saved["fingerprint"], document=draft))
    assert store.read()["document"] == original["document"]
    assert store.legacy_path.read_bytes() == before


@pytest.mark.parametrize("change", [
    lambda d: d["rows"][0].update(slot=0),
    lambda d: d["rows"][1].update(sequence=1),
    lambda d: d["rows"].append(copy.deepcopy(d["rows"][2])),
    lambda d: d.update(outputProfile="full"),
    lambda d: d["rows"][2].update(selection={"filename":"../wrong.lump"}),
])
def test_invalid_design_never_commits(store, change):
    current = store.read()
    draft = copy.deepcopy(current["document"])
    change(draft)
    with pytest.raises(ValueError):
        store.save(dict(fingerprint=current["fingerprint"], document=draft))
    assert not store.path.exists()


def test_carries_other_design_members_without_silent_slot_collision():
    document = seed({"abstractions":[{"slot":14,"name":"ide.Mint","seq":3}]})
    row = next(r for r in document["rows"] if r["name"] == "ide.Mint")
    assert (row["slot"], row["sequence"], row["policy"]) == (14,3,"Lazy")
    with pytest.raises(ValueError, match="conflicts"):
        seed({"abstractions":[{"slot":8,"name":"Other.Service"}]})


def test_route_uses_private_store_and_protects_writes(store, monkeypatch):
    from server import app as module
    monkeypatch.setattr(module, "NS_STATE_PATH", str(store.legacy_path))
    monkeypatch.setattr(module, "LUMPS_DIR", str(store.lumps))
    with module.app.test_client() as client:
        def put(payload, headers=None):
            headers = dict(headers or {})
            response = client.put("/api/namespace/design-v1", json=payload, headers=headers)
            if response.status_code == 428:
                headers["X-Change-Confirmation"] = response.json["change_confirmation"]["id"]
                response = client.put("/api/namespace/design-v1", json=payload, headers=headers)
            return response
        data = client.get("/api/namespace/design-v1").get_json()
        assert data["ok"]
        payload = dict(fingerprint=data["fingerprint"], document=data["document"])
        assert put(payload).status_code == 403
        headers = {"X-Requested-With":"NamespaceDesign"}
        assert put(payload, {**headers,"Origin":"https://other.example"}).status_code == 403
        response = put(payload, headers)
        assert response.status_code == 200, response.get_json()
        assert response.get_json()["persisted"]
        assert client.get("/api/namespace/design-v1").get_json()["document"] == payload["document"]
