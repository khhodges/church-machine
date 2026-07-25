---
name: NS slot base inverted layout
description: _nsSlotBase() uses inverted (high-to-low) formula; any direct NS read/write must use _nsSlotBase, not the forward formula — including save/load helpers and E2E tests
---

## The rule

**Always use `this._nsSlotBase(idx)` (or `sim._nsSlotBase(idx)` in tests/JS helpers) to compute NS slot addresses.** Never use `NS_TABLE_BASE + idx * NS_ENTRY_WORDS` directly.

`_nsSlotBase(idx)` = `NS_TABLE_BASE + NS_TABLE_RESERVE - (idx+1) * NS_ENTRY_WORDS`

Slot 0 is at the **highest** address in the NS table; slot N is below it. This is the A7 v1.1 layout preserved through v1.2.

**Why:** `readNSEntry()`, `writeNSEntry()`, and `isNSEntryValid()` all use `_nsSlotBase()`. If any other code uses the linear formula (`NS_TABLE_BASE + idx*4`), it reads/writes a completely different memory address. Since `mLoad` validates via `readNSEntry()`, any GT written with a seq stamped at the wrong address will produce a "GT seq N, entry seq 0" VERSION fault — the NS entry at the correct address is uninitialized (zero).

**How to apply:**
- In `simulator.js` loader functions (`loadProgram`, `loadLumpBinary`): always `this._nsSlotBase(abstrSlot)`.
- In `app-run.js` save/load helpers (`saveNamespaceState`, `loadNamespaceState`): always `sim._nsSlotBase(i)` — the forward formula silently reads/writes the wrong memory region and will appear to work (no crash) while saving garbage nsWords.
- In test setup (`test_load_lump_binary.js`, `test_lump_roundtrip.js`, E2E Playwright tests): always `sim._nsSlotBase(slot)`. The E2E pet-name test previously used `sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS` — this caused `isNSEntryValid(slot)` and `readNSEntry(slot)` to return null/false even though NS memory was "written", making `updateNamespace` skip the slot silently.
- The broader execution-path usages in `simulator.js` (lines ~2777, 3892, 4087, 5154, 5430, 5656) are a known residual inconsistency — they read from wrong addresses but are shielded: `_execCall` gets the correct NS entry from `mLoad`'s `check.entry` return value and does not re-read NS for LUMP base. F-bit pre-check at 4087 reads an uninitialized word (0 = no F-bit) — harmless false-pass for now.

## Confirmed-fixed locations
- `simulator.js` `loadProgram` (3 `nsBase` declarations: abstrBase, new-lump path, patch-in-place path)
- `simulator.js` `loadLumpBinary` (nsBase declaration)
- `app-run.js` `saveNamespaceState` (nsWords read base)
- `app-run.js` `loadNamespaceState` (nsWords write base)
- `test_load_lump_binary.js` (all 3 `nsBase` declarations)
- `test_lump_roundtrip.js` (line 72)
- `tests/e2e/pet_name_persistence.spec.js` (base calc for injected NS entry)
