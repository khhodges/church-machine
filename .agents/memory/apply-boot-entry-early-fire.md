---
name: _applyBootEntryToSim early-fire / _injectClistNow ascending-NS bug class
description: Two cooperating bugs that produce a CR14 RANGE fault on the first single-step when a runtime LUMP (e.g. LEDFlash) is installed at NS slot 7.
---

## Bug 1 — _applyBootEntryToSim() premature valid-entry check (app-abstractions.js)

`_applyBootEntryToSim()` is called immediately after `sim.loadBootImage(buf)` in app-shell.js and app-memory.js.  At that moment every non-resident NS slot is all-zeros.  The original condition was:

```javascript
if (bootEntrySlot >= _maxSlots || !sim.isNSEntryValid(bootEntrySlot)) {
    bootEntrySlot = _fallback;   // silently resets 7 → 6
}
```

Because `isNSEntryValid(7)` returns false (slot 7 hasn't been loaded yet), `bootEntrySlot` gets reset from 7 (LEDFlash) to 6 (SelfTest).  Then when `loadLumpBinary(words, 7)` runs it sees `abstrSlot(7) ≠ bootEntrySlot(6)` and skips the CR14 update block — CR14 keeps pointing at SelfTest (limit17=3).  On the first single-step, `fetchAddr = SelfTest.base + 1 + pc` exceeds the SelfTest limit → CR14 RANGE fault.

**Fix:** Remove `!sim.isNSEntryValid(bootEntrySlot)` from the condition.  Bounds checking (`bootEntrySlot >= _maxSlots`) is sufficient.  An in-range slot that is currently empty is fine — the LUMP load follows immediately; if it never does, mLoad produces a clear LUMP_MAGIC fault.

**Why:** The valid-entry guard was intended to catch stale localStorage from removed LUMPs, but it fires too early in the init sequence before runtime LUMPs are installed.

## Bug 2 — _injectClistNow() ascending NS table formula (app-run.js)

```javascript
// WRONG — ascending, not top-down:
const nsBase = sim.NS_TABLE_BASE + BOOT_ABSTR_SLOT * sim.NS_ENTRY_WORDS;

// CORRECT — top-down:
const nsBase = sim._nsSlotBase(BOOT_ABSTR_SLOT);
```

The NS table is stored **top-down**: slot 0 at the highest address, slot N at `NS_TABLE_BASE + NS_TABLE_RESERVE − (N+1)×NS_ENTRY_WORDS`.  The ascending formula lands at `NS_TABLE_BASE+24` (for slot 6) instead of `NS_TABLE_BASE+996`, reads garbage `lumpBase≈0`, then:
- Writes a corrupted nsWord1 with `limit17=0` to `memory[NS_TABLE_BASE+25]` (harmless for actual NS entries but corrupts adjacent data).
- Reads `lumpHdr = memory[0]` (Thread-lump header) and overwrites `memory[249..255]` with demoClistGTs (corrupts Thread-lump tail).
- Sets `CR6.word2 = packNSWord1(garbage_limit=0, ...)` → every LOAD through CR6 faults with RANGE.

**How to apply:** Any time you touch `_injectClistNow()` or add a similar function that reads NS entries, always use `sim._nsSlotBase(slot)`, never `NS_TABLE_BASE + slot * NS_ENTRY_WORDS`.
