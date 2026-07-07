---
name: Boot DEMO_CLIST layout
description: The 11-slot boot c-list (demoClistGTs) built from the 8-slot hardware boot catalog — correct slot assignments for all assembler and simulator code.
---

# Boot DEMO_CLIST Layout (11-slot)

Built by `_initNamespaceTable()` via `_getHardwareBootCatalog()` (8 hardware slots, 0-7):

| clistGTs index | Content | MMIO base |
|:---|:---|:---|
| [0] | memory-manager GT (R\|W over full NS) | — |
| [1] | Boot.NS GT | — |
| [2] | Boot.Thread GT | — |
| [3] | UART_DEV GT (R\|W) | 0x40000014 |
| [4] | LED_DEV GT (R\|W, lim17=4) | 0x40000000 |
| [5] | BTN_DEV GT (R only) | 0x40000028 |
| [6] | TIMER_DEV GT (R\|W) | 0x4000002C |
| [7] | SelfTest GT (E) | — |
| [8] | 0 (null — slot 7 = programmable) | — |
| [9],[10] | 0 (padding to DEMO_CLIST_SIZE=11) | — |

## Key rules

- LED0-LED4 all share the LED_DEV GT at index 4; individual LEDs are selected by DWRITE offset (0=LED0…4=LED4). LED5 would RANGE-fault at DWRITE time (lim17=4).
- SlideRule is NOT a boot hardware device — it's a software abstraction at a higher NS slot. LOAD CRx, SlideRule without a namespace entry or capabilities block produces a parse error.
- In `_resolveNSName`: LED[N] → 4, UART → 3, BTN → 5, Timer → 6.
- In `_devSlotMap` (app-run.js): same mapping.
- In `buildSlotNames`: 3→'UART', 4→'LED_DEV', 5→'BTN', 6→'Timer'.

**Why:** The DEMO_CLIST was compacted from 18 slots (with devices at 8-17) to 11 slots reflecting the real 8-slot hardware boot catalog. Old slot numbers (8-17) still appear in legacy comments and tests.

**How to apply:** Any code that references LED c-list slots must use index 4 (not 8+N). Any code that references UART/BTN/Timer must use 3/5/6 (not 14/15/17). SlideRule always resolves via NS registry (setNamespace/abstract registry), not a fixed boot slot.
