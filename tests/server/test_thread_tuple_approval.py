"""Metadata approval uses a private config and never calls an image writer."""
import copy
import json
import os
from contextlib import nullcontext

import pytest

from tests.server.test_thread_tuple_evidence import design

pytestmark = pytest.mark.skipif(
    os.environ.get("CHURCH_TEST_ISOLATED_MODE") != "1",
    reason="Server import requires the isolated test runner")


@pytest.fixture
def endpoint(tmp_path, monkeypatch):
    import server.app as app
    cfg = {"step1": {"threadLumpWords": 256, "threadStackWords": 32},
           "unrelated": {"keep": True}}
    path = tmp_path / "config.json"
    path.write_text(json.dumps(cfg))
    monkeypatch.setattr(app, "BOOT_CONFIG_PATH", str(path))
    monkeypatch.setattr(app, "_read_saved_boot_config",
                        lambda: (json.loads(path.read_text()), None))
    monkeypatch.setattr(app, "_namespace_commit_guard", nullcontext)
    monkeypatch.setattr(app, "_read_authoritative_namespace_rows",
                        lambda: ([{"slot": 0, "seq": 0, "name": "Test.NS"},
                                  {"slot": 1, "seq": 0, "name": "Alice.Thread"}], "test"))
    def forbidden(*args, **kwargs):
        pytest.fail("Metadata approval must never publish an image")
    monkeypatch.setattr(app, "_write_boot_image_bytes", forbidden)
    return app.app.test_client(), path, cfg


def test_approval_only_persists_frozen_annotations(endpoint):
    client, path, before = endpoint
    payload = design()
    payload["target"] = {"slot": 1, "sequence": 0, "namespaceSequence": 0,
                         "name": "Alice.Thread", "namespaceName": "Test.NS"}
    response = client.post("/api/boot-config/thread-tuples", json=payload)
    assert response.status_code == 428
    assert json.loads(path.read_text()) == before
    review = response.json["change_confirmation"]
    assert any("heap offset 7, 4 words" in line for line in review["changes"])
    response = client.post("/api/boot-config/thread-tuples", json=payload,
                           headers={"X-Change-Confirmation": review["id"]})
    assert response.status_code == 200
    after = json.loads(path.read_text())
    assert after.pop("threadTupleDesign") == [payload]
    assert after == before
    assert list(path.parent.iterdir()) == [path]


@pytest.mark.parametrize("damage", ["generation", "name", "namespaceName", "overlap", "malformed"])
def test_invalid_approval_does_not_write(endpoint, damage):
    client, path, _ = endpoint
    before = path.read_bytes()
    payload = design()
    payload["target"] = {"slot": 1, "sequence": 0, "namespaceSequence": 0,
                         "name": "Alice.Thread", "namespaceName": "Test.NS"}
    if damage == "generation":
        payload["target"]["sequence"] = 3
    elif damage in ("name", "namespaceName"):
        payload["target"][damage] = "Replacement"
    elif damage == "overlap":
        payload["tuples"].append(copy.deepcopy(payload["tuples"][0]))
    else:
        payload = None
    response = client.post("/api/boot-config/thread-tuples", json=payload)
    assert response.status_code == 409  # rejected by review preflight, before any approval
    assert path.read_bytes() == before
