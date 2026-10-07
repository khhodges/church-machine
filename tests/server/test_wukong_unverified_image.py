"""Legacy board evidence must not silently promote reference image identity."""
import pytest

from hardware import wukong_bridge
from hardware.wukong_trace_symbols import trace_metadata, reference_metadata
from server import app as module


@pytest.mark.parametrize("nia", [0, 4, 8, 0x600, 0x1204, 0x1324])
def test_reference_addresses_have_no_live_authority(nia):
    assert trace_metadata(nia) is None
    assert wukong_bridge._trace_location(nia) is None
    assert module._wukong_correlate_trace_metadata(nia) == {}


@pytest.mark.parametrize("info", [
    {},  # cold server / restart
    {"name": "OtherImage", "base_byte": 0x1200, "end_byte": 0x1400,
     "lump_words": {1: 0x071B0050}},
    {"name": "WukongCallHome", "base_byte": 0x1200, "end_byte": 0x1400,
     "lump_words": {1: 0x071B0050}},
])
def test_restored_or_matching_upload_map_is_not_identity(monkeypatch, info):
    monkeypatch.setattr(module, "_wukong_active_lump_info", info)
    result = module._wukong_correlate_trace_metadata(0x1204, 0x071B0050)
    assert result["source_map"] == "instruction-word"
    assert "nia_label" not in result
    assert result["observed_instr_word"] == 0x071B0050


def test_explicit_reference_inspection_remains_available():
    assert reference_metadata(0x1204)["nia_label"] == "WukongCallHome.1"
    assert "WukongCallHome" not in wukong_bridge._decode_gt_label(0x42000007)


def test_inspection_breakpoint_rejected_without_queuing(monkeypatch):
    monkeypatch.setattr(module, "_wukong_control_auth", lambda: (True, None))
    before = module._wukong_pending_cmd
    with module.app.test_client() as client:
        response = client.post("/hardware/wukong/command", json={
            "cmd": "b", "nia": 0x2e04, "namespace_revision": "any-approved-revision",
        })
    assert response.status_code == 409
    assert response.get_json()["blocked_stage"] == "image_identity_unavailable"
    assert module._wukong_pending_cmd is before
