"""Focused contracts for the rich Namespace boot marker."""

import copy
import json
import os
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)


def _rows(marker=2):
    return {
        "abstractions": [
            {"name": "SelfTest", "slot": 6, "resident": True},
            {"name": "CapabilityTest", "slot": marker, "resident": True,
             "token": "4a000002", "filename": "CapabilityTest.lump",
             "boot": True},
        ]
    }


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    import server.app as module

    state_path = tmp_path / "ns-state.json"
    config_path = tmp_path / "boot-config.json"
    image_path = tmp_path / "boot-image.bin"
    state_path.write_text(json.dumps(_rows()), encoding="utf-8")
    config = copy.deepcopy(module.DEFAULT_BOOT_CONFIG)
    config_path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setattr(module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(module, "BOOT_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(module, "BOOT_CONFIG_LEGACY_PATH", str(tmp_path / "missing.json"))
    monkeypatch.setattr(module, "BOOT_IMAGE_PATH", str(image_path))
    module.app.config["TESTING"] = True
    return module, state_path, config_path, image_path


def _client(module):
    client = module.app.test_client()
    token = os.environ.get("REPORT_TOKEN", "").strip()
    if token:
        client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client


def test_marker_requires_exactly_one_live_row(app_module):
    module, state_path, _, _ = app_module
    for rows in (
            [{"name": "CapabilityTest", "slot": 2}],
            [{"name": "A", "slot": 2, "boot": True},
             {"name": "B", "slot": 3, "boot": True}],
            [{"name": "A", "slot": 2, "boot": True},
             {"name": "B", "slot": 2}],
    ):
        with pytest.raises(ValueError, match="(exactly one live Namespace row|duplicate Namespace slot)"):
            module._validate_namespace_boot_marker(rows)
    assert module._authoritative_boot_slot() == 2


def test_boot_config_cannot_override_marker(app_module):
    module, _, _, _ = app_module
    payload = copy.deepcopy(module.DEFAULT_BOOT_CONFIG)
    payload["bootEntrySlot"] = 10
    with _client(module) as client:
        response = client.post("/api/boot-config", json=payload)
    assert response.status_code == 400
    assert "authoritative Namespace boot:true row" in response.get_json()["error"]


def test_generate_route_passes_marker_slot_only(app_module, monkeypatch):
    module, _, _, _ = app_module
    captured = {}

    def fake_generate(cfg, lumps_dir, **kwargs):
        captured.update(kwargs)
        return b"generated"

    monkeypatch.setattr(module._boot_image_gen, "generate_boot_image", fake_generate)
    monkeypatch.setattr(module, "_write_boot_image_bytes", lambda blob: None)
    monkeypatch.setattr(module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(module, "_load_boot_ns_lump", lambda: None)
    monkeypatch.setattr(
        module, "_boot_image_preparation_status",
        lambda blob, cfg: {"status": "prepared"},
    )
    with _client(module) as client:
        response = client.post("/api/boot-image/generate", json={"entrySlot": 2})
    assert response.status_code == 200
    assert captured["boot_entry_slot"] == 2


def test_marker_move_is_atomic_and_does_not_rewrite_config(app_module):
    module, state_path, config_path, _ = app_module
    original_config = config_path.read_bytes()
    with _client(module) as client:
        response = client.post("/api/namespace/boot-marker", json={"slot": 6})
    assert response.status_code == 200
    state = json.loads(state_path.read_text(encoding="utf-8"))
    marked = [row for row in state["abstractions"] if row.get("boot") is True]
    assert len(marked) == 1
    assert marked[0]["slot"] == 6
    assert config_path.read_bytes() == original_config