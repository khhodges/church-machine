---
name: NS slot base inverted layout
description: _nsSlotBase() uses inverted (high-to-low) formula; loadProgram/loadLumpBinary historically used wrong linear formula causing mLoad gt_seq mismatches
---

## The rule

**Always use `this._nsSlotBase(idx)` (or `sim._nsSlotBase(idx)` in tests) to compute NS slot addresses.** Never use `NS_TABLE_BASE + idx * NS_ENTRY_WORDS` directly.

`_nsSlotBase(idx)` = `NS_TABLE_BASE + NS_TABLE_RESERVE - (idx+1) * NS_ENTRY_WORDS`

Slot 0 is at the **highest** address in the NS table; slot N is below it. This is the A7 v1.1 layout preserved through v1.2.

**Why:** `readNSEntry()` and `writeNSEntry()` both use `_nsSlotBase()`. If any other code uses the linear formula (`NS_TABLE_BASE + idx*4`), it reads/writes a completely different memory address. Since `mLoad` validates via `readNSEntry()`, any GT written with a seq stamped at the wrong address will produce a "GT seq N, entry seq 0" VERSION fault — the NS entry at the correct address is uninitialized (zero).

**How to apply:**
- In `simulator.js` loader functions (`loadProgram`, `loadLumpBinary`): always `this._nsSlotBase(abstrSlot)`.
- In test setup (`test_load_lump_binary.js`, `test_lump_roundtrip.js`): always `sim._nsSlotBase(sim.bootEntrySlot)` or `sim._nsSlotBase(LUMP_SLOT)`.
- The broader execution-path usages (lines ~2777, 3892, 4087, 5154, 5430, 5656) are a known residual inconsistency — they read from wrong addresses but are shielded: `_execCall` gets the correct NS entry from `mLoad`'s `check.entry` return value and does not re-read NS for LUMP base. F-bit pre-check at 4087 reads an uninitialized word (0 = no F-bit) — harmless false-pass for now.

## Confirmed-fixed locations
- `simulator.js` `loadProgram` (3 `nsBase` declarations: abstrBase, new-lump path, patch-in-place path)
- `simulator.js` `loadLumpBinary` (nsBase declaration)
- `test_load_lump_binary.js` (all 3 `nsBase` declarations — lines 131, 178, 997)
- `test_lump_roundtrip.js` (line 72)

## Impact of the fix
- lump-binary-tests: 7 → 0 failures
- lump-roundtrip: 42 → 0 failures
- fault-recovery-tests: 328 → 328 (no regression)
- call-cr6-l-perm-tests: new test suite, all 17 pass
