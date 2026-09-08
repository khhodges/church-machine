"""Focused regressions for causally matched hardware trace rows."""

from hardware import wukong_bridge
from server import app as app_module


def test_unknown_0114_word_is_decoded_without_false_address_label(monkeypatch):
    monkeypatch.setattr(app_module, "_wukong_trace_metadata", lambda _nia: None)
    item = app_module._wukong_correlate_trace_metadata(0x0114, 0x8F098000)
    assert item["disasm"] == "DWRITE DR1, CR3, #0, DR0"
    assert item["metadata_status"] == "address metadata unavailable"
    assert "nia_label" not in item


def test_conflicting_branch_map_and_dwrite_word_are_not_combined(monkeypatch):
    monkeypatch.setattr(app_module, "_wukong_trace_metadata", lambda _nia: {
        "pet_name": "WukongCallHome",
        "offset": 73,
        "nia_label": "WukongCallHome.73",
        "map_instr_word": 0xBF007FBB,
        "disasm": "BRANCH -69",
        "source_map": "reference-bitstream",
    })
    item = app_module._wukong_correlate_trace_metadata(0x1324, 0x8F098000)
    assert item["disasm"] == "DWRITE DR1, CR3, #0, DR0"
    assert item["metadata_status"].startswith("mismatch:")
    assert "nia_label" not in item
    assert "BRANCH" not in item["disasm"]


def test_matching_branch_keeps_its_address_identity(monkeypatch):
    monkeypatch.setattr(app_module, "_wukong_trace_metadata", lambda _nia: {
        "pet_name": "WukongCallHome",
        "offset": 73,
        "nia_label": "WukongCallHome.73",
        "map_instr_word": 0xBF007FBB,
        "disasm": "BRANCH -69",
        "source_map": "reference-bitstream",
    })
    item = app_module._wukong_correlate_trace_metadata(0x1324, 0xBF007FBB)
    assert item["nia_label"] == "WukongCallHome.73"
    assert item["disasm"] == "BRANCH -69"
    assert item["metadata_status"] == "matched"


def test_bridge_map_word_cannot_self_validate_as_hardware_evidence():
    packet = bytes([
        0xAA, 0x00, 0x00, 0x12, 0x10, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    decoded = wukong_bridge.decode_trace_packet(packet)
    assert "observed_instr_word" not in decoded
    decoded.update(wukong_bridge._trace_location(decoded["nia"]))
    assert decoded["map_instr_word"] == 0x8F098000
    assert "observed_instr_word" not in decoded

    item = app_module._wukong_correlate_trace_metadata(
        decoded["nia"], decoded.get("observed_instr_word"))
    assert item["disasm"] == "DWRITE DR1, CR3, #0, DR0"
    assert item["metadata_status"] == "NIA map (unverified)"
    assert "observed_instr_word" not in item