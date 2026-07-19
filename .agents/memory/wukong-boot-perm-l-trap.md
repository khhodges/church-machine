---
name: Wukong standalone boot — PERM_L trap in BOOT_PROGRAM
description: BOOT_PROGRAM[0] unconditionally faults on standalone FPGA (no RISC-V SoC); fix is NUC_PROGRAM at ROM[0]
---

## The Rule

On a standalone FPGA (no Ti60 RISC-V SoC), **never put BOOT_PROGRAM at ROM[0]**.
Put NUC_PROGRAM at ROM[0] instead.

## Why

`LOAD CR15, CR15[0]` (BOOT_PROGRAM[0]) faults with PERM_L unconditionally on standalone:

```
hardware/load.py line 39:
    self.mload_m_elevated.eq(self.cr_src == CR_CLIST)
                                              # CR_CLIST = CR6 = 6
```

M-elevation (which bypasses the PERM_L gate) is **only granted when `cr_src == CR_CLIST` (CR6)**.
BOOT_PROGRAM[0] uses cr_src=CR15 (=15). Not CR6. So `m_elevated=0`.

Boot FSM initialises CR15.word0_gt = `0x02000000` (perm bits[30:28] = 0b000 → no L perm).
In mload CHECK_L state: `~has_l_perm & ~m_elevated` → **PERM_L fault. Always.**

The Ti60 avoids this because the RISC-V SoC initialises the CM via a different path
(LOAD_NUC → COMPLETE, never executing BOOT_PROGRAM from ROM).

## How to Apply

For the Wukong standalone (XC7A100T) top-level:
- `WUKONG_ROM[0..16]` = `NUC_PROGRAM` (17 words), rest = 0.
- `NUC_PROGRAM[0]` = `LOAD CR3, CR6[5]` — uses cr_src=CR6 → `m_elevated=1` → passes PERM_L.
- Code bounds are (0,0) = inactive at boot_complete (only set by CALL), so any NIA in ROM executes without fetch_bounds_fault.
- Boot FSM sets CR6.word1_location=0x400 (c-list) and CR15.word1_location=0 (NS at byte 0).
- NS slot 3 (LED_DEV) at DMEM byte 48 — integrity 0xdead3ecf verified ✓.
- c-list slot 5 = 0xb2000003 (GT_TYPE_INFORM, slot_id=3 = LED_DEV) at DMEM word 261 ✓.

## dmem_init for Wukong (minimal)

```
words   0-31  : DEMO_NAMESPACE  (8 NS slots × 4 words; slot 3 = LED_DEV MMIO)
words  32-255 : zeros
words 256-319 : DEMO_CLIST      (64 c-list entries; slot 5 = LED_DEV GT)
words 320+    : zeros
```

36 hw_init writes total (down from 67 with BOOT_PROGRAM complexity).
No NUC_LUMP_HEADER, no NS mirror at 0xFD00, no Thread.caps needed.
