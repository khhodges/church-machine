---
name: Hardware boot catalog now names slot 4; gap moved to slot 7
description: Why hardcoded "slot 3 = Boot.Abstr" or "slot 4 = the boot gap" assumptions are stale, and what to check instead
---

## Rule
The JS simulator's hardware boot catalog (`_getHardwareBootCatalog()` in simulator.js) is exactly 8 slots: 0=Boot.NS, 1=Boot.Thread, 2=UART_DEV, 3=LED_DEV, 4=BTN_DEV, 5=TIMER_DEV, 6=SelfTest (the boot-entry slot, `sim.bootEntrySlot`), 7=`[programmable]` (the one real gap — absent from both `nsLabels` and `petNameMemory`/`BOOT_NAMED_SLOTS`).

Any code or test that hardcodes `NS_TABLE_BASE + 3 * NS_ENTRY_WORDS` to mean "Boot.Abstr", or treats slot 4 as an unnamed gap, is reading stale assumptions from before two migrations: (1) Boot.Abstr moved from slot 3 to slot 6 (see `boot-abstr-token-migration.md`), and (2) the boot catalog grew to 8 named/near-named slots (0-6), leaving slot 7 as the only gap.

**Why:** `simulator.js` itself is internally consistent — it always derives the boot-entry slot from `this.bootEntrySlot` (default 6) and populates `BOOT_NAMED_SLOTS = Object.freeze([0,1,2,3,4,5,6])`. But `app-run.js`'s `_injectClistNow()` had a leftover `const BOOT_ABSTR_SLOT = 3` hardcode, and several JS test files independently hardcoded slot 3 as "Boot.Abstr" or slot 4 as "the boot gap" (copy-pasted from an older test-writing session). These stale constants silently read garbage NS entries or assert against the wrong slot, since nothing throws — it just computes wrong values.

**How to apply:** Never hardcode a numeric NS slot for Boot.Abstr — use `sim.bootEntrySlot`. Never assume slot 4 is unnamed — check `sim.nsLabels[N]` / `sim.petNameMemory.has(N)` at runtime instead of trusting a comment. As of this writing the real gap is slot 7.
