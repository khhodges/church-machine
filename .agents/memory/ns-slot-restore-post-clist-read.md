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

## Both files had the bug
- `server/boot_image.py` — `_ns1_loc = mem[_ns1_base + 0]` → fixed to `locations[1]`
- `simulator/simulator.js` — `const _ns1Loc = this.memory[this._nsSlotBase(1) + 0]` → fixed to `threadLoc` (already captured before the loop at `const threadLoc = this.memory[this._nsSlotBase(1)]`)

Both files had an identical wrong comment: "word0 (location) is not overwritten by the c-list" — that comment is wrong for catalog sizes ≥ 8.

## How to apply
Any future change that moves the c-list write or the NS restore block must verify the NS slot 1 location is sourced from the pre-loop snapshot, not re-read from memory.
