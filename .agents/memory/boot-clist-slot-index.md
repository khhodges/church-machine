---
name: Boot c-list slot index trap
description: clistGTs[0] is overwritten in-place by the mem-manager GT, not prepended; device slots are UART=2, LED=3, BTN=4, TIMER=5
---

## The rule

Boot c-list device slots come **directly** from `_getHardwareBootCatalog()` array indices:
- clistGTs[0] = mem-manager GT (Boot.NS GT overwritten at line ~1263 with R|W perms)
- clistGTs[1] = Boot.Thread
- clistGTs[2] = UART_DEV  (MMIO 0x40000014)
- clistGTs[3] = LED_DEV   (MMIO 0x40000000, lim17=4)
- clistGTs[4] = BTN_DEV   (MMIO 0x40000028, R-only)
- clistGTs[5] = TIMER_DEV (MMIO 0x4000002C)
- clistGTs[6] = SelfTest / Boot.Abstr
- clistGTs[7] = null (0)

**Why:** `simulator.js _initNamespaceTable` loop calls `clistGTs.push(gtWord)` for each
catalog entry in order. Then `clistGTs[0] = this.createGT(0, 0, {R:1,W:1}, 1)` OVERWRITES
index 0 in-place (replaces Boot.NS GT with a mem-manager RW GT). No new slot is inserted.
Mistaking this overwrite for a prepend shifts everything by +1, putting LED at BTN's slot.

**How to apply:** Before touching any device slot number in assembler.js `_resolveNSName`,
`buildSlotNames`, or `app-run.js _devSlotMap`, verify against the catalog order in
`_getHardwareBootCatalog()` (simulator.js ~line 1066). Count from 0.
