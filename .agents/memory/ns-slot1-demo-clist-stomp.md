---
name: NS slot 1 DEMO_CLIST stomp (stale binary)
description: Stale boot-image.bin written by old boot_image.py had DEMO_CLIST GT words landing in NS TABLE tail, overwriting NS slot 1 word0 (Thread location) with a GT value.
---

## The rule
`loadBootImage()` must correct NS slot 1 word0 if it is ≥ NS_TABLE_BASE — that value is a GT word left over by an older generator, not a valid Thread lump address.

**Why:** An older version of boot_image.py wrote `clist_gts[]` into the NS TABLE tail (positions after all NS entries). With the inverted NS layout, `clist_gts[3] = create_gt(0, 3, {R:1,W:1}, 1) = 0x32000003` landed exactly at NS slot 1 word0, overwriting Thread's physical location (0) with a GT word. The current generator removed the NS TABLE write, but any binary produced before that change carries the corruption.

**Symptoms:** B:02 sets `cr[12].word1 = 0x32000003` (out of range), B:05 writes `memory[0x32000003 + 244]` (silently no-ops, TypedArray OOB = undefined), B:07 reads back 0 → "Thread.caps[0] is NULL" fault on every boot.

**Why memory[244] is still correct:** `boot_image.py` writes `mem[thread_loc + 244]` where `thread_loc = locations[1] = 0`, so `mem[244] = E-GT`. The corrupted NS entry only misdirects B:02/B:05/B:07; the data itself is at the right address.

## How to apply
- **Runtime fix (done):** `loadBootImage()` in `simulator.js` has a correction block after the MMIO reinit block that detects `_threadLoc >= this.NS_TABLE_BASE` and resets it to 0 with recomputed seals.
- **Binary fix (done):** `server/lumps/boot-image.bin` was patched in-place (NS slot 1 word0 set to 0, word2 seal recomputed for loc=0).
- **Detection:** If the boot starts faulting with "Thread.caps[0] is NULL" again after a binary regeneration, grep the binary for `0x32000003` at NS slot 1 base. Force a regen via `/api/boot-image/generate`.
- **Regression guard:** The correction log line `[BOOTIMG] NS[1] Thread location corrected` is a sentinel — if it appears, the binary is stale and should be regenerated.
