"""The hardware projection must not restore absent catalog slots."""
import json
from pathlib import Path

from hardware.boot_rom import WUKONG_DEMO_NAMESPACE
import pytest
from scripts.check_hardware_namespace_thread_readiness import check_contract


def test_absent_optional_catalog_slots_have_no_descriptor():
    state = json.loads(Path("server/lumps/ns-state.json").read_text())
    occupied = {row["slot"] for row in state["abstractions"]}
    for slot in (8, 9):
        if slot not in occupied:
            assert WUKONG_DEMO_NAMESPACE[slot * 4:slot * 4 + 4] == [0] * 4


def test_readiness_accepts_empty_but_rejects_partial_descriptor(monkeypatch):
    import scripts.check_hardware_namespace_thread_readiness as readiness
    words = list(WUKONG_DEMO_NAMESPACE)
    words[32:36] = [0] * 4
    monkeypatch.setattr(readiness, "WUKONG_DEMO_NAMESPACE", words)
    check_contract()
    words[33] = 63
    with pytest.raises(AssertionError, match="slot 8 integrity"):
        check_contract()
