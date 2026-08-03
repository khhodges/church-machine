---
name: NS slot restore post-c-list-write read
description: Bug class where NS slot 1 location is read back from memory after the c-list loop has already overwritten it — exists in both Python and JS.
---

# NS slot 1 location must be captured BEFORE the c-list write loop

## The rule
When restoring NS slot 0 and NS slot 1 after the c-list write loop, **never** read `mem[_nsSlotBase(1) + 0]` to obtain the thread location. Capture the physical address from the catalog/locations array *before* the loop runs and reuse that saved value in the restore block.

## Why
With `nsCatalogCount >= 8` the c-list write loop overwrites the word at `NS_TABLE_BASE + NS_TABLE_RESERVE - 8` (NS slot 1 word0) with `clistGTs[3]` — the LED_DEV GT word — not a physical address. The restore block then seals NS slot 1 with the wrong location, so `validateMAC` fails at B:02 INIT_THRD ("CRC seal validation failed for entry 1").

The standard boot catalog has 11 entries, so every normal boot is affected.

## Both files had the bug — but word0 must ALSO be written back

The restore block must fix all 4 words of NS slot 1, not just words 1-3:

- `server/boot_image.py` — `_ns1_loc = locations[1]` (correct pre-loop value), but word0
  is still overwritten unless `mem[_ns1_base + 0] = _ns1_loc` is also added. The Python
  test passes because `loadBootImage()` has a "foundational slot correction" (lines 395-399)
  that unconditionally resets NS[1] word0 to 0 after loading the binary — silently masking
  the missing restore. The `_initNamespaceTable()` cold-boot path has no such safety net.

- `simulator/simulator.js` — `const _ns1Loc = threadLoc` (captured before loop) AND
  `this.memory[this._nsSlotBase(1) + 0] = _ns1Loc` must both be present. The second line
  is the fix that actually eliminates the CRC fault in the live IDE.

Both files had an identical wrong comment: "word0 (location) is not overwritten by the c-list" — that comment is wrong for catalog sizes ≥ 8.

`validateMAC` uses `entry.word0_location` to recompute and compare the seal. If word0 holds
garbage (a LED_DEV GT) the recomputed seal never matches the stored seal.

## How to apply
Any future change that moves the c-list write or the NS restore block must verify:
1. `_ns1Loc` is sourced from the pre-loop snapshot (not re-read from memory after the loop).
2. `memory[_nsSlotBase(1) + 0]` is explicitly written back with `_ns1Loc` in the restore block.
