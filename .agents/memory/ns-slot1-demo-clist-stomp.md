---
name: NS slot 1 DEMO_CLIST stomp + boot-entry CR0 fixup
description: Two cooperating bugs: stale binary stomped NS slot 1 word0 with a GT value; and the boot-redirect pattern left CR0 pointing at _bootAbstrSlot (6=SelfTest) instead of the user's chosen entry.
---

## Bug 1 — Stale binary DEMO_CLIST stomp on NS slot 1

**Rule:** `loadBootImage()` must correct NS slot 1 word0 if it is ≥ NS_TABLE_BASE.

**Why:** An older `boot_image.py` wrote `clist_gts[]` into the NS TABLE tail. With the inverted NS layout, `clist_gts[3] = 0x32000003` landed at NS slot 1 word0, overwriting Thread's physical location (0) with a GT word. The current generator removed the NS TABLE write, but any binary from before that change carries the corruption. B:02 then sets `cr[12].word1 = 0x32000003`, B:05 writes to an out-of-range address (no-op), B:07 reads back 0 → NULL fault.

**Fix (done):** `loadBootImage()` in `simulator.js` has a correction block after the MMIO reinit block: detects `_threadLoc >= this.NS_TABLE_BASE`, resets word0 to 0, recomputes seals. Logs `[BOOTIMG] NS[1] Thread location corrected` as a sentinel. Binary also patched in-place.

## Bug 2 — Boot-redirect leaves CR0 pointing at _bootAbstrSlot, not user's entry

**Rule:** After the boot-entry redirect unwinds in `stepSim`/`instantBoot`/`runSim`, if `savedBootEntry !== _bootAbstrSlot` and boot completed, patch CR0 and `Thread.caps[0]` with the correct E-GT.

**Why:** `slowBoot()`/`instantBoot()`/`runSim()` redirect `sim.bootEntrySlot → _bootAbstrSlot (=6)` around `_bootStep()` calls so B:05 never tries mLoad on a possibly-empty user-selected slot. B:05 writes `createGT(0, 6, {E:1}, 1) = 0x4A000006` (SelfTest) to `Thread.caps[0]`. B:07 reads that back into CR0. When the redirect unwinds and `bootEntrySlot` is restored to 7 (e.g. WukongCallHome), CR0 still has SelfTest's GT.

**Fix (done):** All three restore sites in `app-run.js` now apply:
```javascript
if (savedEntry !== sim._bootAbstrSlot && sim.bootComplete && !sim.halted) {
    const gt = sim.createGT(0, savedEntry, {E:1}, 1) >>> 0;
    sim.cr[0] = { word0: gt, word1: 0, word2: 0, word3: 0 };
    sim.memory[(sim.memory[sim._nsSlotBase(1)]>>>0 + 244)>>>0] = gt;  // 244 = THREAD_CAPS_OFFSET (not on instance)
}
```
**Note:** `THREAD_CAPS_OFFSET = 244` is a module-level `const` in `simulator.js`, NOT an instance property. Use the literal `244` from `app-run.js`; do NOT use `sim.THREAD_CAPS_OFFSET` (undefined).
