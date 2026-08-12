#!/usr/bin/env python3
"""CI guard — Wukong hardware BRAM init invariants.

Checks three properties that the structural auto-derivation in wukong_top.py
cannot catch because they live in separate modules:

  1. WUKONG_DEMO_CLIST[0] is the factory SelfTest E-GT (0x4A000006),
     matching the simulator's default lightning-bolt entry.

  2. WUKONG_DEMO_NAMESPACE slot 6 contains the full SelfTest allocation and
     slot 7 alloc ≥ header + WUKONG_NUC_PROGRAM words.
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
    SELFTEST_NS_SLOT,
    WUKONG_SELFTEST_BASE_BYTE,
    WUKONG_SELFTEST_ALLOC,
    WUKONG_CALLHOME_BASE_BYTE,
    WUKONG_THREAD_BASE_WORD,
    BOOT_PROGRAM,
)
from hardware.wukong_top import _WUKONG_ROM   # noqa: F401  (triggers the assert too)

FAILURES = []

# ── Check 1: factory boot entry is SelfTest ───────────────────────────────────
actual = WUKONG_DEMO_CLIST[0]
if actual == 0x4A000006:
    print("OK: WUKONG_DEMO_CLIST[0] = 0x4A000006  (factory SelfTest ⚡ entry)")
else:
    msg = (
        f"FAIL: WUKONG_DEMO_CLIST[0] = 0x{actual:08X}, expected SelfTest E-GT "
        "(0x4A000006)."
    )
    print(msg)
    FAILURES.append(msg)

# ── Check 2: resident LUMP allocations and non-overlap ────────────────────────
slot6_base = SELFTEST_NS_SLOT * 4
slot6_word1 = WUKONG_DEMO_NAMESPACE[slot6_base + 1]
slot6_alloc = (slot6_word1 & 0x1FFFF) + 1
if slot6_alloc >= WUKONG_SELFTEST_ALLOC and WUKONG_SELFTEST_BASE_BYTE == 0x600:
    print(f"OK: WUKONG_DEMO_NAMESPACE slot 6 alloc={slot6_alloc} at 0x600")
else:
    msg = f"FAIL: slot 6 alloc/location invalid: alloc={slot6_alloc}, base=0x{WUKONG_SELFTEST_BASE_BYTE:X}"
    print(msg)
    FAILURES.append(msg)

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

if not (WUKONG_SELFTEST_BASE_BYTE + WUKONG_SELFTEST_ALLOC * 4
        <= WUKONG_THREAD_BASE_WORD * 4
        < WUKONG_CALLHOME_BASE_BYTE):
    msg = "FAIL: SelfTest, Thread, and WukongCallHome DMEM regions overlap"
    print(msg)
    FAILURES.append(msg)
else:
    print("OK: SelfTest, Thread, and WukongCallHome DMEM regions do not overlap")

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
