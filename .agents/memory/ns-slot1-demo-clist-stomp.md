---
name: NS slot 1 DEMO_CLIST stomp + boot-entry CR0 fixup
description: Three cooperating bugs that together caused Thread.CR0 to always show SelfTest (slot 6) even when ⚡ Lightning Boot pointed at a different entry (e.g. WukongCallHome, slot 7).
---

## Bug 1 — Stale binary DEMO_CLIST stomp on NS slot 1

**Rule:** `loadBootImage()` must correct NS slot 1 word0 if it is ≥ NS_TABLE_BASE.

**Why:** Old `boot_image.py` wrote `clist_gts[]` into NS TABLE tail; `clist_gts[3] = 0x32000003` landed at NS slot 1 word0, overwriting Thread's physical location (0) with a GT word. B:02 sets `cr[12].word1 = 0x32000003`, B:05 writes to out-of-range (no-op), B:07 reads back 0 → NULL fault.

**Fix (done):** Correction block in `loadBootImage()` in `simulator.js` after MMIO reinit block. Logs `[BOOTIMG] NS[1] Thread location corrected` as a sentinel. Binary also patched in-place.

## Bug 2 — `loadBootImage()` overwrites user's ⚡ slot selection

**Rule:** In `loadBootImage()`, if the user has already set `bootEntrySlot` to a non-default (≠ `_bootAbstrSlot`) but the binary stores the default, **preserve the user's selection**.

**Why:** `loadBootImage()` discovers `bootEntrySlot` from `memory[NS_TABLE_BASE - 2]`. The binary always stores `6` (SelfTest = default). If the user clicked ⚡ on slot 7, that change is in `sim.bootEntrySlot`, but `loadBootImage()` was unconditionally overwriting it back to 6. This silenced Bug 3's fixup entirely (saved === _bootAbstrSlot → no-op).

**Fix (done):** `_userOverride` guard in `loadBootImage()` in `simulator.js` (around line 315):
- Binary's non-default wins over user's selection (explicit binary regeneration)
- User's non-default wins over binary's default (reboot after ⚡ change)

## Bug 3 — Boot-redirect leaves CR0 pointing at _bootAbstrSlot, not user's entry

**Rule:** After the boot-entry redirect unwinds in `stepSim`/`instantBoot`/`runSim`, if `savedBootEntry !== _bootAbstrSlot` and boot completed, patch CR0 and `Thread.caps[0]` with the correct E-GT.

**Why:** B:05 writes `createGT(0, _bootAbstrSlot (=6), {E:1}, 1) = 0x4A000006` to `Thread.caps[0]` during redirect. B:07 reads it back into CR0. Restore unwinds to `bootEntrySlot=7`, but CR0/memory[244] stay at slot 6.

**Fix (done):** All three restore sites in `app-run.js` apply a fixup block. Uses literal `244` not `sim.THREAD_CAPS_OFFSET` (the constant is module-level in simulator.js, not on the instance).

**Note:** Bugs 2 and 3 cooperate — Bug 2 made Bug 3's guard always false, so both had to be fixed. Bug 1 was independent but was masked by the same session's fault.
