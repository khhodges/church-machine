"""Real route consent and reload, using only the runner's copied hierarchy."""
import copy
import hashlib
import json
import os
from pathlib import Path

from tests.server.test_namespace_save_acceptance import ROOT, server
from server import ide_leaf_policy


def test_node_consent_cancel_reload_and_real_config_guard():
    private = Path(os.environ["CHURCH_TEST_IDE_HIERARCHY_PATH"])
    assert Path(ide_leaf_policy.configuration_path()) == private.resolve()
    live = ROOT / "server/ide-hierarchy.json"
    live_hash = lambda: hashlib.sha256(live.read_bytes()).hexdigest() if live.exists() else None
    before = live_hash()
    original_bytes = private.read_bytes()
    original = json.loads(original_bytes)
    client = server.app.test_client()
    headers = {"X-Requested-With": "NamespaceDesign"}
    url = "/api/ide-hierarchy"
    try:
        assert client.get(url).json == original
        data = {"node": "acceptanceprivate", "expected": original, "confirmed": False}
        response = client.put(url, json=data, headers=headers)
        assert response.status_code == 422
        assert response.json["dataChanged"] is False
        assert private.read_bytes() == original_bytes
        data["confirmed"] = True
        response = client.put(url, json=data, headers=headers)
        assert response.status_code == 200, response.json
        expected = copy.deepcopy(original) if original is not None else {"aliases": {}, "definitions": {}}
        expected["node"] = data["node"]
        expected["aliases"] = {
            alias: data["node"] + "." + target.rpartition(".")[2]
            if target.rpartition(".")[0] == (original or {}).get("node") else target
            for alias, target in (original or {}).get("aliases", {}).items()}
        assert response.json == expected == json.loads(private.read_bytes())
        assert server.app.test_client().get(url).json == expected
        stale = client.put(url, json=data, headers=headers)
        assert stale.status_code == 422
        assert json.loads(private.read_bytes()) == expected
    finally:
        private.write_bytes(original_bytes)
        assert live_hash() == before
