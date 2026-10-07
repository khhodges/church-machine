"""Frozen hardware addresses must not come from the simulator image."""
from pathlib import Path
import pytest

from server.artifact_revisions import RevisionStore
from server.frozen_hardware_listing import listing

REVISION = "3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166"
ROOT = Path(__file__).resolve().parents[2]


def test_b1_maps_frozen_hardware_not_simulator_addresses():
    store = RevisionStore(str(ROOT / "server/build-snapshots/revisions"))
    result = listing(store, REVISION, lambda word, name: str(word))
    assert result["boot_target"] == "CapabilityTest"
    assert result["boot_gt"] == 0x4a00000a
    assert result["trace_authoritative"] is False
    first = result["rows"][0]
    assert first["nia_label"] == "CapabilityTest.0"
    assert first["nia"] == 0x2e00
    assert result["rows"][1]["nia"] == 0x2e04
    assert result["rows"][1]["word"] == 2
    assert not any(r["nia_label"].startswith("Boot.") for r in result["rows"])


def test_tampered_frozen_input_rejected(tmp_path):
    real = RevisionStore(str(ROOT / "server/build-snapshots/revisions"))
    class Tampered:
        def read(self, *args):
            return real.read(*args)
        def file_path(self, *args):
            path = tmp_path / "bad.v"
            path.write_text("tampered")
            return path
    with pytest.raises(ValueError, match="integrity"):
        listing(Tampered(), REVISION, lambda word, name: "")


def test_no_reference_map_implied_without_image():
    import server.app as module
    from unittest.mock import patch
    with patch.object(module, "_wukong_active_lump_info", {}):
        with module.app.test_client() as client:
            result = client.get("/hardware/wukong/code").get_json()
            assert result["rows"] == []
            assert result["trace_authoritative"] is False
            result = client.get("/hardware/wukong/code?namespace_revision=" + REVISION).get_json()
            assert result["boot_target"] == "CapabilityTest"
