"""Regression tests for Wukong trace pet-name and disassembly metadata."""

from hardware.wukong_trace_symbols import trace_metadata


def test_boot_instruction_metadata_uses_word_offset():
    item = trace_metadata(0x00000008)
    assert item["nia_label"] == "Boot.2"
    assert item["offset"] == 2
    assert item["disasm"] == "CALL CR0, CR0[0x0000]"


def test_wukong_callhome_metadata_uses_word_offset():
    item = trace_metadata(0x000007FC)
    assert item["nia_label"] == "WukongCallHome.63"
    assert item["offset"] == 63
    assert item["disasm"] == "ISUB DR3, DR3, DR1"


def test_unknown_address_is_not_guessed():
    assert trace_metadata(0x00001000) is None
    assert trace_metadata(0x00000701) is None