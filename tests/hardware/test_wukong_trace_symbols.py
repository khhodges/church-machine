"""Regression tests for Wukong trace pet-name and disassembly metadata."""

from hardware.wukong_trace_symbols import (
    _BOOT_WORDS,
    boot_disassembly,
    trace_metadata,
)


def test_boot_instruction_metadata_uses_word_offset():
    item = trace_metadata(0x00000008)
    assert item["nia_label"] == "Boot.2"
    assert item["offset"] == 2
    assert item["disasm"] == "CALL CR[0] SelfTest"


def test_wukong_boot_instruction_metadata_uses_semantic_operations():
    assert boot_disassembly(0) == "LOAD NAMESPACE CR15"
    assert boot_disassembly(1) == "LOAD THREAD+HEAP CR12+, CR5"
    assert boot_disassembly(2, "SelfTest") == "CALL CR[0] SelfTest"


def test_boot_namespace_label_matches_encoded_destination_register():
    encoded_dst = (_BOOT_WORDS[0] >> 19) & 0xF
    assert encoded_dst == 15
    assert boot_disassembly(0).endswith(f"CR{encoded_dst}")


def test_wukong_callhome_metadata_uses_word_offset():
    item = trace_metadata(0x000012FC)
    assert item["nia_label"] == "WukongCallHome.63"
    assert item["offset"] == 63
    assert item["disasm"] == "BRANCHNE -1"


def test_wukong_dread_at_71c_is_not_mislabeled_as_isub():
    item = trace_metadata(0x0000121C)
    assert item["nia_label"] == "WukongCallHome.7"
    assert item["disasm"] == "DREAD DR6, CR4, #0, DR1"


def test_wukong_callhome_immediate_arithmetic_strips_marker():
    item = trace_metadata(0x0000120C)
    assert item["nia_label"] == "WukongCallHome.3"
    assert item["disasm"] == "IADD DR1, DR0, #1"


def test_selftest_register_arithmetic_names_selected_dr():
    item = trace_metadata(0x00000604)
    assert item["nia_label"] == "SelfTest.1"
    assert item["disasm"] == "ISUB DR0, DR0, DR0"


def test_selftest_immediate_arithmetic_strips_marker():
    item = trace_metadata(0x00000610)
    assert item["nia_label"] == "SelfTest.4"
    assert item["disasm"] == "IADD DR1, DR1, #11"


def test_unknown_address_is_not_guessed():
    selftest = trace_metadata(0x00000600)
    assert selftest["nia_label"] == "SelfTest.0"
    assert selftest["disasm"] == "LUMP_HEADER"
    assert trace_metadata(0x00001000) is None
    assert trace_metadata(0x00001201) is None