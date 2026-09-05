"""LUMP metadata is immutable and no longer has a mutable sidecar endpoint."""
import sys
import types

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)

import server.app as app_module


def test_meta_patch_is_retired_for_valid_payload():
    response = app_module.app.test_client().patch(
        "/api/lump/ab123456/meta",
        json={"ns_slot_policy": "static", "ns_slot": 9},
    )
    assert response.status_code == 410
    assert "retired" in response.get_json()["error"].lower()


def test_meta_patch_is_retired_before_payload_validation():
    response = app_module.app.test_client().patch(
        "/api/lump/ab123456/meta", json={"ns_slot": True}
    )
    assert response.status_code == 410