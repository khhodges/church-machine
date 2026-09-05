"""tests/hardware/test_wukong_boot_rom_guard.py — Static guards for the Wukong boot ROM.

Guards
------
1. _WUKONG_ROM[3] must be BRANCH AL, #-1 (not 0x00000000).
   The v11 bitstream shipped with a zero word here.  When SelfTest returned,
   the CM decoded it, triggered a fault, wiped all CRs to NULL GTs, and entered
   an infinite fault loop — fault LED ON, board unresponsive to IDE commands.

2. init_rom size in the committed RTLIL must match the Python-derived
   WUKONG_N_INIT constant.  The init_rom is a LUTRAM seeded with every non-zero
   DMEM word; if its size changes, the boot sequencer writes the wrong number
   of words and the CM starts with a corrupted memory image.  This guard
   catches the shrinkage before a synthesis run, not after a broken bitstream
   is flashed to hardware.

   Expected count (WUKONG_N_INIT) breaks down as:
     WUKONG_SELFTEST_WORDS (non-zero subset of 512-word SelfTest LUMP body)
     + WUKONG_CAPABILITY_TEST_WORDS (IDE-selected boot default)
     + WukongCallHome header + WUKONG_NUC_PROGRAM (74 words)
     + WUKONG_DEMO_NAMESPACE + WUKONG_DEMO_CLIST (partial occupancy)
     + WUKONG_WCH_CLIST + Boot.Thread header words (4 words)

This test imports from hardware.wukong_top and hardware.boot_rom and reads
build/church_wukong_xc7a100t.il.  No simulation is required; the checks take
milliseconds.

Run with:
    python -m pytest tests/hardware/test_wukong_boot_rom_guard.py -v
"""

import os
import re

import pytest

from hardware.boot_rom import BOOT_PROGRAM, encode_turing, TuringOpcode, CondCode
from hardware.wukong_top import (
    _WUKONG_BOOT_WINDOW_BYTES,
    _WUKONG_ROM,
    WUKONG_N_INIT,
)

_IL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "build", "church_wukong_xc7a100t.il"
)


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


def test_wukong_rom_fetch_window_includes_guard_word():
    """The instruction mux must fetch ROM word 3 instead of DMEM word 3.

    A boundary of 0x0C makes the BRANCH guard present but unreachable: after
    SelfTest returns to NIA 0x0C, hardware reads Namespace data from DMEM as an
    instruction and immediately faults.
    """
    guard_nia = 3 * 4
    assert guard_nia < _WUKONG_BOOT_WINDOW_BYTES, (
        f"Boot guard NIA 0x{guard_nia:02X} is outside the ROM fetch window "
        f"ending at 0x{_WUKONG_BOOT_WINDOW_BYTES - 1:02X}. SelfTest RETURN "
        "would fetch DMEM namespace data instead of BRANCH -1."
    )


# ── init_rom size guard ───────────────────────────────────────────────────────

def test_wukong_il_exists_for_init_rom_check():
    """build/church_wukong_xc7a100t.il must exist for the init_rom size guard.

    If this test fails, run the Amaranth → RTLIL conversion step before
    synthesis:
        python -c "from hardware.wukong_top import ChurchWukongXC7A100T; ..."
    or use the 'Regenerate Wukong RTLIL' action in the IDE build panel.
    """
    assert os.path.isfile(_IL_PATH), (
        f"Committed RTLIL not found at {_IL_PATH}.  "
        "Generate it before synthesis so the init_rom size guard can run."
    )


def test_wukong_init_rom_size_matches_python_source():
    """init_rom size in church_wukong_xc7a100t.il must equal WUKONG_N_INIT.

    The init_rom is a synthesis-time LUTRAM seeded with every non-zero word in
    the 64 KiB DMEM image (WUKONG_N_INIT entries).  The hw_init sequencer uses
    it to write all those words before boot_start fires, bypassing Vivado's
    BRAM `initial`-block inference.

    If the sizes diverge, the boot sequencer will write too few or too many
    words and the CM will start with a corrupted memory image — producing a
    silent broken bitstream rather than a build error.

    Expected WUKONG_N_INIT = {expected} (computed from current Python source).
    If the IL was generated from an older version of boot_rom.py or
    wukong_top.py, regenerate it and commit the updated file.
    """.format(expected=WUKONG_N_INIT)
    if not os.path.isfile(_IL_PATH):
        pytest.skip("build/church_wukong_xc7a100t.il not present — skipped")

    with open(_IL_PATH, encoding="utf-8") as fh:
        il_text = fh.read()

    # The RTLIL line looks like:
    #   memory width 46 size 526 \init_rom
    m = re.search(r"memory width 46 size (\d+)\s+\\init_rom", il_text)
    assert m is not None, (
        "Could not find 'memory width 46 size N \\init_rom' in "
        f"{_IL_PATH}.  The init_rom submodule may have been renamed or removed."
    )

    il_size = int(m.group(1))
    assert il_size == WUKONG_N_INIT, (
        f"init_rom size in committed RTLIL is {il_size} words, "
        f"but WUKONG_N_INIT (Python source) is {WUKONG_N_INIT} words.  "
        f"Delta = {il_size - WUKONG_N_INIT:+d} words.  "
        "Regenerate build/church_wukong_xc7a100t.il and commit it so "
        "the committed file stays in sync with the Python source.  "
        "A stale init_rom produces a broken bitstream without a build error."
    )
