"""tests/hardware/test_wukong_boot_rom_guard.py — Static guard: _WUKONG_ROM slot 3 must be BRANCH -1.

Background
----------
The v11 bitstream shipped with _WUKONG_ROM[3] = 0x00000000 (zero word) instead
of BRANCH AL, #-1.  When SelfTest returned, the CM decoded the zero word,
triggered a fault, wiped all CRs to NULL GTs, and entered an infinite fault
loop — fault LED ON, board unresponsive to IDE commands.

This test imports _WUKONG_ROM directly from hardware/wukong_top.py and asserts
the guard word is correct *at module-load time* — before any synthesis run.
No simulation is required; the check takes milliseconds.

Run with:
    python -m pytest tests/hardware/test_wukong_boot_rom_guard.py -v
"""

import pytest

from hardware.boot_rom import BOOT_PROGRAM, encode_turing, TuringOpcode, CondCode
from hardware.wukong_top import _WUKONG_ROM


# Expected BRANCH AL, #-1 encoding — must match the constant in wukong_top.py.
_EXPECTED_BRANCH_MINUS_1 = encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=(-1) & 0x7FFF)


def test_wukong_rom_guard_word_is_branch_minus_1():
    """_WUKONG_ROM[3] must be BRANCH AL, #-1, not 0x00000000.

    Without this word, a returning SelfTest falls through to an all-zero
    instruction decode, triggering an immediate fault that wipes every CR and
    locks the board in an infinite fault loop with the fault LED lit.
    """
    actual = _WUKONG_ROM[3]
    assert actual == _EXPECTED_BRANCH_MINUS_1, (
        f"_WUKONG_ROM[3] = 0x{actual:08X}, "
        f"expected BRANCH AL, #-1 = 0x{_EXPECTED_BRANCH_MINUS_1:08X}.  "
        "The guard word is missing — if SelfTest ever returns, the CM will "
        "execute a zero word, fault, and enter an infinite fault loop."
    )


def test_wukong_rom_boot_program_words_match():
    """_WUKONG_ROM[0:3] must exactly match BOOT_PROGRAM[:3].

    Confirms the three-instruction boot microcode (LOAD CR15→CHANGE CR12→CALL CR0)
    survived any edits to _WUKONG_ROM without drift from the canonical BOOT_PROGRAM.
    """
    for i in range(3):
        actual   = _WUKONG_ROM[i]
        expected = BOOT_PROGRAM[i]
        assert actual == expected, (
            f"_WUKONG_ROM[{i}] = 0x{actual:08X}, "
            f"expected BOOT_PROGRAM[{i}] = 0x{expected:08X}.  "
            "Boot microcode in the Wukong ROM has drifted from the canonical "
            "BOOT_PROGRAM definition in hardware/boot_rom.py."
        )


def test_wukong_rom_guard_word_is_not_zero():
    """_WUKONG_ROM[3] must not be 0x00000000.

    Explicit zero-check as a belt-and-suspenders assertion independent of the
    exact BRANCH encoding — zero is always the wrong value here.
    """
    assert _WUKONG_ROM[3] != 0, (
        "_WUKONG_ROM[3] is 0x00000000 — the BRANCH -1 guard word is missing.  "
        "This is the exact defect that caused the v11 hardware fault-loop."
    )
