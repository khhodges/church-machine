---
name: NUC_PROGRAM c-list slot for LED_DEV
description: NUC_PROGRAM must use DEMO_CLIST slot 5 for LED_DEV, NOT slot 8 (TIMER_DEV).
---

# NUC_PROGRAM c-list slot for LED_DEV

## The Rule
NUC_PROGRAM's opening LOAD instruction must use c-list slot **5** (LED_DEV), not slot 8.

```python
encode_church(ChurchOpcode.LOAD, CondCode.AL, cr_dst=3, cr_src=6, imm=5)  # slot 5 = LED_DEV
```

DEMO_CLIST layout (hardware boot, boot_rom.py):
- idx 5: LED_DEV  → NS slot 3 (MMIO 0x40000000)
- idx 6: UART_DEV → NS slot 2
- idx 7: BTN_DEV  → NS slot 4
- idx 8: TIMER_DEV → NS slot 5  ← wrong target; writes silently to timer, no fault

**Why:** The c-list was restructured (LED moved from slot 8 to slot 5) but NUC_PROGRAM was not updated. The bug is silent — DWRITE to TIMER_DEV succeeds (valid R|W cap, offset in bounds) so no fault fires; LEDs simply go dark after boot_complete.

**How to apply:** Any time DEMO_CLIST is restructured, grep for `LOAD.*CR6\[` in boot_rom.py and cross-check each slot index against the current DEMO_CLIST layout.
