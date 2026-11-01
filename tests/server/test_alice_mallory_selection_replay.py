import copy
import json
from pathlib import Path
from types import SimpleNamespace

from server.alice_mallory_thread_selection import apply_reviewed_designs

RECEIPT = json.loads((Path(__file__).resolve().parents[2] /
                     "server/alice-mallory-thread-selection.json").read_text())


class Client:
    def __init__(self):
        self.cfg = dict(step1=dict(threadLumpWords=256, threadStackWords=32))
        self.fingerprint = RECEIPT["namespaceFingerprint"]
        self.writes = []

    def get(self, route):
        return SimpleNamespace(status_code=200, json=(
            dict(config=self.cfg) if route == "/api/boot-config"
            else dict(namespaceFingerprint=self.fingerprint)))

    def post(self, route, json, headers=None):
        assert route == "/api/boot-config/thread-designs"
        if not headers:
            return SimpleNamespace(status_code=428, json={"change_confirmation": {"id": "review"}})
        assert headers == {"X-Change-Confirmation": "review"}
        self.writes.append(copy.deepcopy(json))
        self.cfg.setdefault("threadInitialDesigns", []).append(copy.deepcopy(json))
        return SimpleNamespace(status_code=200, json={"imageChanged": False})


def test_reviewed_replay_is_idempotent():
    client = Client()
    assert apply_reviewed_designs(client, RECEIPT)["changed"]
    assert client.writes == RECEIPT["designs"]
    assert not apply_reviewed_designs(client, RECEIPT)["changed"]
    assert len(client.writes) == 2


def test_newer_thread_design_is_never_overwritten():
    client = Client()
    changed = copy.deepcopy(RECEIPT["designs"][0])
    changed["initialization"]["dataRegisters"][1] = 123
    client.cfg["threadInitialDesigns"] = [changed]
    assert not apply_reviewed_designs(client, RECEIPT)["changed"]
    assert not client.writes


def test_namespace_and_geometry_drift_never_write():
    client = Client()
    client.fingerprint = "changed"
    assert not apply_reviewed_designs(client, RECEIPT)["changed"]
    client.fingerprint = RECEIPT["namespaceFingerprint"]
    client.cfg["step1"]["threadStackWords"] = 64
    assert not apply_reviewed_designs(client, RECEIPT)["changed"]
    assert not client.writes


def test_table_only_gate_is_exact_and_never_certifies_an_image(tmp_path):
    from scripts.check_namespace_authority import audit
    root = Path(__file__).resolve().parents[2]
    receipt = root / "server/alice-mallory-thread-selection.json"
    lumps = root / "server/lumps"
    result = audit(lumps, reviewed_design=receipt)
    assert result["ok"], result
    assert "installed image not certified" in result["scope"]
    state = json.loads((lumps / "ns-state.json").read_text())
    state["abstractions"][-1]["seq"] += 1
    changed = tmp_path / "ns-state.json"
    changed.write_text(json.dumps(state))
    assert not audit(lumps, state_path=changed, reviewed_design=receipt)["ok"]
