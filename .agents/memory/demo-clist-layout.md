---
name: Boot DEMO_CLIST layout
description: The correct 8+padding slot boot c-list (demoClistGTs) built from _getHardwareBootCatalog() — authoritative slot assignments for assembler and simulator code.
---

# Boot DEMO_CLIST Layout (11-slot, DEMO_CLIST_SIZE=11)

Built by `_initNamespaceTable()` via `_getHardwareBootCatalog()`.

The loop pushes one GT per catalog entry (indices 0–7). Then
`clistGTs[0] = createGT(0, 0, {R:1,W:1}, 1)` **overwrites** [0] in-place
with the memory-manager GT — it does NOT insert, so nothing shifts.

| clistGTs index | Content | MMIO base |
|:---|:---|:---|
| [0] | memory-manager GT (overwrites Boot.NS; R\|W over full NS) | — |
| [1] | Boot.Thread GT | — |
| [2] | UART_DEV GT (R\|W) | 0x40000014 |
| [3] | LED_DEV GT (R\|W, lim17=4) | 0x40000000 |
| [4] | BTN_DEV GT (R only) | 0x40000028 |
| [5] | TIMER_DEV GT (R\|W) | 0x4000002C |
| [6] | SelfTest / Boot.Abstr GT (E) | — |
| [7] | 0 (null — programmable slot) | — |
| [8]–[10] | 0 (padding to DEMO_CLIST_SIZE=11) | — |

## Key rules

- **There is NO separate Boot.NS GT slot.** [0] holds the mem-manager GT that *replaced* it. Any table that shows [0]=mem-mgr, [1]=Boot.NS, [2]=Boot.Thread is off by +1 and wrong.
- LED0–LED4 all share the LED_DEV GT at index **3**; individual LEDs selected by DWRITE offset (0=LED0…4=LED4). LED5 faults (lim17=4).
- SlideRule is NOT a boot hardware device — resolves via NS registry only.
- In `_resolveNSName` (assembler.js): UART → 2, LED[N] → 3, BTN → 4, Timer → 5, Boot.Abstr → 6.
- SelfTest/Boot.Abstr c-list slot is **6**, matching its NS slot in `_getHardwareBootCatalog`.
  - Historical note: before the NS slot migration, Boot.Abstr was at both NS slot 3 AND c-list slot 3.
    After migration to NS slot 6, c-list slot 3 became LED_DEV. Any code returning 3 for Boot.Abstr
    is a silent wrong-CALL bug (would invoke LED_DEV instead of SelfTest).

**Why:** The DEMO_CLIST slots mirror NS slot indices 0–7 directly (hardware catalog indices).
The memory-manager overwrite at [0] is the only deviation from a pure 1:1 mapping.

**How to apply:** Verify device slots against `_getHardwareBootCatalog()` in simulator.js.
Count from 0. clistGTs[0] is always mem-manager. UART=2, LED=3, BTN=4, TIMER=5, SelfTest=6.
