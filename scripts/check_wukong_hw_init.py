#!/usr/bin/env python3
"""CI guard — Wukong hardware BRAM init invariants.

Checks three properties that the structural auto-derivation in wukong_top.py
cannot catch because they live in separate modules:

  1. WUKONG_DEMO_CLIST[0] is E-GT for WukongCallHome (slot 7, 0x4A000007).
     BOOT_PROGRAM[2] = CALL CR0,CR0[0] uses this entry; the wrong value here
     causes the CM to call the wrong LUMP (or fault) immediately after boot.

  2. WUKONG_DEMO_NAMESPACE slot 7 alloc ≥ header + WUKONG_NUC_PROGRAM words.
     If the alloc is too small the CM fires a range fault the moment it tries
     to execute past the lim17 boundary.

  3. _WUKONG_ROM[2] is BOOT_PROGRAM[2] (the CALL word, 0x17000000).
     Catches any accidental revert to the old WUKONG_NUC_PROGRAM ROM layout.

Run as part of CI:
    python3 scripts/check_wukong_hw_init.py

Exit 0 on all pass, exit 1 on any failure.
"""

import sys
import os

# Make sure the hardware package is importable from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hardware.boot_rom import (
    WUKONG_DEMO_CLIST,
    WUKONG_DEMO_NAMESPACE,
    WUKONG_NUC_PROGRAM,
    WUKONG_CALLHOME_NS_SLOT,
    BOOT_PROGRAM,
)
from hardware.wukong_top import _WUKONG_ROM   # noqa: F401  (triggers the assert too)

FAILURES = []

# ── Check 1: WUKONG_DEMO_CLIST[0] is E-GT for WukongCallHome (slot 7) ─────────
EXPECTED_BOOT_ENTRY_GT = 0x4A000007
actual = WUKONG_DEMO_CLIST[0]
if actual == EXPECTED_BOOT_ENTRY_GT:
    print(f"OK: WUKONG_DEMO_CLIST[0] = 0x{actual:08X}  (WukongCallHome E-GT, slot 7)")
else:
    msg = (
        f"FAIL: WUKONG_DEMO_CLIST[0] = 0x{actual:08X}, "
        f"expected WukongCallHome E-GT 0x{EXPECTED_BOOT_ENTRY_GT:08X}.\n"
        "       BOOT_PROGRAM CALL CR0,CR0[0] will call the wrong LUMP."
    )
    print(msg)
    FAILURES.append(msg)

# ── Check 2: NS slot 7 alloc ≥ LUMP body size ──────────────────────────────────
slot7_base  = WUKONG_CALLHOME_NS_SLOT * 4          # index into WUKONG_DEMO_NAMESPACE
slot7_word1 = WUKONG_DEMO_NAMESPACE[slot7_base + 1]
lim17       = slot7_word1 & 0x1FFFF                # bits[16:0]
alloc       = lim17 + 1
needed      = 1 + len(WUKONG_NUC_PROGRAM)          # header + code words
if alloc >= needed:
    print(
        f"OK: WUKONG_DEMO_NAMESPACE slot 7 alloc={alloc} "
        f"≥ needed={needed} (header + {len(WUKONG_NUC_PROGRAM)} instructions)"
    )
else:
    msg = (
        f"FAIL: WUKONG_DEMO_NAMESPACE slot 7 alloc={alloc} "
        f"< needed={needed} (header + {len(WUKONG_NUC_PROGRAM)} instructions).\n"
        "       The CM will fire a range fault during WukongCallHome execution."
    )
    print(msg)
    FAILURES.append(msg)

# ── Check 3: _WUKONG_ROM[2] is BOOT_PROGRAM's CALL word ───────────────────────
expected_call = BOOT_PROGRAM[2]   # 0x17000000
rom2 = _WUKONG_ROM[2]
if rom2 == expected_call:
    print(f"OK: _WUKONG_ROM[2] = 0x{rom2:08X}  (BOOT_PROGRAM CALL CR0,CR0[0])")
else:
    msg = (
        f"FAIL: _WUKONG_ROM[2] = 0x{rom2:08X}, "
        f"expected BOOT_PROGRAM CALL 0x{expected_call:08X}.\n"
        "       wukong_top.py may have reverted to WUKONG_NUC_PROGRAM ROM layout."
    )
    print(msg)
    FAILURES.append(msg)

# ── Result ──────────────────────────────────────────────────────────────────────
if FAILURES:
    print(f"\nFAIL: {len(FAILURES)} invariant(s) violated — Wukong BRAM init is broken.")
    sys.exit(1)
else:
    print("\nOK: all Wukong hw-init invariants pass.")
    sys.exit(0)
