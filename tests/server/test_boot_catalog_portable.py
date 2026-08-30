import hashlib
import json

import pytest

import server.app as app_module


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client


def test_boot_config_catalog_preserves_portable_binder_policy(
        tmp_path, monkeypatch, client):
    identity = hashlib.sha256(b"Fixed.Target#2").hexdigest()
    binary = "a" * 64
    manifest = [
        {
            "token": "11223344", "cache_token": "11223344",
            "abstraction": "Fixed.Target", "ns_slot": 12,
            "lump_size": 64, "methods": [{"name": "run"}],
            "dot_name": "Fixed.Target", "issue_n": 2,
            "identity_hash": identity, "binary_hash": binary,
            "grants": ["R", "W"], "capability_type": "inform",
            "authorized": True, "legacy_authorized": False,
        },
        {
            "token": "55667788", "abstraction": "Floating.Tool",
            "ns_slot": None, "ns_slot_policy": "dynamic",
            "lump_size": 64, "methods": [{"name": "run"}],
            "sidecar_file": "floating.json",
        },
    ]
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    (tmp_path / "floating.json").write_text(json.dumps({
        "cache_token": "55667788", "dot_name": "Floating.Tool", "issue_n": 4,
        "identity_hash": hashlib.sha256(b"Floating.Tool#4").hexdigest(),
        "binary_hash": "b" * 64, "grants": ["E"],
        "capability_type": "outform", "authorized": True,
        "legacy_authorized": True,
    }))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(manifest_path))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(tmp_path / "missing-config.json"))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_LEGACY_PATH",
                        str(tmp_path / "missing-legacy.json"))
    # Keep slot 12 in the normal selectable branch; production profiles may
    # increase the named prefix through generated Thread slots.
    monkeypatch.setattr(app_module, "BASE_NAMED_NS_COUNT", 20)

    response = client.get("/api/boot-config")
    assert response.status_code == 200
    catalog = response.get_json()["lumpCatalog"]
    fixed = next(row for row in catalog if row["abstraction"] == "Fixed.Target")
    floating = next(row for row in catalog if row["abstraction"] == "Floating.Tool")

    assert fixed["cache_token"] == fixed["cacheToken"] == "11223344"
    assert fixed["grants"] == ["R", "W"]
    assert fixed["capability_type"] == "inform"
    assert fixed["authorized"] is True
    assert fixed["legacy_authorized"] is False
    assert fixed["identityHash"] == identity

    assert floating["floating"] is True
    assert floating["cache_token"] == floating["cacheToken"] == "55667788"
    assert floating["grants"] == ["E"]
    assert floating["capability_type"] == "outform"
    assert floating["authorized"] is True
    assert floating["legacy_authorized"] is True
    assert floating["dotName"] == "Floating.Tool"
    assert floating["issueN"] == 4